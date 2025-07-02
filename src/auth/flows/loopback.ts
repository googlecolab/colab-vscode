import assert from "assert";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { LoopbackHandler, LoopbackServer } from "../../common/loopback-server";
import { CodeManager } from "../code-manager";
import {
  DEFAULT_AUTH_URL_OPTS,
  OAuth2Flow,
  OAuth2EnvCapabilities,
  OAuth2TriggerOptions,
  FlowResult,
} from "./flows";

/**
 * An OAuth2 flow that uses a local server to handle the redirect URI.
 */
export class LocalServerFlow implements OAuth2Flow {
  options: OAuth2EnvCapabilities = {
    // Opening a port on the remote side can't be opened in the browser on
    // the client side so this flow doesn't work in remote extension hosts.
    supportsRemoteExtensionHost: false,
    // A Web Worker can't open a port to listen for the redirect.
    supportsWebWorkerExtensionHost: false,
  };

  private readonly handler: Handler;
  private readonly codeManager = new CodeManager();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly vs: typeof vscode,
    private readonly serveRoot: string,
    private readonly oAuth2Client: OAuth2Client,
  ) {
    this.handler = new Handler(this.serveRoot, this.codeManager);
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  /**
   * Trigger the OAuth2 flow by opening a local server to listen for the
   * redirect URI. Callers are expected to dispose the returned disposable when
   * the full flow is complete. It is their responsibility since this flow is
   * expected to serve assets until fully completed (for e.g., the favicon).
   */
  async trigger(options: OAuth2TriggerOptions): Promise<FlowResult> {
    const code = this.codeManager.waitForCode(options.nonce, options.cancel);
    const server = new LoopbackServer(this.handler);
    this.disposables.push(server);
    try {
      options.cancel.onCancellationRequested(server.dispose.bind(server));
      const port = await server.start();
      const address = `http://127.0.0.1:${port.toString()}`;
      const authUrl = this.oAuth2Client.generateAuthUrl({
        ...DEFAULT_AUTH_URL_OPTS,
        redirect_uri: address,
        state: `nonce=${options.nonce}`,
        scope: options.scopes,
        code_challenge: options.pkceChallenge,
      });

      await this.vs.env.openExternal(this.vs.Uri.parse(authUrl));
      return {
        code: await code,
        redirectUri: address,
      };
    } catch (err: unknown) {
      server.dispose();
      throw err;
    }
  }
}

class Handler implements LoopbackHandler {
  constructor(
    private readonly serveRoot: string,
    private readonly codeProvider: CodeManager,
  ) {}

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // URL and Host are only missing on malformed requests.
    assert(req.url);
    assert(req.headers.host);
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" });
      res.end("Method Not Allowed");
      return;
    }
    switch (url.pathname) {
      case "/": {
        const state = url.searchParams.get("state");
        if (!state) {
          throw new Error("Missing state in redirect URL");
        }
        const parsedState = new URLSearchParams(state);
        const nonce = parsedState.get("nonce");
        const code = url.searchParams.get("code");
        if (!nonce || !code) {
          throw new Error("Missing nonce or code in redirect URI");
        }
        this.codeProvider.resolveCode(nonce, code);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("You may now return to the application.");
        break;
      }
      case "/favicon.ico": {
        const assetPath = url.pathname.substring(1);
        sendFile(res, path.join(this.serveRoot, assetPath));
        break;
      }
      default: {
        console.warn("Received unhandled request: ", req);
        res.writeHead(404);
        res.end("Not Found");
        break;
      }
    }
  }
}

function sendFile(res: http.ServerResponse, filepath: string): void {
  fs.readFile(filepath, (err, body) => {
    if (err) {
      console.error(err);
      res.writeHead(500);
      res.end("Internal Server Error");
    } else {
      res.setHeader("content-length", body.length);
      res.writeHead(200);
      res.end(body);
    }
  });
}
