import vscode, { Disposable, EventEmitter } from "vscode";
import { ColabClient } from "../colab/client";
import { CCUInfo } from "./api";

/**
 * CCUInformation is responsible of maintaining the CCU Info and notifying the provider if a change has occurred.
 */
export class CCUInformation implements Disposable {
  didChangeCCUInfo: EventEmitter<void>;
  ccuInfo: CCUInfo;
  poller: NodeJS.Timer;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    ccuInfo: CCUInfo,
  ) {
    this.ccuInfo = ccuInfo;
    this.didChangeCCUInfo = new this.vs.EventEmitter<void>();

    this.poller = this.pollForInfoUpdate();
  }

  dispose(): void {
    this.stopInfoPolling();
  }

  /**
   * pollForInfoUpdate regularly fetches the CCU Info and calls updates if there has been a change.
   */
  private pollForInfoUpdate() {
    // interval of 5 minutes.
    const interval = 1000 * 60 * 5;
    return setInterval(() => {
      this.client
        .ccuInfo()
        .then((nextInfo: CCUInfo) => {
          if (JSON.stringify(nextInfo) !== JSON.stringify(this.ccuInfo)) {
            this.updateCCUInfo(nextInfo);
          }
        })
        .catch((e: unknown) => {
          throw new Error(`Failed to fetch CCU information`, { cause: e });
        });
    }, interval);
  }

  private stopInfoPolling() {
    clearInterval(this.poller[Symbol.toPrimitive]());
  }

  /**
   * updateCCUInfo updates ccuInfo with new CCU info and emits that a change has occurred.
   */
  private updateCCUInfo(nextCCUInfo: CCUInfo) {
    this.ccuInfo = nextCCUInfo;
    this.didChangeCCUInfo.fire();
  }

  /**
   * Initializes the CCUInformation class with the most recent ccuInfo fetched from the client.
   */
  static async initialize(
    vs: typeof vscode,
    client: ColabClient,
  ): Promise<CCUInformation> {
    const info = await client.ccuInfo();
    return new CCUInformation(vs, client, info);
  }
}
