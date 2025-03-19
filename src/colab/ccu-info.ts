import vscode, { Disposable, EventEmitter } from "vscode";
import { ColabClient } from "../colab/client";
import { CcuInfo } from "./api";

// Poll interval of 5 minutes.
const POLL_INTERVAL_MS = 1000 * 60 * 5;

/**
 * Periodically polls for CCU info changes and emits an event when one occurs.
 */
export class CcuInformation implements Disposable {
  onDidChangeCcuInfo: EventEmitter<void>;
  private currentCcuInfo?: CcuInfo;
  private poller: NodeJS.Timeout;
  private isFetching = false;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    ccuInfo?: CcuInfo,
  ) {
    this.currentCcuInfo = ccuInfo;
    this.onDidChangeCcuInfo = new this.vs.EventEmitter<void>();
    this.poller = this.startInfoPolling();
  }

  dispose(): void {
    this.stopInfoPolling();
  }

  /**
   * Getter for the current CCU information.
   */
  get ccuInfo() {
    return this.currentCcuInfo;
  }

  /**
   * Regularly fetches the CCU Info, maintaining a snapshot and notifying of
   * changes.
   */
  private startInfoPolling(): NodeJS.Timeout {
    return setInterval(() => {
      // TODO: Implement a better way to handle this instead of a boolean flag.
      // possible options: `Promise.race`, cancel stale request, explicit
      // timeout that is shorter than `POLL_INTERVAL_MS`.
      if (this.isFetching) {
        return;
      }

      this.isFetching = true;
      this.client
        .ccuInfo()
        .then((nextInfo: CcuInfo) => {
          this.updateCcuInfo(nextInfo);
        })
        .catch((e: unknown) => {
          throw new Error(`Failed to fetch CCU information`, { cause: e });
        })
        .finally(() => {
          this.isFetching = false;
        });
    }, POLL_INTERVAL_MS);
  }

  private stopInfoPolling() {
    clearInterval(this.poller);
  }

  /**
   * Updates with new CCU info and emits an event when there is a change.
   */
  private updateCcuInfo(nextCcuInfo: CcuInfo) {
    if (JSON.stringify(nextCcuInfo) === JSON.stringify(this.ccuInfo)) {
      return;
    }

    this.currentCcuInfo = nextCcuInfo;
    this.onDidChangeCcuInfo.fire();
  }

  /**
   * Initializes {@link CcuInformation} with the current value obtained by
   * fetching it from the client.
   */
  static async initialize(
    vs: typeof vscode,
    client: ColabClient,
  ): Promise<CcuInformation> {
    const info = await client.ccuInfo();
    return new CcuInformation(vs, client, info);
  }
}
