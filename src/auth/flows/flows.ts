import path from "path";
import { CodeChallengeMethod, GenerateAuthUrlOpts } from "google-auth-library";
import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { PackageInfo } from "../../config/package-info";
import { ExtensionUriHandler } from "../../system/uri-handler";
import { LocalServerFlow } from "./loopback";
import { ProxiedRedirectFlow } from "./proxied";

/**
 * Describes the environmental capabilities of an OAuth2 flow.
 *
 * This interface is used to determine whether a specific OAuth2 flow can be
 * used in a given environment, such as a web worker or remote extension host.
 */
export interface OAuth2EnvCapabilities {
  readonly supportsWebWorkerExtensionHost: boolean;
  readonly supportsRemoteExtensionHost: boolean;
}

/**
 * Options for triggering an OAuth2 flow.
 */
export interface OAuth2TriggerOptions {
  /** Fired when the flow should be cancelled. */
  readonly cancel: vscode.CancellationToken;
  /** A unique nonce to correlate the request and response. */
  readonly nonce: string;
  /** The scopes the flow should authorize for. */
  readonly scopes: string[];
  /** The PKCE challenge string which if specific should be included with the auth request. */
  readonly pkceChallenge?: string;
}

export interface FlowResult {
  /** The authorization code obtained from the OAuth2 flow. */
  code: string;
  /** The redirect URI that should be used following token retrieval. */
  redirectUri?: string;
}

/**
 * An OAuth2 flow that can be triggered to obtain an authorization code.
 */
export interface OAuth2Flow {
  /** Describes the environmental capabilities of the flow. */
  options: OAuth2EnvCapabilities;
  /** Triggers the OAuth2 flow. */
  trigger(options: OAuth2TriggerOptions): Promise<FlowResult>;
  /** Disposes of the flow and cleans up resources. */
  dispose?(): void;
}

export const DEFAULT_AUTH_URL_OPTS: GenerateAuthUrlOpts = {
  access_type: "offline",
  response_type: "code",
  prompt: "consent",
  code_challenge_method: CodeChallengeMethod.S256,
};

/**
 * Provides OAuth2 flows for the extension.
 */
export class OAuth2FlowProvider {
  constructor(
    private readonly vs: typeof vscode,
    private readonly packageInfo: PackageInfo,
    private readonly extensionUriHandler: ExtensionUriHandler,
    private readonly oAuth2Client: OAuth2Client,
  ) {}

  // TODO: Look at environment capabilities and filter flows accordingly.
  getSupportedFlows(): OAuth2Flow[] {
    return [
      new LocalServerFlow(
        this.vs,
        path.join(__dirname, "auth/media"),
        this.oAuth2Client,
      ),
      new ProxiedRedirectFlow(
        this.vs,
        this.packageInfo,
        this.oAuth2Client,
        this.extensionUriHandler,
      ),
    ];
  }
}
