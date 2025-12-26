/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Python code to configure Plotly to use the 'plotly_mimetype' renderer.
 * This makes Plotly visualizations work correctly in VS Code when connected
 * to a Colab runtime. The code is wrapped in a try/except to gracefully
 * handle cases where Plotly is not installed.
 */
const PLOTLY_CONFIG_CODE = `
try:
    import plotly.io as pio
    if pio.renderers.default != 'plotly_mimetype':
        pio.renderers.default = 'plotly_mimetype'
except ImportError:
    pass
`.trim();

/**
 * Tracks kernel sessions that have already been configured.
 * Uses session ID as key to ensure config runs once per kernel session.
 */
const configuredSessions = new Set<string>();

/**
 * Clears the set of configured sessions.
 * Useful for testing and when kernel sessions are restarted.
 */
export function resetConfiguredSessions(): void {
  configuredSessions.clear();
}

/**
 * Returns the number of currently configured sessions.
 * Useful for testing.
 */
export function getConfiguredSessionCount(): number {
  return configuredSessions.size;
}

/**
 * Interface representing a Jupyter execute request message.
 */
interface JupyterExecuteRequestMessage {
  header: {
    msg_type: 'execute_request';
    session: string;
  };
  content: {
    code: string;
  };
}

/**
 * Zod schema for validating Jupyter execute request messages.
 */
const ExecuteRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('execute_request'),
    session: z.string(),
  }),
  content: z.object({
    code: z.string(),
  }),
});

/**
 * Type guard to check if a message is a Jupyter execute request.
 */
function isExecuteRequest(
  message: unknown,
): message is JupyterExecuteRequestMessage {
  return ExecuteRequestSchema.safeParse(message).success;
}

/**
 * Injects Plotly configuration code into the first execute request for each
 * kernel session. This ensures Plotly uses the 'plotly_mimetype' renderer
 * which is compatible with VS Code's notebook rendering when connected to
 * Colab runtimes.
 *
 * The injection is:
 * - Idempotent: Only runs once per session
 * - Safe: Wrapped in try/except, no-op if Plotly isn't installed
 * - Non-invasive: Prepended to user code, doesn't affect execution
 *
 * @param rawJupyterMessage - The raw JSON string of a Jupyter kernel message
 * @returns The potentially modified message string with Plotly config prepended
 */
export function injectPlotlyConfig(rawJupyterMessage: string): string {
  if (!rawJupyterMessage) {
    return rawJupyterMessage;
  }

  let parsedMessage: unknown;
  try {
    parsedMessage = JSON.parse(rawJupyterMessage) as unknown;
  } catch {
    // Not valid JSON, return as-is
    return rawJupyterMessage;
  }

  if (!isExecuteRequest(parsedMessage)) {
    return rawJupyterMessage;
  }

  const sessionId = parsedMessage.header.session;
  if (configuredSessions.has(sessionId)) {
    // Already configured this session
    return rawJupyterMessage;
  }

  // Mark session as configured
  configuredSessions.add(sessionId);

  // Prepend Plotly configuration to user's code
  const modifiedMessage = {
    ...parsedMessage,
    content: {
      ...parsedMessage.content,
      code: PLOTLY_CONFIG_CODE + '\n' + parsedMessage.content.code,
    },
  };

  return JSON.stringify(modifiedMessage);
}
