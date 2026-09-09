/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Credentials as OAuth2Credentials,
  OAuth2Client,
} from 'google-auth-library';
import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import { isCancellation, UserCancelledError } from '../common/cancellation';
import { log } from '../common/logging';
import { telemetry } from '../telemetry';
import { AuthFlow } from '../telemetry/api';
import { OAuth2TriggerOptions, FlowResult, OAuth2Flow } from './flows/flows';
import { LocalServerFlow } from './flows/loopback';
import { ProxiedRedirectFlow } from './flows/proxied';

/**
 * Options for logging in.
 */
export interface LoginOptions {
  /**
   * Whether to include previously granted scopes in the authentication
   * request. Used to support incremental authorization.
   */
  includeGrantedScopes?: boolean;
  /**
   * A hint to identify the user to be authenticated. Used to pre-fill the
   * email field in the authentication UI for incremental authorization.
   */
  loginHint?: string;
}

/**
 * A complete set of credentials produced from completing OAuth2 authentication.
 */
export type Credentials = OAuth2Credentials & {
  [P in keyof RequiredCredentials]-?: NonNullable<RequiredCredentials[P]>;
};

/**
 * Manages the login process for Google OAuth2 authentication.
 *
 * Since logging in involves users leaving the editor to complete a
 * browser-based sign-in, there's some natural flake! Both at the user and code
 * level. A user could accidentally close a tab, the browser could crash, etc.
 * Beyond that, the user could have a bizarre network configuration, preventing
 * the extension from launching the loopback server. Due to all this "flake", we
 * attempt several flows depending on the environment capabilities (e.g. it's
 * not possible to launch a loopback server in a remote extension host).
 *
 * Nothing is reported to the user here beyond the offer of another method. The
 * thrown error carries every attempt's reason, and telling the user is the
 * caller's to do once, rather than this doing it per attempt.
 *
 * @param vs - The VS Code API instance.
 * @param flows - The authentication flows manager.
 * @param client - The API client instance.
 * @param scopes - The requested OAuth scopes.
 * @param options - Optional login options.
 * @returns The obtained credentials upon successful authentication.
 * @throws AggregateError carrying every attempt's error if the attempts failed,
 * or a {@link UserCancelledError} if the user abandoned them all.
 */
export async function login(
  vs: typeof vscode,
  flows: OAuth2Flow[],
  client: OAuth2Client,
  scopes: string[],
  options?: LoginOptions,
): Promise<Credentials> {
  if (flows.length === 0) {
    throw new Error('No authentication flows available.');
  }

  const attemptErrors: Error[] = [];
  for (const flow of flows) {
    const previous = attemptErrors.at(-1);
    if (previous && !(await promptIfFallback(vs, isCancellation(previous)))) {
      break;
    }
    let success = false;
    try {
      const res = await vs.window.withProgress<Credentials>(
        {
          location: vs.ProgressLocation.Notification,
          title: 'Signing in to Google...',
          cancellable: true,
        },
        async (_, cancel: vscode.CancellationToken) => {
          const nonce = uuid();
          const pkce = await client.generateCodeVerifierAsync();
          const triggerOptions: OAuth2TriggerOptions = {
            cancel,
            nonce,
            scopes,
            pkceChallenge: pkce.codeChallenge,
            includeGrantedScopes: options?.includeGrantedScopes,
            loginHint: options?.loginHint,
            prompt: !options?.includeGrantedScopes ? 'consent' : undefined,
          };
          const flowResult = await flow.trigger(triggerOptions);
          const res = await exchangeCodeForCredentials(
            client,
            flowResult,
            pkce.codeVerifier,
          );

          return res;
        },
      );
      success = true;
      return res;
    } catch (err: unknown) {
      // Reporting each attempt talks over the fallback prompt below, and then
      // over the caller's report of the whole failure, which already carries
      // every reason. Collect them and stay quiet.
      attemptErrors.push(toError(err));
    } finally {
      logSignIn(flow, success);
    }
  }

  throw buildLoginError(attemptErrors);
}

/**
 * Builds the error describing why login never produced credentials.
 *
 * An attempt the user cancelled is not a defect, so a run in which nothing
 * genuinely failed is reported as a cancellation. Anything else carries every
 * attempt's error.
 *
 * @param attemptErrors - The error from each attempted flow, in order.
 * @returns The error to throw from {@link login}.
 */
function buildLoginError(attemptErrors: Error[]): Error {
  const failures = attemptErrors.filter((e) => !isCancellation(e));
  if (failures.length === 0) {
    return new UserCancelledError('Sign-in was cancelled.', {
      cause: attemptErrors[0],
    });
  }
  const msg =
    attemptErrors.length > 1
      ? 'All authentication methods failed.'
      : 'Authentication failed.';
  return new AggregateError(attemptErrors, msg);
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Asks whether to try the next authentication flow.
 *
 * @param vs - The VS Code API instance.
 * @param cancelled - Whether the previous attempt was abandoned by the user
 * rather than failing. Telling someone who just pressed Cancel that
 * authentication failed is both wrong and alarming.
 * @returns True when the user wants to try another method.
 */
async function promptIfFallback(
  vs: typeof vscode,
  cancelled: boolean,
): Promise<boolean> {
  const question = 'Would you like to try a different authentication method?';
  const yes = 'Yes';
  const no = 'No';
  const result = cancelled
    ? await vs.window.showInformationMessage(question, yes, no)
    : await vs.window.showErrorMessage(
        `Failed to authenticate with Google. ${question}`,
        yes,
        no,
      );
  return result === yes;
}

async function exchangeCodeForCredentials(
  oAuth2Client: OAuth2Client,
  flowResult: FlowResult,
  pkceVerifier: string,
) {
  const tokenResponse = await oAuth2Client.getToken({
    code: flowResult.code,
    codeVerifier: pkceVerifier,
    redirect_uri: flowResult.redirectUri,
  });
  if (tokenResponse.res?.status !== 200) {
    const details = tokenResponse.res
      ? tokenResponse.res.statusText
      : 'unknown error';
    throw new Error(`Failed to get token: ${details}.`);
  }
  if (!isDefinedCredentials(tokenResponse.tokens)) {
    throw new Error('Missing credential information.');
  }
  return tokenResponse.tokens;
}

type RequiredCredentials = Pick<
  OAuth2Credentials,
  'refresh_token' | 'access_token' | 'expiry_date' | 'scope'
>;

function isDefinedCredentials(
  credentials: OAuth2Credentials,
): credentials is Credentials {
  return (
    credentials.refresh_token != null &&
    credentials.access_token != null &&
    credentials.expiry_date != null &&
    credentials.scope != null
  );
}

function logSignIn(flow: OAuth2Flow, succeeded: boolean) {
  let f: AuthFlow;
  if (flow instanceof LocalServerFlow) {
    f = AuthFlow.AUTH_FLOW_LOOPBACK;
  } else if (flow instanceof ProxiedRedirectFlow) {
    f = AuthFlow.AUTH_FLOW_PROXIED_REDIRECT;
  } else {
    log.error(`Unknown auth flow type: ${flow.constructor.name}`);
    f = AuthFlow.AUTH_FLOW_UNSPECIFIED;
  }
  telemetry.logSignIn(f, succeeded);
}
