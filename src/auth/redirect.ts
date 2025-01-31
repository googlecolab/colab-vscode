import vscode from "vscode";

const EXCHANGE_TIMEOUT_MS = 60_000;

/**
 * Provides authentication codes.
 */
export interface CodeProvider {
  waitForCode(nonce: string, token: vscode.CancellationToken): Promise<string>;
}

interface InFlightPromise {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (reason?: Error) => void;
}

/**
 * Waits for authentication codes obtained through redirect URIs.
 */
export class RedirectUriCodeProvider
  implements CodeProvider, vscode.UriHandler
{
  private readonly inFlightPromises = new Map<string, InFlightPromise>();

  /**
   * Waits for an authorization code corresponding to the provided nonce.
   *
   * A nonce can be used once to wait for a code.
   *
   * @param nonce - A unique string to correlate the request and response.
   * @param token - A cancellation token used to cancel the request.
   * @returns A promise to resolve the authorization code.
   */
  async waitForCode(
    nonce: string,
    token: vscode.CancellationToken,
  ): Promise<string> {
    if (this.inFlightPromises.has(nonce)) {
      throw new Error(`Already waiting for nonce: ${nonce}`);
    }

    const { promise, resolve, reject } = createPromiseHandlers<string>();
    this.inFlightPromises.set(nonce, { promise, resolve, reject });

    try {
      return await Promise.race([
        promise,
        waitForCancellation(token),
        waitForExchangeTimeout(),
      ]);
    } catch (err: unknown) {
      if (err instanceof Error) {
        reject(err);
      } else {
        reject(new Error("Unknown error occurred"));
      }
      throw err;
    } finally {
      this.inFlightPromises.delete(nonce);
    }
  }

  /**
   * Resolves the in-flight promise corresponding to the provided URI.
   *
   * @param uri - The URI containing the query parameters for nonce and code.
   */
  handleUri(uri: vscode.Uri): void {
    const params = new URLSearchParams(uri.query);
    const nonce = params.get("nonce");
    const code = params.get("code");

    if (!nonce || !code) {
      throw new Error("Missing nonce or code in redirect URI");
    }

    const inFlight = this.inFlightPromises.get(nonce);
    if (!inFlight) {
      throw new Error("Unexpected code exchange received");
    }

    inFlight.resolve(code);
  }
}

/**
 * Creates a new promise with manual resolve/reject handlers.
 */
function createPromiseHandlers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Creates a promise that rejects when the cancellation token is triggered.
 */
function waitForCancellation(token: vscode.CancellationToken): Promise<never> {
  return new Promise<never>((_, reject) =>
    token.onCancellationRequested(() => {
      reject(new Error("Operation cancelled by the user"));
    }),
  );
}

/**
 * Creates a promise that rejects after the exchange timeout.
 */
function waitForExchangeTimeout(): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(() => {
      reject(new Error("Exchange timeout exceeded"));
    }, EXCHANGE_TIMEOUT_MS),
  );
}
