/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { describeCauses, truncateMessage } from './error-description';

const MAX_MESSAGE_CHARS = 2000;
const MAX_CAUSE_DEPTH = 4;

describe('truncateMessage', () => {
  it('leaves a message at the cap untouched', () => {
    const msg = 'x'.repeat(MAX_MESSAGE_CHARS);

    expect(truncateMessage(msg)).to.equal(msg);
  });

  it('truncates messages over the cap', () => {
    const msg = 'x'.repeat(MAX_MESSAGE_CHARS + 1);

    expect(truncateMessage(msg)).to.equal(
      `${'x'.repeat(MAX_MESSAGE_CHARS)}... (2001 chars total)`,
    );
  });

  it('leaves the empty string alone', () => {
    expect(truncateMessage('')).to.equal('');
  });
});

describe('describeCauses', () => {
  it('returns the empty string for a cause-free error', () => {
    // Callers branch on emptiness to decide whether to append anything, so
    // this must be empty rather than a placeholder.
    expect(describeCauses(new Error('lonely'))).to.equal('');
  });

  it('describes a single cause as name and message', () => {
    const e = new Error('outer', { cause: new TypeError('inner') });

    expect(describeCauses(e)).to.equal('TypeError: inner');
  });

  it('includes a string code alongside the name', () => {
    const cause = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    });

    expect(describeCauses(new Error('outer', { cause }))).to.equal(
      'Error(ECONNREFUSED): connect failed',
    );
  });

  it('ignores a code that is not a string', () => {
    // Node's `errno` style numeric codes would otherwise render as "(-111)".
    const cause = Object.assign(new Error('connect failed'), { code: -111 });

    expect(describeCauses(new Error('outer', { cause }))).to.equal(
      'Error: connect failed',
    );
  });

  it('omits the separator for a cause with no message', () => {
    expect(describeCauses(new Error('outer', { cause: new Error() }))).to.equal(
      'Error',
    );
  });

  it('ignores a cause that is not an Error', () => {
    // `cause` is untyped, so a string or object cause is legal and must not
    // be dereferenced as if it were an Error.
    expect(describeCauses(new Error('outer', { cause: 'a string' }))).to.equal(
      '',
    );
  });

  it('joins a chain in order, outermost cause first', () => {
    const root = new Error('root');
    const middle = new TypeError('middle', { cause: root });

    expect(describeCauses(new Error('outer', { cause: middle }))).to.equal(
      'TypeError: middle <- Error: root',
    );
  });

  it(`follows at most ${String(MAX_CAUSE_DEPTH)} links`, () => {
    let cause = new Error('link-0');
    for (let i = 1; i <= 10; i++) {
      cause = new Error(`link-${String(i)}`, { cause });
    }

    const parts = describeCauses(new Error('outer', { cause })).split(' <- ');

    expect(parts).to.have.lengthOf(MAX_CAUSE_DEPTH);
    // Walks outward-in, so the deepest links are the ones dropped.
    expect(parts[0]).to.equal('Error: link-10');
    expect(parts[MAX_CAUSE_DEPTH - 1]).to.equal('Error: link-7');
  });

  it('expands every branch of an AggregateError', () => {
    const cause = new AggregateError([new Error('first'), new Error('second')]);

    expect(describeCauses(new Error('outer', { cause }))).to.equal(
      'AggregateError <- Error: first <- Error: second',
    );
  });

  it('skips non-Error entries inside an AggregateError', () => {
    const cause = new AggregateError(['just a string', new Error('real')]);

    expect(describeCauses(new Error('outer', { cause }))).to.equal(
      'AggregateError <- Error: real',
    );
  });

  it('terminates on a cycle rather than looping', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;

    expect(describeCauses(b)).to.equal('Error: a');
  });

  it('reports a self-referential cause once', () => {
    const e = new Error('self');
    e.cause = e;

    // `e` seeds the seen set, so its own link is never emitted.
    expect(describeCauses(e)).to.equal('');
  });
});
