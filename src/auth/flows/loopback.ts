/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "assert";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { CONTENT_TYPE_TEXT_HEADER } from "../../colab/headers";
import { LoopbackHandler, LoopbackServer } from "../../common/loopback-server";
import { CodeManager } from "../code-manager";
import {
  DEFAULT_AUTH_URL_OPTS,
  OAuth2Flow,
  OAuth2TriggerOptions,
  FlowResult,
} from "./flows";

/**
 * An OAuth2 flow that uses a local server to handle the redirect URI.
 *
 * Since the flow when triggered spins up a local server to handle the redirect,
 * the {@link FlowResult} returns a `dispose` method. This is needed since the
 * endpoint should continue to serve assets like the favicon after the initial
 * trigger. Only when the login flow is complete are we "done" with the server.
 *
 * Since it's possible we'd want to dispose this class while there are in-flight
 * triggered flows, the {@link LocalServerFlow} is disposable and will clean-up
 * any owned servers from outstanding flows.
 */
export class LocalServerFlow implements OAuth2Flow, vscode.Disposable {
  private readonly codeManager = new CodeManager();
  private readonly handler: Handler;
  private readonly activeServers = new Set<vscode.Disposable>();

  constructor(
    private readonly vs: typeof vscode,
    private readonly serveRoot: string,
    private readonly oAuth2Client: OAuth2Client,
  ) {
    this.handler = new Handler(this.serveRoot, this.codeManager);
  }

  dispose() {
    this.codeManager.dispose();
    for (const disposable of this.activeServers) {
      disposable.dispose();
    }
    this.activeServers.clear();
  }

  /**
   * Trigger the OAuth2 flow by opening a local server to listen for the
   * redirect URI. Callers are expected to dispose the returned disposable when
   * the full flow is complete. It is their responsibility since this flow is
   * expected to serve assets until fully completed (for e.g., the favicon).
   */
  async trigger(options: OAuth2TriggerOptions): Promise<FlowResult> {
    const server = new LoopbackServer(this.handler);
    this.activeServers.add(server);
    try {
      const code = this.codeManager.waitForCode(options.nonce, options.cancel);
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
      // TODO: We can't dispose of the server immediately since the favicon is
      // loaded asynchronously. Following a successful flow result (here), we
      // should TTL disposing of the server. It'll get cleaned up when the flow
      // is disposed, so not crucial to add now.
      return {
        code: await code,
        redirectUri: address,
      };
    } catch (err: unknown) {
      server.dispose();
      this.activeServers.delete(server);
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
        res.writeHead(200, {
          [CONTENT_TYPE_TEXT_HEADER.key]: CONTENT_TYPE_TEXT_HEADER.value,
        });
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
