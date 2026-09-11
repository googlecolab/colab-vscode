/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Maximum number of `cause` links to follow when describing an error. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Cap on a reported message. The depth limit bounds how deep a cause chain is
 * walked but not how wide, and a single `AggregateError` can hold hundreds of
 * entries. An oversized event would take its whole batch down with it.
 */
const MAX_MESSAGE_CHARS = 2000;

/**
 * Caps a message so a single oversized value cannot break its consumer.
 *
 * @param msg - The message to cap.
 * @returns The message, truncated with its original length appended when it
 * exceeds the cap.
 */
export function truncateMessage(msg: string): string {
  return msg.length <= MAX_MESSAGE_CHARS
    ? msg
    : `${msg.slice(0, MAX_MESSAGE_CHARS)}... (${String(msg.length)} chars total)`;
}

function hasStringCode(e: Error): e is Error & { code: string } {
  return 'code' in e && typeof e.code === 'string';
}

function describeLink(e: Error): string {
  const head = hasStringCode(e) ? `${e.name}(${e.code})` : e.name;
  return e.message ? `${head}: ${e.message}` : head;
}

function nextLinks(e: Error): Error[] {
  // An AggregateError's own message is empty; the detail is in `errors`.
  if (e instanceof AggregateError) {
    return e.errors.filter(
      (sub: unknown): sub is Error => sub instanceof Error,
    );
  }
  return e.cause instanceof Error ? [e.cause] : [];
}

/**
 * Flattens an error's `cause` chain into a single line.
 *
 * Wrappers like undici's `fetch failed` and the generated client's
 * `FetchError` carry no detail of their own; the real failure is nested.
 *
 * @param e - The error to describe.
 * @returns The joined causes, or the empty string when there are none.
 */
export function describeCauses(e: Error): string {
  const seen = new Set<Error>([e]);
  const parts: string[] = [];
  let links = nextLinks(e);

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && links.length > 0; depth++) {
    const deeper: Error[] = [];
    for (const link of links) {
      if (seen.has(link)) {
        continue;
      }
      seen.add(link);
      parts.push(describeLink(link));
      deeper.push(...nextLinks(link));
    }
    links = deeper;
  }
  return parts.join(' <- ');
}
