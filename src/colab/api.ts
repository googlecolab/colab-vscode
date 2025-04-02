/**
 * API types for interacting with Colab's backend.
 *
 * As mentioned throughout several of the relevant fields, a lot of the name
 * choices are due to historical reasons and are not ideal.
 */

import { z } from "zod";

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
  // K80 is deprecated
  // P100 is deprecated
  // P4 is deprecated
  T4 = "T4",
  // V100 is deprecated
  A100 = "A100",
  L4 = "L4",
  // TPU
  V28 = "V28",
  V5E1 = "V5E1",
  V6E1 = "V6E1",
}

function uppercaseEnum<T extends z.EnumLike>(
  enumObj: T,
): z.ZodEffects<z.ZodNativeEnum<T>, T[keyof T], unknown> {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      return val.toUpperCase();
    }
    return val;
  }, z.nativeEnum(enumObj));
}

export const FreeCcuQuotaInfoSchema = z.object({
  /**
   * Number of tokens remaining in the "USAGE-mCCUs" quota group (remaining
   * free usage allowance in milli-CCUs).
   */
  remainingTokens: z.number(),
  /**
   * Next free quota refill timestamp (epoch) in seconds.
   */
  nextRefillTimestampSec: z.number(),
});
export type FreeCcuQuotaInfo = z.infer<typeof FreeCcuQuotaInfoSchema>;

/**
 * Cloud compute unit (CCU) information.
 */
export const CcuInfoSchema = z.object({
  /**
   * The current balance of the paid CCUs.
   *
   * Naming is unfortunate due to historical reasons and free CCU quota
   * balance is made available in a separate field for the same reasons.
   */
  currentBalance: z.number(),
  /**
   * The current rate of consumption of the user's CCUs (paid or free) based on
   * all assigned VMs.
   */
  consumptionRateHourly: z.number(),
  /**
   * The number of runtimes currently assigned when the user's paid CCU balance
   * is positive.
   */
  assignmentsCount: z.number(),
  /**
   * The list of eligible GPU accelerators.
   */
  eligibleGpus: z.array(uppercaseEnum(Accelerator)),
  /**
   * The list of ineligible GPU accelerators.
   */
  ineligibleGpus: z.array(uppercaseEnum(Accelerator)).optional(),
  /**
   * The list of eligible TPU accelerators.
   */
  eligibleTpus: z.array(uppercaseEnum(Accelerator)),
  /**
   * The list of ineligible TPU accelerators.
   */
  ineligibleTpus: z.array(uppercaseEnum(Accelerator)).optional(),
  /**
   * Free CCU quota information if applicable.
   */
  freeCcuQuotaInfo: FreeCcuQuotaInfoSchema.optional(),
});
export type CcuInfo = z.infer<typeof CcuInfoSchema>;

export const GetAssignmentResponseSchema = z.object({
  /** The pool's {@link Accelerator}. */
  acc: uppercaseEnum(Accelerator),
  /** The notebook ID hash. */
  nbh: z.string(),
  /** Whether or not Recaptcha should prompt. */
  p: z.boolean(),
  /** XSRF token for assignment posting. */
  token: z.string(),
  /** The variant of the assignment. */
  // On GET, this is a string so we must preprocess it to the enum.
  variant: z.preprocess((val) => {
    if (typeof val === "string") {
      switch (val) {
        case "DEFAULT":
          return Variant.DEFAULT;
        case "GPU":
          return Variant.GPU;
        case "TPU":
          return Variant.TPU;
      }
    }
    return val;
  }, z.nativeEnum(Variant)),
});
export type GetAssignmentResponse = z.infer<typeof GetAssignmentResponseSchema>;

export const RuntimeProxyInfoSchema = z.object({
  /** Token for the runtime proxy. */
  token: z.string(),
  /** Token expiration time in seconds. */
  tokenExpiresInSeconds: z.number(),
  /** URL of the runtime proxy. */
  url: z.string(),
});
export type RuntimeProxyInfo = z.infer<typeof RuntimeProxyInfoSchema>;

export const AssignmentSchema = z.object({
  /** The assigned accelerator. */
  accelerator: uppercaseEnum(Accelerator),
  /** The endpoint URL. */
  endpoint: z.string(),
  /** Frontend idle timeout in seconds. */
  fit: z.number().optional(),
  /** Whether the backend is trusted. */
  allowedCredentials: z.boolean().optional(),
  /** The subscription state. */
  sub: z.nativeEnum(SubscriptionState).optional(),
  /** The subscription tier. */
  subTier: z.nativeEnum(SubscriptionTier).optional(),
  /** The outcome of the assignment. */
  outcome: z.nativeEnum(Outcome).optional(),
  /** The variant of the assignment. */
  variant: z.nativeEnum(Variant),
  /** The machine shape. */
  machineShape: z.nativeEnum(Shape),
  /** Information about the runtime proxy. */
  runtimeProxyInfo: RuntimeProxyInfoSchema.optional(),
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const AssignmentsSchema = z.object({
  assignments: z.array(AssignmentSchema),
});

// This can be obtained by querying the Jupyter REST API's /api/spec.yaml
// endpoint.
export const KernelSchema = z
  .object({
    /** The UUID of the kernel. */
    id: z.string(),
    /** The kernel spec name. */
    name: z.string(),
    /** The ISO 8601 timestamp for the last-seen activity on the kernel. */
    last_activity: z.string().datetime(),
    /** The current execution state of the kernel. */
    execution_state: z.string(),
    /** The number of active connections to the kernel. */
    connections: z.number(),
  })
  .transform((k) => {
    const { last_activity, execution_state, ...rest } = k;
    return {
      ...rest,
      /** The ISO 8601 timestamp for the last-seen activity on the kernel. */
      lastActivity: last_activity,
      /** The current execution state of the kernel. */
      executionState: execution_state,
    };
  });
export type Kernel = z.infer<typeof KernelSchema>;
