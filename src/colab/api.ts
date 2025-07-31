/**
 * API types for interacting with Colab's backends.
 *
 * This file not only defines the entire Colab API surface area, but also tries
 * to compartmentalize a lot of the funky intricacies:
 *
 * - Several name choices are due to historical reasons and are not ideal.
 * - Inconsistent naming conventions.
 * - Different representations for the same thing.
 * - Overlapping API functionality.
 * - Non-standard REST APIs.
 *
 * This complexity is largely due to the fact that Colab is an older product
 * that's gone through a ton of change! The APIs were enriched greatly over
 * time, with only a single frontend (Colab web) in mind. The team is now
 * working on cleaning up these APIs and it's expected that over time this file
 * will get smaller and more sensible.
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
  NONE = 0,
  PRO = 1,
  PRO_PLUS = 2,
}

enum ColabSubscriptionTier {
  UNKNOWN = 0,
  PRO = 1,
  VERY_PRO = 2,
}

enum ColabGapiSubscriptionTier {
  UNSPECIFIED = "SUBSCRIPTION_TIER_UNSPECIFIED",
  NONE = "SUBSCRIPTION_TIER_NONE",
  PRO = "SUBSCRIPTION_TIER_PRO",
  PRO_PLUS = "SUBSCRIPTION_TIER_PRO_PLUS",
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
  DEFAULT = "DEFAULT",
  GPU = "GPU",
  TPU = "TPU",
}

enum ColabGapiVariant {
  UNSPECIFIED = "VARIANT_UNSPECIFIED",
  GPU = "VARIANT_GPU",
  TPU = "VARIANT_TPU",
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

/**
 * Preprocess a native enum to get the enum value from a lower case string.
 *
 * @param enumObj - the native enum object schema to preprocess to.
 * @returns the zod effect to get the native enum from a lower case string.
 */
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

/**
 * Normalize the similar but different representations of subscription tiers
 *
 * @param tier - either the Colab backend or Colab Google API subscription tier.
 * @returns the normalized subscription tier.
 */
function normalizeSubTier(
  tier: ColabSubscriptionTier | ColabGapiSubscriptionTier,
): SubscriptionTier {
  switch (tier) {
    case ColabSubscriptionTier.PRO:
    case ColabGapiSubscriptionTier.PRO:
      return SubscriptionTier.PRO;
    case ColabSubscriptionTier.VERY_PRO:
    case ColabGapiSubscriptionTier.PRO_PLUS:
      return SubscriptionTier.PRO_PLUS;
    default:
      return SubscriptionTier.NONE;
  }
}

/**
 * Normalize the similar but different GAPI representation for the variant.
 *
 * @param variant - the Colab Google API variant.
 * @returns the normalized variant.
 */
function normalizeVariant(variant: ColabGapiVariant): Variant {
  switch (variant) {
    case ColabGapiVariant.GPU:
      return Variant.GPU;
    case ColabGapiVariant.TPU:
      return Variant.TPU;
    case ColabGapiVariant.UNSPECIFIED:
      return Variant.DEFAULT;
  }
}

/**
 * The schema for top level information about a user's tier, usage and
 * availability in Colab.
 */
export const UserInfoSchema = z.object({
  /** The subscription tier. */
  subscriptionTier: z
    .nativeEnum(ColabGapiSubscriptionTier)
    .transform(normalizeSubTier),
  /** The paid Colab Compute Units balance. */
  paidComputeUnitsBalance: z.number().optional(),
  /** The eligible machine accelerators. */
  eligibleAccelerators: z
    .array(
      z.object({
        /** The variant of the assignment. */
        variant: z.nativeEnum(ColabGapiVariant).transform(normalizeVariant),
        /** The assigned accelerator. */
        models: z.array(z.nativeEnum(Accelerator)),
      }),
    )
    .optional(),
});

/** The schema of Colab Compute Units (CCU) information. */
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
  /** The list of eligible GPU accelerators. */
  eligibleGpus: z.array(uppercaseEnum(Accelerator)),
  /** The list of ineligible GPU accelerators. */
  ineligibleGpus: z.array(uppercaseEnum(Accelerator)).optional(),
  /**
   * The list of eligible TPU accelerators.
   */
  eligibleTpus: z.array(uppercaseEnum(Accelerator)),
  /**
   * The list of ineligible TPU accelerators.
   */
  ineligibleTpus: z.array(uppercaseEnum(Accelerator)).optional(),
  /** Free CCU quota information if applicable. */
  freeCcuQuotaInfo: z
    .object({
      /**
       * Number of tokens remaining in the "USAGE-mCCUs" quota group (remaining
       * free usage allowance in milli-CCUs).
       */
      // The API is defined in Protobuf and the field is an Int64. The ProtoJSON
      // format (https://protobuf.dev/programming-guides/json) returns Int64 as
      // a string so the value needs to be converted to a number. It's not
      // expected we'll ever fail the `isSafeInteger` check since in practice
      // the value is << 2^53 - 1 (the max value a number type can safely
      // represent).
      remainingTokens: z
        .string()
        .refine(
          (val) => {
            const num = Number(val);
            return Number.isSafeInteger(num);
          },
          {
            message: "Value too large to be a safe integer for JavaScript",
          },
        )
        .transform((val) => Number(val)),
      /** Next free quota refill timestamp (epoch) in seconds. */
      nextRefillTimestampSec: z.number(),
    })
    .optional(),
});
/** Colab Compute Units (CCU) information. */
export type CcuInfo = z.infer<typeof CcuInfoSchema>;

/** The response when getting an assignment. */
export const GetAssignmentResponseSchema = z
  .object({
    /** The pool's accelerator. */
    acc: uppercaseEnum(Accelerator),
    /** The notebook ID hash. */
    nbh: z.string(),
    /** Whether or not Recaptcha should prompt. */
    p: z.boolean(),
    /** XSRF token for assignment posting. */
    token: z.string(),
    /** The variant of the assignment. */
    variant: z.nativeEnum(Variant),
  })
  .transform(({ acc, nbh, p, token, ...rest }) => ({
    ...rest,
    /** The pool's accelerator. */
    accelerator: acc,
    /** The notebook ID hash. */
    notebookIdHash: nbh,
    /** Whether or not Recaptcha should prompt. */
    shouldPromptRecaptcha: p,
    /** XSRF token for assignment posting. */
    xsrfToken: token,
  }));
/** The response when getting an assignment. */
export type GetAssignmentResponse = z.infer<typeof GetAssignmentResponseSchema>;

export const RuntimeProxyInfoSchema = z
  .object({
    /** Token for the runtime proxy. */
    token: z.string(),
    /** Token expiration time in seconds. */
    tokenExpiresInSeconds: z.number(),
    /** URL of the runtime proxy. */
    url: z.string(),
  })
  .transform(({ tokenExpiresInSeconds, ...rest }) => ({
    ...rest,
    /** Token expiration time in seconds. */
    expirySec: tokenExpiresInSeconds,
  }));
export type RuntimeProxyInfo = z.infer<typeof RuntimeProxyInfoSchema>;

/** A machine assignment in Colab. */
export const AssignmentSchema = z
  .object({
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
    subTier: z
      .nativeEnum(ColabSubscriptionTier)
      .transform(normalizeSubTier)
      .optional(),
    /** The outcome of the assignment. */
    outcome: z.nativeEnum(Outcome).optional(),
    /** The variant of the assignment. */
    // On GET, this is a string (enum) but on POST this is a number.
    // Normalize it to the string-based enum.
    variant: z.preprocess((val) => {
      if (typeof val === "number") {
        switch (val) {
          case 0:
            return Variant.DEFAULT;
          case 1:
            return Variant.GPU;
          case 2:
            return Variant.TPU;
        }
      }
      return val;
    }, z.nativeEnum(Variant)),
    /** The machine shape. */
    machineShape: z.nativeEnum(Shape),
    /** Information about the runtime proxy. */
    runtimeProxyInfo: RuntimeProxyInfoSchema.optional(),
  })
  .transform(({ fit, sub, subTier, ...rest }) => ({
    ...rest,
    /** The idle timeout in seconds. */
    idleTimeoutSec: fit,
    /** The subscription state. */
    subscriptionState: sub,
    /** The subscription tier. */
    subscriptionTier: subTier,
  }));
/** A machine assignment in Colab. */
export type Assignment = z.infer<typeof AssignmentSchema>;

/** The schema of the Colab API's list assignments endpoint. */
export const AssignmentsSchema = z.object({
  assignments: z.array(AssignmentSchema),
});

/** A Colab Jupyter kernel returned from the Colab API. */
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
  .transform(({ last_activity, execution_state, ...rest }) => ({
    ...rest,
    /** The ISO 8601 timestamp for the last-seen activity on the kernel. */
    lastActivity: last_activity,
    /** The current execution state of the kernel. */
    executionState: execution_state,
  }));
/** A Colab Jupyter kernel. */
export type Kernel = z.infer<typeof KernelSchema>;

/** A session to a Colab Jupyter kernel returned from the Colab API. */
export const SessionSchema = z.object({
  /** The UUID of the session. */
  id: z.string(),
  /** The kernel associated with the session. */
  kernel: KernelSchema,
  /** The name of the session. */
  name: z.string(),
  /** The path to the session. */
  path: z.string(),
  /** The session type. */
  type: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;
