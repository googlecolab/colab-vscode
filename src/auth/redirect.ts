import vscode from "vscode";

const EXCHANGE_TIMEOUT_MS = 60_000;

/**
 * Provides authentication codes.
 */
export interface CodeProvider {
  waitForCode(
    scopes: string,
    nonce: string,
    token: vscode.CancellationToken,
  ): Promise<string>;
}

/**
 * Waits for requests redirected to the extension to provide authentication codes.
 */
export class RedirectUriCodeProvider
  implements CodeProvider, vscode.UriHandler, vscode.Disposable
{
  private readonly pendingNonces = new Map<string, string[]>();
  private readonly codeExchangePromises = new Map<
    string,
    { promise: Promise<string>; cancel: vscode.EventEmitter<void> }
  >();
  private readonly redirectUriEmitter: vscode.EventEmitter<vscode.Uri>;
  private readonly disposable: vscode.Disposable;

  constructor(private readonly vs: typeof vscode) {
    this.redirectUriEmitter = new vs.EventEmitter<vscode.Uri>();
    this.disposable = this.redirectUriEmitter;
  }

  /**
   * Disposes the provider and cleans up resources.
   */
  dispose() {
    this.disposable.dispose();
  }

  /**
   * Handles the given URI by firing the redirect URI event.
   *
   * @param uri - The URI to handle.
   */
  public handleUri(uri: vscode.Uri): void {
    this.redirectUriEmitter.fire(uri);
  }

  /**
   * Waits for an authorization code for the given scopes and nonce.
   *
   * @param scopes - The scopes for which the code is requested.
   * @param nonce - A unique string to correlate the request and response.
   * @param token - A cancellation token to cancel the request.
   * @returns A promise that resolves to the authorization code.
   * @throws An error if the request times out or is cancelled.
   */
  public async waitForCode(
    scopes: string,
    nonce: string,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const existingNonces = this.pendingNonces.get(scopes) ?? [];
    this.pendingNonces.set(scopes, [...existingNonces, nonce]);

    // Avoid creating multiple promises for the same scopes.
    let codeExchange = this.codeExchangePromises.get(scopes);
    if (!codeExchange) {
      codeExchange = this.promiseFromEvent(
        this.redirectUriEmitter.event,
        this.handleEvent(scopes),
      );
      this.codeExchangePromises.set(scopes, codeExchange);
    }

    try {
      return await Promise.race([
        codeExchange.promise,
        exchangeTimeout(),
        this.cancellation(token),
      ]);
    } finally {
      this.pendingNonces.delete(scopes);
      codeExchange.cancel.fire();
      this.codeExchangePromises.delete(scopes);
    }
  }

  private handleEvent: (scopes: string) => PromiseAdapter<vscode.Uri, string> =
    (scopes) => (uri, resolve, reject) => {
      const query = new URLSearchParams(uri.query);
      const code = query.get("code");
      const nonce = query.get("nonce");
      if (!code) {
        reject(new Error("Missing code"));
        return;
      }
      if (!nonce) {
        reject(new Error("Missing nonce"));
        return;
      }

      const acceptedNonces = this.pendingNonces.get(scopes) ?? [];
      if (!acceptedNonces.includes(nonce)) {
        // Can happen if a sign in is triggered with one set of scopes while
        // there's already an existing sign in with a different set of scopes
        // in flight.
        //
        // Opt to return and wait for the next event, since it's likely we're
        // waiting on the user to continue the auth flow.
        //
        // Currently, a static set of scopes is used so this shouldn't be hit.
        return;
      }

      resolve(code);
    };

  /**
   * Creates a promise that rejects if the cancellation token is triggered.
   */
  private cancellation(token: vscode.CancellationToken): Promise<string> {
    const cancelEmitter = new this.vs.EventEmitter<void>();
    return new Promise<string>((_, reject) =>
      token.onCancellationRequested(() => {
        cancelEmitter.fire();
        reject(new Error("Operation cancelled by the user"));
      }),
    );
  }

  /**
   * Create a promise from an event.
   *
   * @param event The event to listen to.
   * @param adapter An optional adapter function to transform the event value.
   */
  private promiseFromEvent<T, U>(
    event: vscode.Event<T>,
    adapter: PromiseAdapter<T, U>,
  ): { promise: Promise<U>; cancel: vscode.EventEmitter<void> } {
    const cancel = new this.vs.EventEmitter<void>();
    let subscription: vscode.Disposable | undefined;

    const promise = new Promise<U>((resolve, reject) => {
      subscription = event((value: T) => {
        try {
          adapter(value, resolve, reject);
        } catch (e: unknown) {
          const error = e as Error;
          reject(error);
        }
      });

      cancel.event(() => {
        if (subscription) subscription.dispose();
        reject(new Error("Cancelled"));
      });
    });

    return {
      promise: promise.finally(() => {
        subscription?.dispose();
        return undefined;
      }),
      cancel,
    };
  }
}

/**
 * Creates a timeout promise that rejects after the defined duration.
 */
function exchangeTimeout(): Promise<string> {
  return new Promise<string>((_, reject) =>
    setTimeout(() => {
      reject(new Error("Request timed out"));
    }, EXCHANGE_TIMEOUT_MS),
  );
}

type PromiseAdapter<T, U> = (
  value: T,
  resolve: (value: U | PromiseLike<U>) => void,
  reject: (reason: unknown) => void,
) => void;
