/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import fetch, { Response, Request } from 'node-fetch';
import { SinonFakeTimers } from 'sinon';
import * as sinon from 'sinon';
import { Deferred } from '../test/helpers/async';
import { ClearcutClient, ColabLogEvent, TEST_ONLY } from './client';

const NOW = Date.now();
const DEFAULT_LOG: ColabLogEvent = {
  activation_event: {},
  extension_version: '0.1.0',
  jupyter_extension_version: '2025.9.0',
  session_id: 'test-session-id',
  timestamp: new Date(NOW).toISOString(),
  ui_kind: 'UI_KIND_DESKTOP',
  vscode_version: '1.108.1',
};
const LOG_RESPONSE = {
  next_request_wait_millis: 15 * 60 * 1000,
};
const FETCH_RESPONSE_OK = new Response(JSON.stringify(LOG_RESPONSE), {
  status: 200,
});
const FETCH_RESPONSE_400 = new Response('', { status: 400 });

describe('ClearcutClient', () => {
  let client: ClearcutClient;
  let fakeClock: SinonFakeTimers;
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    client = new ClearcutClient();
    fetchStub = sinon.stub(fetch, 'default');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('log', () => {
    it('flushes an event to Clearcut', () => {
      client.log(DEFAULT_LOG);

      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
    });

    it('throws an error when Clearcut responds with a non-200 status', async () => {
      fetchStub.resolves(FETCH_RESPONSE_400);
      // Since log is sync (fires and forgets), spy on internal error handling
      const requestSpy = sinon.spy(
        client as unknown as { issueRequest: () => Promise<void> },
        'issueRequest',
      );

      client.log(DEFAULT_LOG);

      let error: Error | undefined;
      await requestSpy.firstCall.returnValue.catch((e: unknown) => {
        error = e as Error;
      });
      expect(error?.message).to.include('Failed to issue request');
    });

    it('throws an error when the client is disposed', () => {
      client.dispose();

      expect(() => {
        client.log(DEFAULT_LOG);
      }).to.throw('ClearcutClient cannot be used after it has been disposed.');
    });

    it('drops events when Clearcut responds with a non-500 status', async () => {
      fetchStub
        .onCall(0)
        .resolves(FETCH_RESPONSE_400)
        .onCall(1)
        .resolves(FETCH_RESPONSE_OK);

      client.log(DEFAULT_LOG);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
      fetchStub.reset();

      await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
      const OTHER_LOG = {
        ...DEFAULT_LOG,
        timestamp: new Date(fakeClock.now).toISOString(),
      };
      client.log(OTHER_LOG);

      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([OTHER_LOG]));
    });

    const requeueStatusTest = [{ status: 500 }, { status: 501 }];
    for (const { status } of requeueStatusTest) {
      it(`requeues events when Clearcut responds with a 500+ status: ${status.toString()}`, async () => {
        fetchStub
          .onCall(0)
          .resolves(new Response('', { status }))
          .onCall(1)
          .resolves(FETCH_RESPONSE_OK);

        client.log(DEFAULT_LOG);
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([DEFAULT_LOG]),
        );
        fetchStub.reset();

        await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
        const OTHER_LOG = {
          ...DEFAULT_LOG,
          timestamp: new Date(fakeClock.now).toISOString(),
        };
        client.log(OTHER_LOG);

        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([DEFAULT_LOG, OTHER_LOG]),
        );
      });
    }

    describe('on requeue', () => {
      let pendingFlush: Deferred<void>;

      beforeEach(() => {
        client.log(DEFAULT_LOG); // Ensure next events are queued.
        fetchStub.resetHistory();
        pendingFlush = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(async () => {
          await pendingFlush.promise;
          return new Response('', { status: 500 });
        });
      });

      it('requeues all events when there is sufficient capacity', async () => {
        // Trigger flush
        const failedLogs = createLogEvents(3);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
          }
          client.log(log);
        }

        // Place more logs on queue while flush pending
        const newLogs = createLogEvents(3);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        await fakeClock.tickAsync(1);
        fetchStub.resetHistory();

        client.dispose(); // Trigger immediate flush
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([...failedLogs, ...newLogs]),
        );
      });

      it('requeues some events when there is limited capacity', async () => {
        // Place the max amount of logs on the queue
        const failedLogs = createLogEvents(TEST_ONLY.MAX_PENDING_EVENTS);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
          }
          client.log(log);
        }

        // Place half the max amount on queue while flush pending
        const newLogs = createLogEvents(TEST_ONLY.MAX_PENDING_EVENTS / 2);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        await fakeClock.tickAsync(1);
        fetchStub.resetHistory();

        client.dispose(); // Trigger immediate flush
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([
            ...failedLogs.slice(TEST_ONLY.MAX_PENDING_EVENTS / 2),
            ...newLogs,
          ]),
        );
      });

      it('requeues no events when there is no capacity', async () => {
        // Trigger flush
        const failedLogs = createLogEvents(3);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
          }
          client.log(log);
        }

        // Place the max amount of logs on the queue while flush pending
        const newLogs = createLogEvents(TEST_ONLY.MAX_PENDING_EVENTS);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        await fakeClock.tickAsync(1);
        fetchStub.resetHistory();

        client.dispose(); // Trigger immediate flush
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest(newLogs));
      });
    });

    describe('while waiting between flushes', () => {
      const firstLog = DEFAULT_LOG;

      it('queues events to send in batch when the flush interval has not passed', async () => {
        fetchStub.resolves(FETCH_RESPONSE_OK);

        // Log an event to trigger the first flush.
        client.log(firstLog);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));
        fetchStub.resetHistory();

        // While waiting for the flush interval to pass, log an event.
        const secondLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 1).toISOString(),
        };
        client.log(secondLog);

        // Advance time to reach the flush interval.
        await fakeClock.tickAsync(LOG_RESPONSE.next_request_wait_millis);
        sinon.assert.notCalled(fetchStub);

        // Now that the interval's reached, the next log should trigger a
        // flush.
        const thirdLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 2).toISOString(),
        };
        client.log(thirdLog);

        // Verify that the two queued events were sent in a batch.
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([secondLog, thirdLog]),
        );
      });

      it('queues events to send in batch when a flush is already pending', async () => {
        const flushPending = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(async () => {
          await flushPending.promise;
          return FETCH_RESPONSE_OK;
        });

        // Log an event to trigger the first flush.
        client.log(firstLog);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));
        fetchStub.resetHistory();

        // While waiting for the previous flush to resolve, log an event.
        const secondLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 1).toISOString(),
        };
        client.log(secondLog);

        // Resolve the pending flush and advance time to reach the flush
        // interval.
        flushPending.resolve();
        await fakeClock.tickAsync(LOG_RESPONSE.next_request_wait_millis);
        sinon.assert.notCalled(fetchStub);

        // Now that the interval's reached and the previous flush has
        // resolved, the next log should trigger a flush.
        const thirdLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 2).toISOString(),
        };
        client.log(thirdLog);

        // Verify that the two queued events were sent in a batch.
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([secondLog, thirdLog]),
        );
      });

      it('drops oldest events when max pending events is exceeded', async () => {
        fetchStub.resolves(FETCH_RESPONSE_OK);

        // Log an event to trigger the first flush.
        client.log(firstLog);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));
        fetchStub.resetHistory();

        const oldestLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW).toISOString(),
        };
        client.log(oldestLog);

        // Log MAX_PENDING_EVENTS more events to exceed the limit.
        const newLogs = createLogEvents(TEST_ONLY.MAX_PENDING_EVENTS);
        for (const [i, log] of newLogs.entries()) {
          // Advance time to allow flush of last event
          if (i === newLogs.length - 1) {
            await fakeClock.tickAsync(LOG_RESPONSE.next_request_wait_millis);
          }
          client.log(log);
        }

        // Verify that the oldest event was dropped.
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest(newLogs));
      });
    });
  });

  it('uses the flush interval in the log response', async () => {
    fetchStub.resolves(FETCH_RESPONSE_OK);

    // Log an event to trigger the first flush.
    client.log(DEFAULT_LOG);
    sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
    fetchStub.resetHistory();

    // Advance time to reach the flush interval.
    client.log(DEFAULT_LOG);
    await fakeClock.tickAsync(LOG_RESPONSE.next_request_wait_millis);
    sinon.assert.notCalled(fetchStub);

    // Trigger flush
    client.log(DEFAULT_LOG);
    sinon.assert.calledOnce(fetchStub);
  });

  const conditions = [
    {
      condition: 'the response is invalid json',
      responseBody: 'foo',
    },
    {
      condition: 'the response is missing next_request_wait_millis',
      responseBody: JSON.stringify({}),
    },
    {
      condition: 'the response has an invalid next_request_wait_millis',
      responseBody: JSON.stringify({ next_request_wait_millis: 'foo' }),
    },
    {
      condition:
        'the response has a next_request_wait_millis that is less than the minimum wait',
      responseBody: JSON.stringify({
        next_request_wait_millis: TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS - 10,
      }),
    },
  ];
  for (const { condition, responseBody } of conditions) {
    it(`defaults to the minimum flush interval when ${condition}`, async () => {
      fetchStub.resolves(new Response(responseBody, { status: 200 }));

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
      fetchStub.resetHistory();

      // Advance time to reach the flush interval.
      client.log(DEFAULT_LOG);
      await fakeClock.tickAsync(TEST_ONLY.MIN_WAIT_BETWEEN_FLUSHES_MS);
      sinon.assert.notCalled(fetchStub);

      // Trigger flush
      client.log(DEFAULT_LOG);
      sinon.assert.calledOnce(fetchStub);
    });
  }

  describe('dispose', () => {
    it('does nothing when there are no pending events', () => {
      client.dispose();

      sinon.assert.notCalled(fetchStub);
    });

    it('forces a flush when the flush interval has not passed', () => {
      fetchStub.resolves(FETCH_RESPONSE_OK);

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
      fetchStub.resetHistory();

      // While the flush interval has not passed, log another event. This
      // event should get queued.
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      client.log(otherLog);
      sinon.assert.notCalled(fetchStub);

      client.dispose();

      // Even though the flush interval has not passed, a second flush should
      // have been triggered by dispose.
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([otherLog]));
    });

    it('forces a flush when a flush is already pending', () => {
      const flushPending = new Deferred<void>();
      fetchStub.onFirstCall().callsFake(async () => {
        await flushPending.promise; // Never resolved
        return FETCH_RESPONSE_OK;
      });

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
      fetchStub.resetHistory();

      // While the flush is still pending, log another event. This event
      // should get queued.
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      client.log(otherLog);
      sinon.assert.notCalled(fetchStub);

      client.dispose();

      // Even though the first flush has not resolved, a second flush should
      // have been triggered by dispose.
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([otherLog]));
    });
  });
});

/**
 * Helper to batch create a number of unique log events
 */
function createLogEvents(numEvents: number): ColabLogEvent[] {
  const events = [];
  for (let i = 0; i < numEvents; i++) {
    events[i] = { ...DEFAULT_LOG, timestamp: new Date(NOW + i).toISOString() };
  }
  return events;
}

/**
 * Helper to match the expected Clearcut log request structure
 */
function logRequest(events: ColabLogEvent[]): Request {
  const logEvents = events.map((event) => ({
    source_extension_json: JSON.stringify(event),
  }));
  return new Request(TEST_ONLY.LOGS_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      log_source: TEST_ONLY.LOG_SOURCE,
      log_event: logEvents,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
