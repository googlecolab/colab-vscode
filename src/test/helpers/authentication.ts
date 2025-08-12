/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";

/**
 * A fake implementation to back the `vscode.authentication` API.
 *
 * This implementation is not a complete mock of the API, but rather a
 * simplified version that is sufficient for testing purposes.
 */
export class FakeAuthenticationProviderManager {
  private providers = new Map<string, vscode.AuthenticationProvider>();
  private disposables = new Map<string, vscode.Disposable>();

  /**
   * Register an authentication provider.
   *
   * There can only be one provider per ID and an error is being thrown when an
   * ID has already been used by another provider. IDs are case-sensitive.
   *
   * @returns A {@link Disposable} that un-registers this provider when being
   * disposed.
   */
  registerAuthenticationProvider(
    id: string,
    _label: string,
    provider: vscode.AuthenticationProvider,
  ): vscode.Disposable {
    if (this.providers.has(id)) {
      throw new Error(
        `An authentication provider with id "${id}" is already registered.`,
      );
    }
    const disposable = {
      dispose: () => {
        this.providers.delete(id);
        this.disposables.delete(id);
      },
    };
    this.providers.set(id, provider);
    this.disposables.set(id, disposable);
    return disposable;
  }

  /**
   * Get an authentication session for the given provider ID and scopes.
   *
   * This fake implementation differs from the real one in a couple ways:
   *
   * - It does not check if the user has consented to sharing authentication
   *   information with the extension.
   * - It throws if there are multiple sessions with the same scopes, instead of
   *   letting the user select from a quickpick which account they would like to
   *   use.
   *
   * Otherwise, it works the same as the real implementation.
   */
  async getSession(
    providerId: string,
    scopes: readonly string[],
    // Cover all of the overloads.
    options?:
      | (vscode.AuthenticationGetSessionOptions & {
          createIfNone: boolean | undefined;
        })
      | (vscode.AuthenticationGetSessionOptions & {
          forceNewSession:
            | true
            | vscode.AuthenticationGetSessionPresentationOptions;
        })
      | vscode.AuthenticationGetSessionOptions,
  ): Promise<vscode.AuthenticationSession> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`No provider registered for id: ${providerId}`);
    }
    const sessionOptions = options ?? {};
    let sessions = await provider.getSessions(scopes, sessionOptions);

    if (sessions.length === 0) {
      await provider.createSession(scopes, sessionOptions);
      sessions = await provider.getSessions(scopes, sessionOptions);
    }

    if (sessions.length > 1) {
      throw new Error(
        "The fake implementation for getSession does not support multiple sessions",
      );
    }

    if (sessions.length !== 1) {
      throw new Error(
        "The provider failed to create a session for the requested scopes",
      );
    }

    return sessions[0];
  }
}

/**
 * A custom Sinon matcher object that verifies a vscode.Uri against the
 * expected structure of a Google OAuth2 authentication URL.
 */
export function authUriMatch(
  redirectUri: string,
  stateParam: RegExp,
  scopes: string[],
) {
  return {
    errors: [] as string[],

    test: function (uri: vscode.Uri | string): boolean {
      this.errors = [];

      try {
        const urlString = uri.toString();
        const parsedUrl = new URL(urlString);
        const params = parsedUrl.searchParams;

        if (parsedUrl.protocol !== "https:") {
          this.errors.push(
            `Expected protocol "https:", but got "${parsedUrl.protocol}"`,
          );
        }
        if (parsedUrl.hostname !== "accounts.google.com") {
          this.errors.push(
            `Expected hostname "accounts.google.com", but got "${parsedUrl.hostname}"`,
          );
        }
        if (parsedUrl.pathname !== "/o/oauth2/v2/auth") {
          this.errors.push(
            `Expected pathname "/o/oauth2/v2/auth", but got "${parsedUrl.pathname}"`,
          );
        }

        const expectedParams: Record<string, string> = {
          access_type: "offline",
          response_type: "code",
          prompt: "consent",
          code_challenge_method: "S256",
          redirect_uri: redirectUri,
          scope: scopes.join(" "),
        };

        for (const key in expectedParams) {
          const actual = params.get(key);
          const expected = expectedParams[key];
          if (actual !== expected) {
            this.errors.push(
              `For param "${key}", expected "${expected}", but got "${actual ?? ""}"`,
            );
          }
        }

        const requiredDynamicParams = ["state", "code_challenge", "client_id"];
        for (const key of requiredDynamicParams) {
          if (!params.has(key)) {
            this.errors.push(`Missing required dynamic param: "${key}"`);
          }
        }

        const state = params.get("state");
        if (!state || !stateParam.test(state)) {
          this.errors.push(
            `State param should match "${stateParam.source}", but got "${state ?? ""}"`,
          );
        }
      } catch (error) {
        this.errors.push(`URL parsing failed: ${(error as Error).message}`);
      }

      return this.errors.length === 0;
    },

    toString: function (): string {
      if (this.errors.length > 0) {
        return `The following issues were found:\n  - ${this.errors.join("\n  - ")}`;
      }
      return "a valid Google Auth URL";
    },
  };
}
