/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, EventEmitter } from "vscode";
import { AuthChangeEvent } from "../auth/auth-provider";
import { LatestCancelable } from "../common/async";
import { log } from "../common/logging";
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { ColabLanguageClient, LanguageClientFactory } from "./language-client";

/**
 * The {@link Event} fired when the language server changes.
 */
export type ServerChangeEvent =
  | { kind: "connected"; server: ColabAssignedServer }
  | { kind: "disconnected"; server: ColabAssignedServer };

/**
 * Manages the lifecycle of a LanguageClient connected to the latest assigned
 * Colab server.
 */
export class LanguageClientController implements Disposable {
  readonly onDidLanguageServerChange: Event<ServerChangeEvent>;

  private active?: { client: ColabLanguageClient; server: ColabAssignedServer };
  private bindLatestServer = new LatestCancelable(
    "LanguageClientController",
    this.connectToLatestServer.bind(this),
  );
  private isAuthorized = false;
  private authorizedListener: Disposable;
  private assignmentListener: Disposable;
  private serverChangeEmitter: EventEmitter<ServerChangeEvent>;

  constructor(
    private vs: typeof vscode,
    authEvent: Event<AuthChangeEvent>,
    private readonly assignments: AssignmentManager,
    private readonly vsLanguageClientFactory: LanguageClientFactory,
  ) {
    this.authorizedListener = authEvent(this.handleAuthChange.bind(this));
    this.assignmentListener = assignments.onDidAssignmentsChange(
      this.handleAssignmentsChange.bind(this),
    );
    this.serverChangeEmitter = new vs.EventEmitter<ServerChangeEvent>();
    this.onDidLanguageServerChange = this.serverChangeEmitter.event;
    this.onDidLanguageServerChange((e) => {
      log.info(`Colab language server ${e.kind}: ${serverStr(e.server)}`);
    });
  }

  dispose() {
    this.authorizedListener.dispose();
    this.assignmentListener.dispose();
    this.bindLatestServer.cancel();
    void this.tearDownClient("Controller disposed");
  }

  private handleAuthChange(e: AuthChangeEvent): void {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    void this.bindLatestServer.run();
  }

  private handleAssignmentsChange(e: AssignmentChangeEvent): void {
    // A "changed" server doesn't change the "latest" server.
    if (e.added.length === 0 && e.removed.length === 0) {
      return;
    }
    void this.bindLatestServer.run();
  }

  // Since calls to this method are bound to the LatestCancelable runner and
  // fire-and-forgotten, it's critical we check signal.aborted following all
  // async operations to avoid race conditions.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  private async connectToLatestServer(signal: AbortSignal) {
    if (!this.isAuthorized) {
      await this.tearDownClient("Unauthorized");
      return;
    }
    const server = await this.assignments.latestServer(signal);
    if (signal.aborted) {
      return;
    }
    if (!server) {
      await this.tearDownClient("No active server");
      return;
    }
    if (this.active?.server.endpoint === server.endpoint) {
      return;
    }

    await this.tearDownClient(`Switching to new server ${serverStr(server)}`);

    const client = new ColabLanguageClient(
      this.vs,
      server,
      this.vsLanguageClientFactory,
    );
    await client.start();
    if (signal.aborted) {
      await client.dispose();
      return;
    }
    this.active = { client, server };
    this.serverChangeEmitter.fire({ kind: "connected", server });
  }
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  private async tearDownClient(reason: string) {
    if (!this.active) {
      return;
    }
    const s = this.active.server;
    log.info(
      `Tearing down ColabLanguageClient for server ${serverStr(s)}: ${reason}`,
    );
    await this.active.client.dispose();
    this.active = undefined;
    this.serverChangeEmitter.fire({ kind: "disconnected", server: s });
  }
}

function serverStr(s: ColabAssignedServer) {
  return `"${s.label}" (${s.endpoint})`;
}
