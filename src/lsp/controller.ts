/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from "vscode";
import { log } from "../common/logging";
import { AsyncToggleable } from "../common/toggleable";
import { AssignmentManager } from "../jupyter/assignments";
import { ColabLanguageClient, LanguageClientFactory } from "./language-client";

/**
 * Manages the lifecycle of a LanguageClient connected to the latest assigned
 * Colab server.
 */
export class LanguageClientController extends AsyncToggleable<Disposable> {
  private client: ColabLanguageClient | undefined;
  private latestServerEndpoint: string;
  private abortController = new AbortController();

  constructor(
    private vs: typeof vscode,
    private readonly assignments: AssignmentManager,
    private readonly vsLanguageClientFactory: LanguageClientFactory,
  ) {
    super();
  }

  override async initialize(signal: AbortSignal): Promise<Disposable> {
    // signal will be aborted when the Toggleable is turned off.
    signal.onabort = (e) => {
      this.abortController.abort(e);
    };
    const listenDispose = this.assignments.onDidAssignmentsChange(async (e) => {
      if (
        e.added.length ||
        e.removed.some((s) => {
          return s.server.endpoint === this.latestServerEndpoint;
        })
      ) {
        // Abort any in-flight work from the last call.
        this.abortController.abort();
        await this.tearDownClient("Server removed");
      } else {
        // Don't care about updated server lists, or servers being
        // removed that we weren't connected to.
        return;
      }
      this.abortController = new AbortController();
      await this.connectToLatest(this.abortController.signal);
    });
    await this.connectToLatest(this.abortController.signal);
    return {
      dispose: () => {
        listenDispose.dispose();
        void this.tearDownClient("Toggled off");
      },
    };
  }

  private async connectToLatest(signal?: AbortSignal): Promise<void> {
    const latestServer = await this.assignments.latestServer(signal);
    if (!latestServer) {
      await this.tearDownClient("No assigned servers");
      return;
    }
    // Don't make a new client if the latest runtime has not changed.
    if (latestServer.endpoint === this.latestServerEndpoint) {
      return;
    }
    await this.tearDownClient("Newer runtime found");
    this.latestServerEndpoint = latestServer.endpoint;
    if (signal?.aborted) {
      return;
    }
    this.latestServerEndpoint = latestServer.endpoint;
    this.client = new ColabLanguageClient(
      this.vs,
      latestServer,
      this.vsLanguageClientFactory,
    );
    await this.client.start();
    return;
  }

  private async tearDownClient(reason: string) {
    if (!this.client) {
      return;
    }
    log.info(
      `Tearing down LanguageClient for endpoint ${this.latestServerEndpoint}: ${reason}`,
    );
    await this.client.dispose();
    this.client = undefined;
    this.latestServerEndpoint = "";
  }
}
