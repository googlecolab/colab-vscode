/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { PackageInfo } from '../config/package-info';

/**
 * Builds the extension URI that can be used to redirect users back to VS Code,
 * to the extension's registered URI handler.
 *
 * @param vs - The VS Code API instance.
 * @param packageInfo - Information about the extension package.
 * @returns The extension URI as a string.
 */
export function buildExtensionUri(
  vs: typeof vscode,
  packageInfo: PackageInfo,
): string {
  {
    const scheme = vs.env.uriScheme;
    const pub = packageInfo.publisher;
    const name = packageInfo.name;
    return `${scheme}://${pub}.${name}`;
  }
}

/**
 * A {@link vscode.UriHandler} for handling custom URI events within the
 * extension.
 *
 * This class can be registered to process URIs that are directed to the
 * extension, enabling deep-linking and custom command execution via URI
 * activation.
 *
 * @see https://code.visualstudio.com/api/references/vscode-api#UriHandler
 */
export class ExtensionUriHandler
  implements vscode.UriHandler, vscode.Disposable
{
  /**
   * An event that subscribes the listener to {@link vscode.Uri} invocations to
   * the extension.
   */
  readonly onReceivedUri: vscode.Event<vscode.Uri>;
  private readonly uriEmitter: vscode.EventEmitter<vscode.Uri>;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   */
  constructor(vs: typeof vscode) {
    this.uriEmitter = new vs.EventEmitter<vscode.Uri>();
    this.onReceivedUri = this.uriEmitter.event;
  }

  /**
   * Disposes the handler.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.uriEmitter.dispose();
  }

  /**
   * Emits a {@link vscode.Uri} event when a URI is handled.
   *
   * Callers can call {@link onReceivedUri} to listen for these events.
   *
   * @param uri - The URI of the resource.
   */
  handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    this.guardDisposed();
    this.uriEmitter.fire(uri);
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ExtensionUriHandler after it has been disposed',
      );
    }
  }
}

/**
 * A handler for a URI matched by its path component.
 */
export type UriRouteHandler = (uri: vscode.Uri) => void;

/**
 * A map from a URI path (without the leading `/`) to its handler.
 */
export type UriRoutes = ReadonlyMap<string, UriRouteHandler>;

/**
 * Subscribes route handlers to the given URI event. The path of each incoming
 * URI is matched against the keys of `routes` (without the leading `/`); the
 * matching handler is invoked, if any. Unmatched URIs are ignored.
 *
 * @param onReceivedUri - The event source from the extension URI handler.
 * @param routes - A map from URI path to handler.
 * @returns A disposable that unsubscribes the listener.
 */
export function registerUriRoutes(
  onReceivedUri: vscode.Event<vscode.Uri>,
  routes: UriRoutes,
): vscode.Disposable {
  return onReceivedUri((uri) => {
    const path = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    routes.get(path)?.(uri);
  });
}
