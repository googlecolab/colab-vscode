/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An HTTP header key.
 */
export interface Header {
  /**
   * The name of the header.
   */
  readonly key: string;
}

/**
 * An HTTP header with a key and static value.
 */
export interface StaticHeader extends Header {
  /**
   * The value of the header.
   */
  readonly value: string;
}

/**
 * The HTTP header for JSON content type.
 */
export const CONTENT_TYPE_JSON_HEADER: StaticHeader = {
  key: 'Content-Type',
  value: 'application/json',
};

/**
 * The HTTP header for accepting JSON.
 */
export const ACCEPT_JSON_HEADER: StaticHeader = {
  key: 'Accept',
  value: 'application/json',
};

/**
 * The HTTP header for the Colab client agent used for requests originating from
 * VS Code.
 */
export const COLAB_CLIENT_AGENT_HEADER: StaticHeader = {
  key: 'X-Colab-Client-Agent',
  value: 'vscode',
};

/**
 * The HTTP header for requests that are resolved through the Colab tunnel.
 */
export const COLAB_TUNNEL_HEADER: StaticHeader = {
  key: 'X-Colab-Tunnel',
  value: 'Google',
};

/**
 * The HTTP header for the authorization token.
 */
export const AUTHORIZATION_HEADER: Header = {
  key: 'Authorization',
};

/**
 * The HTTP header for the Colab runtime proxy token.
 */
export const COLAB_RUNTIME_PROXY_TOKEN_HEADER: Header = {
  key: 'X-Colab-Runtime-Proxy-Token',
};

/**
 * The HTTP header for the Colab XSRF token.
 */
export const COLAB_XSRF_TOKEN_HEADER: Header = {
  key: 'X-Goog-Colab-Token',
};
