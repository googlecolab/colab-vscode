import {
  Credentials as OAuth2Credentials,
  OAuth2Client,
} from "google-auth-library";
import { v4 as uuid } from "uuid";
import vscode from "vscode";
import {
  OAuth2TriggerOptions,
  FlowResult,
  OAuth2FlowProvider,
} from "./flows/flows";

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
 */
export async function login(
  vs: typeof vscode,
  flowProvider: OAuth2FlowProvider,
  client: OAuth2Client,
  scopes: string[],
): Promise<Credentials> {
  const flows = flowProvider.getSupportedFlows();
  if (flows.length === 0) {
    throw new Error("No authentication flows available.");
  }

  for (const flow of flows) {
    try {
      if (flow !== flows[0] && !(await promptIfFallback(vs))) {
        break;
      }
      return await vs.window.withProgress<Credentials>(
        {
          location: vs.ProgressLocation.Notification,
          title: "Signing in to Google...",
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
    } catch (err) {
      const innerMsg = err instanceof Error ? err.message : "unknown error";
      const msg = `Sign-in attempt failed: ${innerMsg}.`;
      // Notify this attempt failed, but try other methods 🤞.
      vs.window.showErrorMessage(msg);
    } finally {
      flow.dispose?.();
    }
  }

  const msg =
    flows.length > 1
      ? "All authentication methods failed."
      : "Authentication failed.";
  throw new Error(msg);
}

async function promptIfFallback(vs: typeof vscode): Promise<boolean> {
  const yes = "Yes";
  const no = "No";
  const result = await vs.window.showErrorMessage(
    "Failed to authenticate with Google. Would you like to try a different authentication method?",
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
      : "unknown error";
    throw new Error(`Failed to get token: ${details}.`);
  }
  if (!isDefinedCredentials(tokenResponse.tokens)) {
    throw new Error("Missing credential information.");
  }
  return tokenResponse.tokens;
}

type RequiredCredentials = Pick<
  OAuth2Credentials,
  "refresh_token" | "access_token" | "expiry_date" | "scope"
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
