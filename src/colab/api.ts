/**
 * @fileoverview API types for interacting with Colab's backend.
 *
 * As mentioned throughout several of the relevant fields, a lot of the name choices
 * are due to historical reasons and are not ideal.
 */

export interface FreeCCUQuotaInfo {
  /**
   * Number of tokens remaining in the "USAGE-mCCUs" quota group (remaining
   * free usage allowance in milli-CCUs).
   */
  remainingTokens: number;
  /**
   * Next free quota refill timestamp (epoch) in seconds.
   */
  nextRefillTimestampSec: number;
}

/**
 * Cloud compute unit (CCU) information.
 */
export interface CCUInfo {
  /**
   * The current balance of the paid CCUs.
   *
   * Naming is unfortunate due to historical reasons and free CCU quota
   * balance is made available in a separate field for the same reasons.
   */
  currentBalance: number;
  /**
   * The current rate of consumption of the user's CCUs (paid or free) based on
   * all assigned VMs. VMs consume paid CCUs if the user's paid CCU balance is
   * positive and free CCU quota if the paid balance is zero.
   */
  consumptionRateHourly: number;
  /**
   * The number of runtimes currently assigned when the user's paid CCU balance
   * is positive. This should match the number returned by the '/assignments'
   * endpoint. This will be always zero if the paid CCU balance is zero and the
   * /ccu-info request was made without the query param.
   */
  assignmentsCount: number;
  /**
   * The list of eligible GPU accelerators (w.r.t. their CCU balance and maybe
   * their subscription status) in the priority order.
   */
  eligibleGpus: Accelerator[];
  /**
   * The list of ineligible GPU accelerators. This can be used to display the
   * items as disabled and up-sell CCUs if non-empty.
   */
  ineligibleGpus: Accelerator[];
  /**
   * Free CCU quota information if the user's paid CCU balance is zero with
   * non-zero assignments. Otherwise undefined.
   */
  freeCcuQuotaInfo?: FreeCCUQuotaInfo;
}

export enum SubscriptionState {
  UNSUBSCRIBED = 1,
  RECURRING = 2,
  NON_RECURRING = 3,
  PENDING_ACTIVATION = 4,
  DECLINED = 5,
}

export enum SubscriptionTier {
  UNKNOWN_TIER = 0,
  PRO = 1,
  VERY_PRO = 2,
}

export enum Outcome {
  UNDEFINED_OUTCOME = 0,
  QUOTA_DENIED_REQUESTED_VARIANTS = 1,
  QUOTA_EXCEEDED_USAGE_TIME = 2,
  // QUOTA_EXCEEDED_USAGE_TIME_REFUND_MIGHT_UNBLOCK (3) is deprecated.
  SUCCESS = 4,
  DENYLISTED = 5,
}

export enum Variant {
  DEFAULT = 0,
  GPU = 1,
  TPU = 2,
}

export enum Shape {
  STANDARD = 0,
  HIGHMEM = 1,
  // VERYHIGHMEM (2) is deprecated.
}

export enum Accelerator {
  NONE = "NONE",
  // GPU
  K80 = "K80", // deprecated
  P100 = "P100", // deprecated
  P4 = "P4", // deprecated
  T4 = "T4",
  V100 = "V100", // deprecated
  A100 = "A100",
  L4 = "L4",
  // TPU
  V28 = "V28",
  V5E1 = "V5E1",
}

export interface GetAssignmentResponse {
  /** The pool's {@link Accelerator}. */
  acc: Accelerator;
  /**
   * The notebook ID hash. Same as the `nbh` query parameter from the request.
   */
  nbh: string;
  /**
   * Whether or not Recaptcha should prompt.
   */
  p: boolean;
  /**
   * XSRF token to be provided when posting an assignment.
   */
  token: string;
  /**
   * The string representation of the pool {@link Variant}.
   */
  variant: Variant;
}

export interface RuntimeProxyInfo {
  /**
   * Token for the runtime proxy.
   */
  token: string;
  /**
   * Token expiration time in seconds.
   */
  tokenExpiresInSeconds: number;
  /**
   * URL of the runtime proxy.
   */
  url: string;
}

export interface Assignment {
  /**
   * The assigned accelerator.
   */
  accelerator: Accelerator;
  /**
   * The endpoint URL.
   */
  endpoint: string;
  /**
   * Frontend idle timeout in seconds.
   */
  fit?: number;
  /**
   * Whether the backend is trusted.
   */
  allowedCredentials?: boolean;
  /**
   * The subscription state.
   */
  sub: SubscriptionState;
  /**
   * The subscription tier.
   */
  subTier: SubscriptionTier;
  /**
   * The outcome of the assignment.
   */
  outcome?: Outcome;
  /**
   * The variant of the assignment.
   */
  variant: Variant;
  /**
   * The machine shape.
   */
  machineShape: Shape;
  /**
   * Information about the runtime proxy.
   */
  runtimeProxyInfo?: RuntimeProxyInfo;
}
