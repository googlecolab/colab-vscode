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
  private poller: NodeJS.Timer;
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
   * Getter for the current CCU Information.
   */
  get ccuInfo() {
    return this.currentCcuInfo;
  }

  /**
   * Regularly fetches the CCU Info and calls updates if there has been a change.
   */
  private startInfoPolling() {
    return setInterval(async () => {
      if (this.isFetching) {
        return
      }

      try {
        this.isFetching = true;
        const nextInfo = await this.client.ccuInfo()
        this.updateCcuInfo(nextInfo);
      } catch (e: unknown) {
          throw new Error(`Failed to fetch CCU information`, { cause: e });
      } finally {
        this.isFetching = false;
      }
    }, POLL_INTERVAL_MS);
  }

  private stopInfoPolling() {
    clearInterval(this.poller[Symbol.toPrimitive]());
  }

  /**
   * Updates ccuInfo with new CCU info and emits that a change has occurred.
   */
  private updateCcuInfo(nextCcuInfo: CcuInfo) {
    if (JSON.stringify(nextCcuInfo) === JSON.stringify(this.ccuInfo)) {
      return;
    }

    this.currentCcuInfo = nextCcuInfo;
    this.onDidChangeCcuInfo.fire();
  }

  /**
   * Initializes the CcuInformation class with the most recent ccuInfo fetched from the client.
   */
  static async initialize(
    vs: typeof vscode,
    client: ColabClient,
  ): Promise<CcuInformation> {
    const info = await client.ccuInfo();
    return new CcuInformation(vs, client, info);
  }
}
