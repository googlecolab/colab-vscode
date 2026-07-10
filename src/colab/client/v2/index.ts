/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { log } from '../../../common/logging';
import { telemetry } from '../../../telemetry';
import {
  AcceleratorUnavailableError,
  DenylistedError,
  InsufficientQuotaError,
  LongRunningOperationError,
  TooManyAssignmentsError,
  WaitOperationTimeoutError,
} from '../../errors';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import {
  Shape as CommonShape,
  SubscriptionTier as CommonSubscriptionTier,
  Variant as CommonVariant,
} from '../../types';
import {
  ColaboratoryApi,
  Configuration as ColabConfig,
  ErrorContext,
  ErrorInfo,
  FetchParams,
  Middleware,
  RequestContext,
  ResponseContext,
  Shape,
  SubscriptionTier,
  Variant,
} from './generated/colab';
import {
  Operation,
  ColaboratoryApi as OperationsApi,
  Configuration as OperationsConfig,
} from './generated/operations';

/** A client to interact with public Colab API. */
export interface ColabApiClient {
  /**
   * A client instance to access the Colab APIs
   */
  colab: ColaboratoryApi;

  /**
   * A client instance to access the Operations APIs.
   */
  operations: OperationsApi;

  /**
   * Waits for an operation to complete, with exponential backoff.
   *
   * @param id - Operation ID to wait for.
   * @param opts - Backoff options.
   * @returns A promise that resolves to the completed operation.
   */
  waitOperationWithBackoff(
    id: string,
    opts: Partial<BackoffOptions>,
  ): Promise<Operation>;
}

/**
 * Options for waiting for an operation to complete with exponential backoff.
 */
export interface BackoffOptions {
  /**
   * The maximum number of retries to attempt before giving up.
   */
  maxRetries: number;
  /**
   * The initial delay in milliseconds before the first retry.
   */
  initialRetryDelayMs: number;
  /**
   * The maximum delay in milliseconds between retries.
   */
  maxRetryDelayMs: number;
  /**
   * The factor by which the delay increases after each retry.
   */
  backoffFactor: number;
  /**
   * An optional signal to abort the operation waiting process.
   */
  signal?: AbortSignal;
}

/**
 * Creates a new {@link ColabApiClient} instance.
 *
 * @param basePath - Base URL for Colab API.
 * @param getAccessToken - Function to retrieve access token.
 * @param onAuthError - Optional function to handle authentication errors.
 * @returns A new {@link ColabApiClient} instance.
 */
export function createColabApiClient(
  basePath: string,
  getAccessToken: () => Promise<string>,
  onAuthError?: () => Promise<void>,
): ColabApiClient {
  return new ColabApiClientImpl(basePath, getAccessToken, onAuthError);
}

/**
 * Normalizes the API {@link SubscriptionTier} to the common
 * {@link CommonSubscriptionTier}.
 *
 * @param tier - Subscription tier returned from public Colab API.
 * @returns Normalized common subscription tier value.
 */
export function normalizeSubscriptionTier(
  tier: SubscriptionTier,
): CommonSubscriptionTier {
  switch (tier) {
    case SubscriptionTier.SubscriptionTierFree:
      return CommonSubscriptionTier.NONE;
    case SubscriptionTier.SubscriptionTierPro:
      return CommonSubscriptionTier.PRO;
    case SubscriptionTier.SubscriptionTierProPlus:
      return CommonSubscriptionTier.PRO_PLUS;
    default:
      throw new Error(`Unknown subscription tier: ${tier}`);
  }
}

/**
 * Normalizes the API {@link Variant} to the common {@link CommonVariant}.
 *
 * @param variant - Variant returned from public Colab API.
 * @returns Normalized common variant value.
 */
export function normalizeVariant(variant: Variant): CommonVariant {
  switch (variant) {
    case Variant.VariantCpu:
      return CommonVariant.DEFAULT;
    case Variant.VariantGpu:
      return CommonVariant.GPU;
    case Variant.VariantTpu:
      return CommonVariant.TPU;
    default:
      throw new Error(`Unknown variant: ${variant}`);
  }
}

/**
 * Converts the common {@link CommonVariant} to the API {@link Variant}.
 *
 * @param variant - Common variant.
 * @returns API variant value for Colab public API.
 */
export function denormalizeVariant(variant: CommonVariant): Variant {
  switch (variant) {
    case CommonVariant.GPU:
      return Variant.VariantGpu;
    case CommonVariant.TPU:
      return Variant.VariantTpu;
    default:
      return Variant.VariantCpu;
  }
}

/**
 * Normalizes the API {@link Shape} to the common {@link CommonShape}.
 *
 * @param shape - Shape returned from public Colab API.
 * @returns Normalized common variant value.
 */
export function normalizeShape(shape: Shape): CommonShape {
  switch (shape) {
    case Shape.ShapeStandard:
      return CommonShape.STANDARD;
    case Shape.ShapeHighmem:
      return CommonShape.HIGHMEM;
    default:
      throw new Error(`Unknown shape: ${shape}`);
  }
}

/**
 * Converts the common {@link CommonShape} to the API {@link Shape}.
 *
 * @param shape - Common shape.
 * @returns API shape value for Colab public API.
 */
export function denormalizeShape(shape?: CommonShape): Shape {
  return shape === CommonShape.HIGHMEM
    ? Shape.ShapeHighmem
    : Shape.ShapeStandard;
}

/**
 * Throws if the operation contains an error.
 *
 * @param operation - Operation to parse error from.
 * @param accelerator - Requested accelerator, if any.
 */
export function throwIfOperationError(
  operation: Operation,
  accelerator?: string,
): void {
  if (operation.error) {
    let reason: string | undefined;
    for (const detail of operation.error.details ?? []) {
      if (isErrorInfo(detail)) {
        reason = detail.reason;
        switch (reason) {
          case 'TOO_MANY_ACTIVE_RUNTIMES':
            throw new TooManyAssignmentsError(operation.error.message);
          case 'DENYLISTED':
            throw new DenylistedError(
              'This account has been blocked from accessing Colab servers due to suspected abusive activity. This does not impact access to other Google products. Review the [usage limitations](https://research.google.com/colaboratory/faq.html#limitations-and-restrictions).',
            );
          case 'QUOTA_EXCEEDED_USAGE_TIME':
            throw new InsufficientQuotaError(
              'You have insufficient quota to assign this server.',
            );
          default:
            if (accelerator && accelerator !== 'NONE') {
              throw new AcceleratorUnavailableError(accelerator);
            }
        }
        break;
      }
    }
    throw new LongRunningOperationError(
      operation.name ?? 'unknown',
      operation.error.code ?? 0,
      reason ?? 'UNKNOWN',
      operation.error.message,
    );
  }
}

class ColabApiClientImpl implements ColabApiClient {
  private readonly colabApi: ColaboratoryApi;
  private readonly operationsApi: OperationsApi;

  constructor(
    basePath: string,
    getAccessToken: () => Promise<string>,
    onAuthError?: () => Promise<void>,
  ) {
    const middleware = [
      new AuthMiddleware(getAccessToken),
      new ErrorMiddleware(onAuthError),
    ];
    this.colabApi = new ColaboratoryApi(
      new ColabConfig({ basePath, headers: HEADERS, middleware }),
    );
    this.operationsApi = new OperationsApi(
      new OperationsConfig({ basePath, headers: HEADERS, middleware }),
    );
  }

  get colab() {
    return this.colabApi;
  }

  get operations() {
    return this.operationsApi;
  }

  async waitOperationWithBackoff(
    id: string,
    opts: Partial<BackoffOptions> = {},
  ): Promise<Operation> {
    const options = { ...DEFAULT_BACKOFF_OPTS, ...opts };
    let currentDelay = options.initialRetryDelayMs;
    let operation = await this.operationsApi.getOperation(
      { operationsId: id },
      { signal: options.signal },
    );

    let attempt = 1;
    while (!operation.done) {
      if (attempt > options.maxRetries) {
        throw new WaitOperationTimeoutError(id, attempt);
      }

      await delay(currentDelay);
      operation = await this.operationsApi.getOperation(
        { operationsId: id },
        { signal: options.signal },
      );

      currentDelay = Math.min(
        currentDelay * options.backoffFactor,
        options.maxRetryDelayMs,
      );
      attempt++;
    }
    return operation;
  }
}

const DEFAULT_BACKOFF_OPTS: BackoffOptions = {
  maxRetries: 20,
  initialRetryDelayMs: 500,
  maxRetryDelayMs: 5000,
  backoffFactor: 1.3,
};

const HEADERS = {
  [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
} as const;

class AuthMiddleware implements Middleware {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  async pre(context: RequestContext): Promise<FetchParams> {
    const headers = new Headers(context.init.headers);
    const token = await this.getAccessToken();
    if (token) {
      headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
      context.init.headers = headers;
    }
    return context;
  }
}

class ErrorMiddleware implements Middleware {
  constructor(private readonly onAuthError?: () => Promise<void>) {}

  async post(context: ResponseContext): Promise<void> {
    if (!context.response.ok) {
      if (context.response.status === 401 && this.onAuthError) {
        await this.onAuthError();
      }
      telemetry.logError(context.response);
      log.warn(
        `Error response received by ${context.init.method ?? ''} ${context.url}:`,
        context.response,
      );
    }
  }

  onError(context: ErrorContext): Promise<void> {
    telemetry.logError(context.error);
    log.error(
      `Error thrown during request ${context.init.method ?? ''} ${context.url}:`,
      context.error,
    );
    return Promise.resolve();
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrorInfo(obj: unknown): obj is ErrorInfo {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'reason' in obj &&
    typeof obj.reason === 'string'
  );
}
