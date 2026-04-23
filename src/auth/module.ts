/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import vscode, { Disposable, ExtensionContext } from 'vscode';
import { CONFIG } from '../colab-config';
import { PackageInfo } from '../config/package-info';
import { GoogleAuthProvider } from './auth-provider';
import { getOAuth2Flows } from './flows/flows';
import { login, LoginOptions } from './login';
import { AuthStorage } from './storage';

/** The result of activating the auth module. */
export interface AuthModule {
  /** The {@link GoogleAuthProvider} for downstream wiring. */
  readonly authProvider: GoogleAuthProvider;
  /** Disposables that should be pushed into `context.subscriptions`. */
  readonly disposables: Disposable[];
}

/**
 * Builds the {@link GoogleAuthProvider} and its supporting OAuth2 flow
 * components. The returned `disposables` should be pushed into
 * `context.subscriptions`.
 *
 * @param vs - The VS Code API instance.
 * @param context - The extension context (for `secrets` access).
 * @param packageInfo - Information about the installed extension.
 * @returns The auth provider and its associated disposables.
 */
export function createAuthModule(
  vs: typeof vscode,
  context: ExtensionContext,
  packageInfo: PackageInfo,
): AuthModule {
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlows = getOAuth2Flows(vs, packageInfo, authClient);
  const authProvider = new GoogleAuthProvider(
    vs,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[], options?: LoginOptions) =>
      login(vs, authFlows, authClient, scopes, options),
  );
  const flowsDisposable: Disposable = {
    dispose: () => {
      for (const flow of authFlows) {
        flow.dispose?.();
      }
    },
  };
  return {
    authProvider,
    disposables: [flowsDisposable, authProvider],
  };
}
