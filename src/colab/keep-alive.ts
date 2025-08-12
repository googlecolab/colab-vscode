/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import { Disposable } from "vscode";
import vscode from "vscode";
import { OverrunPolicy, SequentialTaskRunner } from "../common/task-runner";
import { AssignmentManager } from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { Kernel } from "./api";
import { ColabClient } from "./client";

interface Config {
  /**
   * How long (in milliseconds) to continue sending the "keep-alive"
   * signal.
   */
  inactivityThresholdMs: number;
  /**
   * How long (in milliseconds) to wait between "keep-alive" signals.
   */
  keepAliveIntervalMs: number;
  /**
   * How long (in milliseconds) to wait for the user to extend sending the
   * "keep-alive signal for a given server.
   */
  idleExtensionPromptTimeMs: number;
  /**
   * How long (in milliseconds) to extend the "keep-alive" signal.
   */
  idleExtensionMs: number;
}

const DEFAULT_CONFIG: Config = {
  inactivityThresholdMs: 1000 * 60 * 60, // 1 hour.
  keepAliveIntervalMs: 1000 * 60 * 5, // 5 minutes.
  idleExtensionPromptTimeMs: 1000 * 10, // 10 seconds.
  idleExtensionMs: 1000 * 60 * 30, // 30 minutes.
};

/**
 * Keeps Colab servers alive while they are recently used, or if the user
 * explicitly extends their lifetime.
 */
export class ServerKeepAliveController implements Disposable {
  private readonly extendedKeepAlive = new Map<UUID, Date>();
  private readonly tombstones = new Set<UUID>();
  private readonly runner: SequentialTaskRunner;

  constructor(
    private readonly vs: typeof vscode,
    private readonly colabClient: ColabClient,
    private readonly assignmentManager: AssignmentManager,
    private readonly config: Config = DEFAULT_CONFIG,
  ) {
    this.runner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: config.keepAliveIntervalMs,
        // The underlying calls to get the assigned servers and send the
        // "keep-alive" signal are quick. Twice the prompt time should be
        // plenty.
        taskTimeoutMs: 2 * config.idleExtensionPromptTimeMs,
      },
      (signal) => this.keepServersAlive(signal),
      OverrunPolicy.AllowToComplete,
    );
  }

  dispose(): void {
    this.runner.dispose();
  }

  private async keepServersAlive(signal: AbortSignal): Promise<void> {
    const assignments = await this.assignmentManager.getAssignedServers();
    const keepAliveSignals = assignments.map(async (a) => {
      try {
        await this.keepServerAlive(a, signal);
      } catch (e: unknown) {
        console.error(`Error keeping server alive: ${a.label}`, e);
      }
    });

    await Promise.all(keepAliveSignals);
  }

  private async keepServerAlive(
    assignment: ColabAssignedServer,
    signal: AbortSignal,
  ): Promise<void> {
    const kernels = await this.colabClient.listKernels(assignment, signal);
    if (await this.shouldKeepAlive(assignment, kernels)) {
      await this.colabClient.sendKeepAlive(assignment.endpoint, signal);
    }
  }

  /**
   * Determines if a server should be kept alive.
   *
   * Returns true if:
   *
   * - the server is active (used within the configured inactivity threshold)
   * - the server is inactive but the user explicitly extends the lifetime
   * - the server is inactive but within the aforementioned extension period
   *
   * Otherwise, the server will not be kept alive.
   *
   * If a server was previously not kept alive but there was recent activity on
   * it, it will be kept alive again according to the aforementioned rules.
   */
  private async shouldKeepAlive(
    assignment: ColabAssignedServer,
    kernels: Kernel[],
  ): Promise<boolean> {
    const now = new Date();

    const hasNoConnections =
      kernels.length === 0 || kernels.every((k) => k.connections === 0);
    if (hasNoConnections) {
      return false;
    }
    const lastActive = kernels
      .map((k) => new Date(k.lastActivity))
      .reduce((mostRecent, cur) => {
        if (cur > mostRecent) {
          return cur;
        }
        return mostRecent;
      }, new Date(0));
    const lastActiveFromNowMs = now.getTime() - lastActive.getTime();
    const isActive = lastActiveFromNowMs < this.config.inactivityThresholdMs;
    if (isActive) {
      // It's possible the assignment was tombstoned and we stopped sending
      // pings, but then the user started using it again before the Colab
      // backend disconnected the kernel.
      this.tombstones.delete(assignment.id);
      return true;
    }
    if (this.tombstones.has(assignment.id)) {
      return false;
    }
    const extension = this.extendedKeepAlive.get(assignment.id);
    const withinExtensionPeriod =
      extension !== undefined && extension.getTime() >= now.getTime();
    if (withinExtensionPeriod) {
      return true;
    }
    const shouldExtend = await this.extendKeepAlive(assignment.label);
    if (shouldExtend) {
      this.extendedKeepAlive.set(
        assignment.id,
        new Date(now.getTime() + this.config.idleExtensionMs),
      );
      return true;
    }

    this.tombstones.add(assignment.id);
    return false;
  }

  private async extendKeepAlive(serverLabel: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.vs.window.withProgress(
        {
          location: this.vs.ProgressLocation.Notification,
          title: `"${serverLabel}" is idle. It will soon be removed`,
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            resolve(true);
          });
          const secondsToDecide = this.config.idleExtensionPromptTimeMs / 1000;
          for (let i = secondsToDecide; i > 0; i--) {
            progress.report({
              message: `Use it or hit "Cancel" within ${i.toString()} seconds to keep it running.`,
              increment: 100 / secondsToDecide,
            });

            await new Promise((r) => setTimeout(r, 1000));
          }

          resolve(false);
        },
      );
    });
  }
}
