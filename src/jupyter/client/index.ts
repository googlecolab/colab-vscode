/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Uri, Event, Disposable } from 'vscode';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../../colab/headers';
import { AssignmentChangeEvent } from '../assignments';
import { ColabAssignedServer } from '../servers';
import {
  Configuration,
  ConfigApi,
  ContentsApi,
  IdentityApi,
  KernelsApi,
  KernelspecsApi,
  SessionsApi,
  StatusApi,
  TerminalsApi,
  Middleware,
  FetchParams,
  RequestContext,
} from './generated';

/**
 * The Jupyter Server API Client.
 */
export interface JupyterClient {
  readonly config: ConfigApi;
  readonly contents: ContentsApi;
  readonly identity: IdentityApi;
  readonly kernels: KernelsApi;
  readonly kernelspecs: KernelspecsApi;
  readonly sessions: SessionsApi;
  readonly status: StatusApi;
  readonly terminals: TerminalsApi;
}

/**
 * Creates a client for interacting with the Jupyter Server API via the Colab
 * proxy.
 */
export class ProxiedJupyterClient implements JupyterClient {
  private configApi: ConfigApi | undefined;
  private contentsApi: ContentsApi | undefined;
  private identityApi: IdentityApi | undefined;
  private kernelsApi: KernelsApi | undefined;
  private kernelspecsApi: KernelspecsApi | undefined;
  private sessionsApi: SessionsApi | undefined;
  private statusApi: StatusApi | undefined;
  private terminalsApi: TerminalsApi | undefined;
  private clientConfig: Configuration;

  protected constructor(
    basePath: string | Uri,
    getProxyToken: () => Promise<string>,
  ) {
    this.clientConfig = new Configuration({
      basePath: basePath.toString(),
      headers: {
        [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
      },
      middleware: [new AddProxyToken(getProxyToken)],
    });
  }

  get config() {
    return (this.configApi ??= new ConfigApi(this.clientConfig));
  }

  get contents() {
    return (this.contentsApi ??= new ContentsApi(this.clientConfig));
  }

  get identity() {
    return (this.identityApi ??= new IdentityApi(this.clientConfig));
  }

  get kernels() {
    return (this.kernelsApi ??= new KernelsApi(this.clientConfig));
  }

  get kernelspecs() {
    return (this.kernelspecsApi ??= new KernelspecsApi(this.clientConfig));
  }

  get sessions() {
    return (this.sessionsApi ??= new SessionsApi(this.clientConfig));
  }

  get status() {
    return (this.statusApi ??= new StatusApi(this.clientConfig));
  }

  get terminals() {
    return (this.terminalsApi ??= new TerminalsApi(this.clientConfig));
  }

  /**
   * Initializes a {@link ProxiedJupyterClient} with static connection
   * information corresponding to the provided server. In other words, the proxy
   * token is used on all requests and is not refreshed.
   *
   * @param server - The Colab server to connect to.
   * @returns a {@link ProxiedJupyterClient} to the specified server.
   */
  static withStaticConnection(server: ColabAssignedServer): JupyterClient {
    return new ProxiedJupyterClient(server.connectionInformation.baseUrl, () =>
      Promise.resolve(server.connectionInformation.token),
    );
  }

  /**
   * Initializes a {@link ProxiedJupyterClient} with refreshable connection
   * information corresponding to the provided server. In other words, the
   * client listens to server token changes and uses the latest token on each
   * request.
   *
   * Callers should call `dispose` when the proxied connection no longer needs
   * refreshing.
   *
   * If the server is removed while the client is still alive, it will be
   * disposed. In other words, the last known token will be used but subsequent
   * calls will likely error (404).
   *
   * @param server - The Colab server to connect to.
   * @returns a {@link ProxiedJupyterClient} to the specified server.
   */
  static withRefreshingConnection(
    server: ColabAssignedServer,
    changes: Event<AssignmentChangeEvent>,
  ): JupyterClient & Disposable {
    return new RefreshingClient(server, changes);
  }
}

class RefreshingClient extends ProxiedJupyterClient implements Disposable {
  private changeListener: Disposable;
  private endpoint: string;
  private token: string;

  constructor(
    server: ColabAssignedServer,
    changes: Event<AssignmentChangeEvent>,
  ) {
    const baseUrl = server.connectionInformation.baseUrl.toString();
    super(baseUrl, () => Promise.resolve(this.token));
    this.endpoint = server.endpoint;
    this.token = server.connectionInformation.token;
    this.changeListener = changes((e) => {
      if (e.removed.find((s) => s.server.endpoint === this.endpoint)) {
        this.dispose();
        return;
      }
      if (!e.changed.length) {
        return;
      }
      e.changed
        .filter((s) => s.endpoint === this.endpoint)
        .forEach((s) => (this.token = s.connectionInformation.token));
    });
  }

  dispose() {
    this.changeListener.dispose();
  }
}

class AddProxyToken implements Middleware {
  constructor(private readonly getToken: () => Promise<string>) {}

  async pre(context: RequestContext): Promise<FetchParams> {
    const h = new Headers(context.init.headers);
    const t = await this.getToken();
    h.set(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key, t);
    context.init.headers = h;
    return context;
  }
}
