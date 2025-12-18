/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, EventEmitter } from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import { AssignmentChangeEvent, AssignmentManager } from '../assignments';
import { ProxiedJupyterClient } from '../client';
import { ContentsApi } from '../client/generated';

interface ServerConnection {
  contents: ContentsApi;
  dispose: () => void;
}

export class ServerNotFound extends Error {
  constructor(endpoint: string) {
    super(`Server corresponding to "${endpoint}" does not exist`);
  }
}

/**
 * Manages the lifecycle of Jupyter clients.
 *
 * Handles authentication, assignment changes, and connection pooling.
 */
export class JupyterConnectionManager implements Disposable {
  private readonly connections = new Map<string, Promise<ServerConnection>>();
  private readonly revokeConnectionEmitter: EventEmitter<string>;
  private isAuthorized = false;
  private isDisposed = false;
  private disposables: Disposable[] = [];

  /**
   * Fires when a server connection is revoked.
   *
   * A server connection is revoked when a an assignment is removed, or the user
   * logs out.
   */
  readonly onDidRevokeConnection: Event<string>;

  constructor(
    vs: typeof vscode,
    authEvent: Event<AuthChangeEvent>,
    private readonly assignments: AssignmentManager,
  ) {
    this.revokeConnectionEmitter = new vs.EventEmitter<string>();
    this.onDidRevokeConnection = this.revokeConnectionEmitter.event;
    const authChanges = authEvent(this.handleAuthChange.bind(this));
    const assignmentChanges = assignments.onDidAssignmentsChange(
      this.handleAssignmentChange.bind(this),
    );
    this.disposables.push(authChanges, assignmentChanges);
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const [_, promise] of this.connections) {
      bestEffortDisposeConnection(promise);
    }
    this.connections.clear();
    this.disposables = [];
  }

  /**
   * Gets the {@link ContentsApi} client for the provided endpoint, or undefined
   * if it has not been created.
   *
   * @param endpoint - The endpoint of the server to get the client for.
   * @returns {@link ContentsApi} client for the provided endpoint
   */
  async get(endpoint: string): Promise<ContentsApi | undefined> {
    this.guardDisposed();
    if (!this.isAuthorized) {
      throw new Error('Cannot get connections while unauthorized');
    }

    const promise = this.connections.get(endpoint);
    if (!promise) {
      return undefined;
    }

    return (await promise).contents;
  }

  /**
   * Gets or creates the {@link ContentsApi} client for the provided endpoint.
   *
   * @param endpoint - The endpoint of the server to get or create the client
   * for.
   * @returns The {@link ContentsApi} client for the provided endpoint.
   * @throws {@link ServerNotFound} when a server corresponding to the provided
   * endpoint is not found.
   */
  async getOrCreate(endpoint: string): Promise<ContentsApi> {
    this.guardDisposed();
    if (!this.isAuthorized) {
      throw new Error('Cannot get or create connections while unauthorized');
    }

    let connectionPromise = this.connections.get(endpoint);
    if (connectionPromise) {
      return (await connectionPromise).contents;
    }

    connectionPromise = this.createClient(endpoint);
    this.connections.set(endpoint, connectionPromise);

    try {
      const conn = await connectionPromise;
      return conn.contents;
    } catch (e) {
      // If initialization failed, clear the map so the next attempt can try
      // again
      this.connections.delete(endpoint);
      throw e;
    }
  }

  /**
   * Removes the {@link ContentsApi} client for the provided endpoint.
   *
   * @param endpoint - The endpoint of the server to remove the client of.
   * @param silent - When true, suppresses firing the
   * {@link JupyterConnectionManager.onDidRevokeConnection} event. Useful if the
   * caller has already updated the UI and does not need the event to fire
   * again.
   * @returns true if there was a connection which was removed, otherwise false.
   */
  drop(endpoint: string, silent = false): boolean {
    this.guardDisposed();
    if (!this.connections.has(endpoint)) {
      return false;
    }
    this.revoke(endpoint, silent);
    return true;
  }

  private guardDisposed() {
    if (!this.isDisposed) {
      return;
    }
    throw new Error(
      'JupyterConnectionManager cannot be used after it has been disposed.',
    );
  }

  private async createClient(endpoint: string): Promise<ServerConnection> {
    const servers = await this.assignments.getServers('extension');
    if (this.isDisposed) {
      throw new Error('JupyterConnectionManager is disposed');
    }
    const server = servers.find((s) => s.endpoint === endpoint);
    if (!server) {
      throw new ServerNotFound(endpoint);
    }
    const client = ProxiedJupyterClient.withRefreshingConnection(
      server,
      this.assignments.onDidAssignmentsChange,
    );

    return {
      contents: client.contents,
      dispose: () => {
        client.dispose();
      },
    };
  }

  private handleAuthChange(e: AuthChangeEvent) {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    if (!this.isAuthorized) {
      this.revokeAll();
    }
  }

  private handleAssignmentChange(e: AssignmentChangeEvent) {
    for (const s of e.removed) {
      this.revoke(s.server.endpoint);
    }
  }

  private revokeAll() {
    for (const endpoint of this.connections.keys()) {
      this.revoke(endpoint);
    }
  }

  private revoke(endpoint: string, silent = false) {
    const promise = this.connections.get(endpoint);
    if (!promise) {
      return;
    }
    bestEffortDisposeConnection(promise);
    this.connections.delete(endpoint);
    if (!silent) {
      this.revokeConnectionEmitter.fire(endpoint);
    }
  }
}

function bestEffortDisposeConnection(promise: Promise<ServerConnection>): void {
  promise.then(
    (c) => {
      try {
        c.dispose();
      } catch {
        // Ignore errors during disposal.
      }
    },
    () => {
      // Ignore errors from failed connection attempts.
    },
  );
}
