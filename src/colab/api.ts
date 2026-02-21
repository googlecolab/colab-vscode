/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

import { z } from 'zod';
import {
  Session as GeneratedSession,
  Kernel as GeneratedKernel,
} from '../jupyter/client/generated';

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
  UNSPECIFIED = 'SUBSCRIPTION_TIER_UNSPECIFIED',
  NONE = 'SUBSCRIPTION_TIER_NONE',
  PRO = 'SUBSCRIPTION_TIER_PRO',
  PRO_PLUS = 'SUBSCRIPTION_TIER_PRO_PLUS',
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
  DEFAULT = 'DEFAULT',
  GPU = 'GPU',
  TPU = 'TPU',
}

enum ColabGapiVariant {
  UNSPECIFIED = 'VARIANT_UNSPECIFIED',
  GPU = 'VARIANT_GPU',
  TPU = 'VARIANT_TPU',
}

export enum Shape {
  STANDARD = 0,
  HIGHMEM = 1,
  // VERYHIGHMEM (2) is deprecated.
}

/** Colab supported auth types. */
export enum AuthType {
  DFS_EPHEMERAL = 'dfs_ephemeral',
  AUTH_USER_EPHEMERAL = 'auth_user_ephemeral',
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

export const Accelerator = z.object({
  /** The variant of the assignment. */
  variant: z.enum(ColabGapiVariant).transform(normalizeVariant),
  /** The assigned accelerator. */
  models: z.array(z.string().toUpperCase()),
});

/**
 * The schema for top level information about a user's tier, usage and
 * availability in Colab.
 */
export const UserInfoSchema = z.object({
  /** The subscription tier. */
  subscriptionTier: z
    .enum(ColabGapiSubscriptionTier)
    .transform(normalizeSubTier),
  /** The paid Colab Compute Units balance. */
  paidComputeUnitsBalance: z.number().optional(),
  /** The eligible machine accelerators. */
  eligibleAccelerators: z.array(Accelerator),
  /** The ineligible machine accelerators. */
  ineligibleAccelerators: z.array(Accelerator),
});
/** Colab user information. */
export type UserInfo = z.infer<typeof UserInfoSchema>;

/**
 * The schema for top level information about a user's tier, usage and
 * availability in Colab when CCU consumption info is requested (consumption
 * fields are required).
 */
export const ConsumptionUserInfoSchema = UserInfoSchema.required({
  paidComputeUnitsBalance: true,
}).extend({
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
            error: 'Value too large to be a safe integer for JavaScript',
          },
        )
        .transform((val) => Number(val)),
      /** Next free quota refill timestamp (epoch) in seconds. */
      nextRefillTimestampSec: z.number(),
    })
    .optional(),
});
/** Colab consumption user information. */
export type ConsumptionUserInfo = z.infer<typeof ConsumptionUserInfoSchema>;

/** The response when getting an assignment. */
export const GetAssignmentResponseSchema = z
  .object({
    /** The pool's accelerator. */
    acc: z.string().toUpperCase(),
    /** The notebook ID hash. */
    nbh: z.string(),
    /** Whether or not Recaptcha should prompt. */
    p: z.boolean(),
    /** XSRF token for assignment posting. */
    token: z.string(),
    /** The variant of the assignment. */
    variant: z.enum(Variant),
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

export const RuntimeProxyInfoSchema = z.object({
  /** Token for the runtime proxy. */
  token: z.string(),
  /** Token expiration time in seconds. */
  tokenExpiresInSeconds: z.number(),
  /** URL of the runtime proxy. */
  url: z.string(),
});

export const RuntimeProxyTokenSchema = z
  .object({
    /** Token for the runtime proxy. */
    token: z.string(),
    /** Token TTL, serialized from `google.protobuf.Duration` as string. */
    tokenTtl: z.string(),
    /** URL of the runtime proxy. */
    url: z.string(),
  })
  .transform(({ tokenTtl, ...rest }) => {
    // Convert from string with 's' suffix to number of seconds and rename to
    // match `RuntimeProxyInfoSchema`.
    const tokenExpiresInSeconds = Number(tokenTtl.slice(0, -1));
    return {
      ...rest,
      tokenExpiresInSeconds:
        Number.isNaN(tokenExpiresInSeconds) || tokenExpiresInSeconds <= 0
          ? DEFAULT_TOKEN_TTL_SECONDS
          : tokenExpiresInSeconds,
    };
  });
export type RuntimeProxyToken = z.infer<typeof RuntimeProxyTokenSchema>;

/** The response when creating an assignment. */
export const PostAssignmentResponseSchema = z.object({
  /** The assigned accelerator. */
  accelerator: z.string().toUpperCase().optional(),
  /** The endpoint URL. */
  endpoint: z.string().optional(),
  /** Frontend idle timeout in seconds. */
  fit: z.number().optional(),
  /** Whether the backend is trusted. */
  allowedCredentials: z.boolean().optional(),
  /** The subscription state. */
  sub: z.enum(SubscriptionState).optional(),
  /** The subscription tier. */
  subTier: z.enum(ColabSubscriptionTier).transform(normalizeSubTier).optional(),
  /** The outcome of the assignment. */
  outcome: z.enum(Outcome).optional(),
  /** The variant of the assignment. */
  // On GET, this is a string (enum) but on POST this is a number.
  // Normalize it to the string-based enum.
  variant: z.preprocess((val) => {
    if (typeof val === 'number') {
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
  }, z.enum(Variant).optional()),
  /** The machine shape. */
  machineShape: z.enum(Shape).optional(),
  /** Information about the runtime proxy. */
  runtimeProxyInfo: RuntimeProxyInfoSchema.optional(),
});
/** The response when creating an assignment. */
export type PostAssignmentResponse = z.infer<
  typeof PostAssignmentResponseSchema
>;

/** The schema of an assignment when listing all. */
export const ListedAssignmentSchema = PostAssignmentResponseSchema.required({
  accelerator: true,
  endpoint: true,
  variant: true,
  machineShape: true,
}).omit({
  fit: true,
  allowedCredentials: true,
  sub: true,
  subTier: true,
  outcome: true,
  runtimeProxyInfo: true,
});
/** An abbreviated, listed assignment in Colab. */
export type ListedAssignment = z.infer<typeof ListedAssignmentSchema>;

/** The schema of the Colab API's list assignments endpoint. */
export const ListedAssignmentsSchema = z.object({
  assignments: z.array(ListedAssignmentSchema),
});
/** Abbreviated, listed assignments in Colab. */
export type ListedAssignments = z.infer<typeof ListedAssignmentsSchema>;

/** A machine assignment in Colab. */
export const AssignmentSchema = PostAssignmentResponseSchema.omit({
  outcome: true,
})
  // fit, sub, subTier and runtimeProxyInfo come back on POST but not when
  // listing all.
  .required({
    accelerator: true,
    endpoint: true,
    variant: true,
    machineShape: true,
    runtimeProxyInfo: true,
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

/** A Colab Jupyter kernel returned from the Colab API. */
// This can be obtained by querying the Jupyter REST API's /api/spec.yaml
// endpoint.
export const KernelSchema: z.ZodType<GeneratedKernel> = z
  .object({
    /** The UUID of the kernel. */
    id: z.string(),
    /** The kernel spec name. */
    name: z.string(),
    /** The ISO 8601 timestamp for the last-seen activity on the kernel. */
    last_activity: z.iso.datetime(),
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
export const SessionSchema: z.ZodType<GeneratedSession> = z.object({
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

/** Result from the Colab Drive credentials propagation API. */
export const CredentialsPropagationResultSchema = z
  .object({
    /** Whether the credentials are or were already propagated. */
    success: z.boolean(),
    /** An optional OAuth redirect URL if credentials aren't propagated. */
    unauthorized_redirect_uri: z.string().optional(),
  })
  .transform(({ unauthorized_redirect_uri, ...rest }) => ({
    ...rest,
    unauthorizedRedirectUri: unauthorized_redirect_uri,
  }));
export type CredentialsPropagationResult = z.infer<
  typeof CredentialsPropagationResultSchema
>;

/**
 * Maps a Colab {@link Variant} to a human-friendly machine type name.
 *
 * @param variant - The Colab {@link Variant}.
 * @returns The human-friendly machine type name.
 */
export function variantToMachineType(variant: Variant): string {
  switch (variant) {
    case Variant.DEFAULT:
      return 'CPU';
    case Variant.GPU:
      return 'GPU';
    case Variant.TPU:
      return 'TPU';
  }
}
/**
 * Maps a Colab {@link Shape} to a human-friendly machine shape name.
 *
 * @param shape - The Colab {@link Shape}.
 * @returns The human-friendly machine shape name.
 */
export function shapeToMachineShape(shape: Shape): string {
  switch (shape) {
    case Shape.HIGHMEM:
      return 'High-RAM';
    case Shape.STANDARD:
    default:
      return 'Standard';
  }
}

const HIGHMEM_ONLY_ACCELERATORS: Set<string> = new Set<string>([
  'L4',
  'V28',
  'V5E1',
  'V6E1',
]);

/**
 * Determines if the provided accelerator is one that requires a high-memory
 * machine shape.
 *
 * @param accelerator - The accelerator to check.
 * @returns Whether the accelerator requires a high-memory machine shape.
 */
export function isHighMemOnlyAccelerator(accelerator?: string): boolean {
  return (
    accelerator !== undefined && HIGHMEM_ONLY_ACCELERATORS.has(accelerator)
  );
}

/** The experiment flags supported by the Colab extension. */
export enum ExperimentFlag {
  EnableTelemetry = 'enable_vscode_telemetry',
  RuntimeVersionNames = 'runtime_version_names',
}

/** The default values for each experiment flag. */
export const EXPERIMENT_FLAG_DEFAULT_VALUES: Record<
  ExperimentFlag,
  ExperimentFlagValue
> = {
  [ExperimentFlag.EnableTelemetry]: false,
  [ExperimentFlag.RuntimeVersionNames]: [],
};

// Define the basic types allowed
const PrimitiveExperimentFlagValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);
const ExperimentFlagValueSchema = z.union([
  PrimitiveExperimentFlagValueSchema,
  z.array(PrimitiveExperimentFlagValueSchema),
]);
/** The type for the value of an experiment flag. */
export type ExperimentFlagValue = z.infer<typeof ExperimentFlagValueSchema>;

/** The schema for the experiment state response. */
export const ExperimentStateSchema = z.object({
  /** The map of experiment flags. */
  experiments: z
    .record(z.string(), ExperimentFlagValueSchema.optional())
    .transform((val) => {
      /** Filter out entries where the value is undefined */
      const validKeys = new Set(Object.values(ExperimentFlag) as string[]);
      const entries = Object.entries(val).filter(([k, v]) => {
        return v !== undefined && validKeys.has(k);
      });

      return new Map(entries) as Map<ExperimentFlag, ExperimentFlagValue>;
    })
    .optional(),
});
/** The experiment state response. */
export type ExperimentState = z.infer<typeof ExperimentStateSchema>;

const DEFAULT_TOKEN_TTL_SECONDS = 3600;
