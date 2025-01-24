import { join } from "path";
import { SinonStub } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";

interface UriOptions {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

/**
 * An approximate test double for vscode.Uri.
 */
class TestUri implements vscode.Uri {
  static parse(stringUri: string): TestUri {
    const url = new URL(stringUri);
    return new TestUri(
      url.protocol.replace(/:$/, ""),
      url.hostname,
      url.pathname,
      url.search.replace(/^\?/, ""),
      url.hash.replace(/^#/, ""),
    );
  }

  static file(filePath: string): TestUri {
    return new TestUri(
      "file",
      "",
      filePath.split("?")[0] || "",
      filePath.split("?")[1] || "",
      "",
    );
  }

  static joinPath(base: TestUri, ...pathSegments: string[]): TestUri {
    const { path: p, ...rest } = base;
    return new this(
      rest.scheme,
      rest.authority,
      join(p, ...pathSegments),
      rest.query,
      rest.fragment,
    );
  }

  static from(components: UriOptions): vscode.Uri {
    return new TestUri(
      components.scheme,
      components.authority,
      components.path,
      components.query,
      components.fragment,
    );
  }

  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;

  get fsPath(): string {
    return this.path;
  }

  constructor(
    scheme: string,
    authority: string,
    path: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  with(change: Partial<UriOptions>): vscode.Uri {
    return new TestUri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(): string {
    // eslint-disable-next-line prefer-const
    let { scheme, authority, path, query, fragment } = this;
    if (query.length > 0) query = `?${query}`;
    if (fragment.length > 0) fragment = `#${fragment}`;
    return `${scheme}://${authority}${path}${query}${fragment}`;
  }

  toJSON(): string {
    return JSON.stringify({
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    });
  }
}

class TestEventEmitter<T> implements vscode.EventEmitter<T> {
  private listeners: ((data: T) => void)[] = [];
  private disposed = false;

  constructor() {
    this.event = (listener: (data: T) => void) => {
      if (this.disposed) {
        throw new Error("EventEmitter has been disposed");
      }
      this.listeners.push(listener);

      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index > -1) {
            this.listeners.splice(index, 1);
          }
        },
      };
    };
  }

  readonly event: (listener: (data: T) => void) => { dispose: () => void };

  fire(data: T): void {
    if (this.disposed) {
      throw new Error("EventEmitter has been disposed");
    }

    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}

class TestCancellationToken implements vscode.CancellationToken {
  private _isCancellationRequested = false;
  private eventEmitter: TestEventEmitter<void>;

  constructor(eventEmitter: TestEventEmitter<void>) {
    this.eventEmitter = eventEmitter;
  }

  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get onCancellationRequested(): vscode.Event<any> {
    return this.eventEmitter.event;
  }

  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this.eventEmitter.fire();
    }
  }

  dispose(): void {
    this.eventEmitter.dispose();
  }
}

class TestCancellationTokenSource implements vscode.CancellationTokenSource {
  private _token: TestCancellationToken;
  private disposed = false;

  constructor() {
    const eventEmitter = new TestEventEmitter<void>();
    this._token = new TestCancellationToken(eventEmitter);
  }

  get token(): TestCancellationToken {
    if (this.disposed) {
      throw new Error("CancellationTokenSource has been disposed");
    }
    return this._token;
  }

  cancel(): void {
    if (this.disposed) {
      throw new Error("CancellationTokenSource has been disposed");
    }
    this._token.cancel();
  }

  dispose(): void {
    if (!this.disposed) {
      this._token.dispose();
      this.disposed = true;
    }
  }
}

class DisposableStub implements vscode.Disposable {
  dispose = sinon.stub();
  static from = sinon.stub();
}

const getExtensionStub: SinonStub<
  [extensionId: string],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vscode.Extension<any> | undefined
> = sinon.stub();

const vscodeStub: typeof vscode = {
  Uri: TestUri,
  EventEmitter: TestEventEmitter,
  Disposable: DisposableStub,
  extensions: {
    getExtension: getExtensionStub,
  } as Partial<typeof vscode.extensions> as typeof vscode.extensions,
} as Pick<
  typeof vscode,
  "Uri" | "EventEmitter" | "Disposable" | "extensions"
> as typeof vscode;

export { TestUri, TestCancellationTokenSource, getExtensionStub, vscodeStub };
