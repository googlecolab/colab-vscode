/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import fetch, { Response, Request } from 'node-fetch';
import { SinonFakeTimers } from 'sinon';
import * as sinon from 'sinon';
import { ExperimentFlag } from '../colab/api';
import { TEST_ONLY as FLAGS_TEST_ONLY } from '../colab/experiment-state';
import { CONTENT_TYPE_JSON_HEADER } from '../colab/headers';
import { Deferred } from '../test/helpers/async';
import { ColabLogEvent, LOG_SOURCE } from './api';
import { ClearcutClient, LOG_ENDPOINT } from './client';

const NOW = Date.now();
const DEFAULT_LOG: ColabLogEvent = {
  activation_event: {},
  app_name: 'VS Code',
  extension_version: '0.1.0',
  jupyter_extension_version: '2025.9.0',
  platform: 'darwin',
  session_id: 'test-session-id',
  timestamp: new Date(NOW).toISOString(),
  ui_kind: 'UI_KIND_DESKTOP',
  vscode_version: '1.108.1',
};
const LOG_RESPONSE_FLUSH_INTERVAL = 15 * 60 * 1000;
const LOG_RESPONSE = {
  next_request_wait_millis: LOG_RESPONSE_FLUSH_INTERVAL.toString(),
};
const FETCH_RESPONSE_OK = new Response(JSON.stringify(LOG_RESPONSE), {
  status: 200,
});
const FETCH_RESPONSE_400 = new Response('', { status: 400 });
const MAX_PENDING_EVENTS = 10;
const MIN_FLUSH_WAIT_MS = 1000;

describe('ClearcutClient', () => {
  let client: ClearcutClient;
  let fakeClock: SinonFakeTimers;
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    client = new ClearcutClient({
      maxPendingEvents: MAX_PENDING_EVENTS,
      minFlushWaitMs: MIN_FLUSH_WAIT_MS,
    });
    fetchStub = sinon.stub(fetch, 'default');
    FLAGS_TEST_ONLY.setFlagForTest(ExperimentFlag.EnableTelemetry, true);
  });

  afterEach(() => {
    sinon.restore();
    FLAGS_TEST_ONLY.resetFlagsForTest();
  });

  describe('log', () => {
    it('flushes an event to Clearcut', async () => {
      const fetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        fetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      client.log(DEFAULT_LOG);

      await fetchCalled.promise;
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));
    });

    it('does not flush an event to Clearcut when telemetry is disabled', async () => {
      FLAGS_TEST_ONLY.setFlagForTest(ExperimentFlag.EnableTelemetry, false);

      client.log(DEFAULT_LOG);

      await fakeClock.tickAsync(1);
      sinon.assert.notCalled(fetchStub);
    });

    it('queues events when telemetry is disabled', async () => {
      FLAGS_TEST_ONLY.setFlagForTest(ExperimentFlag.EnableTelemetry, false);
      client.log(DEFAULT_LOG);
      await fakeClock.tickAsync(1);
      sinon.assert.notCalled(fetchStub);

      FLAGS_TEST_ONLY.setFlagForTest(ExperimentFlag.EnableTelemetry, true);
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      const fetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        fetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      client.log(otherLog);

      await fetchCalled.promise;
      sinon.assert.calledOnceWithExactly(
        fetchStub,
        logRequest([DEFAULT_LOG, otherLog]),
      );
    });

    it('throws an error when cannot be used after it has been disposed', () => {
      client.dispose();

      expect(() => {
        client.log(DEFAULT_LOG);
      }).to.throw('ClearcutClient cannot be used after it has been disposed.');
    });

    it('drops events when Clearcut responds with a non-500 status', async () => {
      const firstFetchCalled = new Deferred<void>();
      fetchStub.onFirstCall().callsFake(() => {
        firstFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_400);
      });

      client.log(DEFAULT_LOG);
      await firstFetchCalled.promise;
      sinon.assert.calledOnce(fetchStub);
      fetchStub.reset(); // Reset to clear behavior and history

      await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
      const OTHER_LOG = {
        ...DEFAULT_LOG,
        timestamp: new Date(fakeClock.now).toISOString(),
      };
      const secondFetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        secondFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      client.log(OTHER_LOG);
      await secondFetchCalled.promise;
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([OTHER_LOG]));
    });

    const requeueStatuses = [500, 501];
    for (const status of requeueStatuses) {
      it(`requeues events when Clearcut responds with a ${status.toString()}`, async () => {
        const firstFetchCalled = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(() => {
          firstFetchCalled.resolve();
          return Promise.resolve(new Response('', { status }));
        });

        client.log(DEFAULT_LOG);
        await firstFetchCalled.promise;
        sinon.assert.calledOnce(fetchStub);
        fetchStub.reset();

        await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
        const OTHER_LOG = {
          ...DEFAULT_LOG,
          timestamp: new Date(fakeClock.now).toISOString(),
        };
        const secondFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        client.log(OTHER_LOG);
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([DEFAULT_LOG, OTHER_LOG]),
        );
      });
    }

    describe('on requeue', () => {
      let pendingFlush: Deferred<void>;
      let fetchCalled: Deferred<void>;

      beforeEach(() => {
        fetchCalled = new Deferred<void>();
        client.log(DEFAULT_LOG); // Ensure next events are queued.
        fetchStub.reset();
        pendingFlush = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(async () => {
          fetchCalled.resolve();
          await pendingFlush.promise;
          return new Response('', { status: 500 });
        });
      });

      it('requeues all events when there is sufficient capacity', async () => {
        // Trigger flush
        const failedLogs = createLogEvents(3);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
          }
          client.log(log);
        }

        await fetchCalled.promise;

        // Place more logs on queue while flush pending
        const newLogs = createLogEvents(3);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        await fakeClock.tickAsync(1);
        fetchStub.reset();

        const secondFetchCalled = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        client.dispose(); // Trigger immediate flush
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([...failedLogs, ...newLogs]),
        );
      });

      it('requeues some events when there is limited capacity', async () => {
        // Place the max amount of logs on the queue
        const failedLogs = createLogEvents(MAX_PENDING_EVENTS);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
          }
          client.log(log);
        }

        await fetchCalled.promise;

        // Place half the max amount on queue while flush pending
        const newLogs = createLogEvents(MAX_PENDING_EVENTS / 2);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        await fakeClock.tickAsync(1);
        fetchStub.reset();

        const secondFetchCalled = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        client.dispose(); // Trigger immediate flush
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([...failedLogs.slice(MAX_PENDING_EVENTS / 2), ...newLogs]),
        );
      });

      it('requeues no events when there is no capacity', async () => {
        // Trigger flush
        const failedLogs = createLogEvents(3);
        for (const [i, log] of failedLogs.entries()) {
          if (i === failedLogs.length - 1) {
            await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
          }
          client.log(log);
        }

        await fetchCalled.promise;

        // Place the max amount of logs on the queue while flush pending
        const newLogs = createLogEvents(MAX_PENDING_EVENTS);
        newLogs.forEach((log) => {
          client.log(log);
        });

        // Resolve the pending flush, requeuing failed logs
        pendingFlush.resolve();
        fetchStub.reset();

        const secondFetchCalled = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        client.dispose(); // Trigger immediate flush
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest(newLogs));
      });
    });

    describe('while waiting between flushes', () => {
      const firstLog = DEFAULT_LOG;

      it('queues events to send in batch when the flush interval has not passed', async () => {
        const firstFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          firstFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        // Log an event to trigger the first flush.
        client.log(firstLog);
        await firstFetchCalled.promise;
        sinon.assert.calledOnce(fetchStub);
        fetchStub.reset();

        // While waiting for the flush interval to pass, log an event.
        const secondLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 1).toISOString(),
        };
        client.log(secondLog);

        // Advance time to reach the flush interval.
        await fakeClock.tickAsync(LOG_RESPONSE_FLUSH_INTERVAL);
        sinon.assert.notCalled(fetchStub);

        // Now that the interval's reached, the next log should trigger a flush.
        const thirdLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(fakeClock.now).toISOString(),
        };
        const secondFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });
        client.log(thirdLog);

        // Verify that the two queued events were sent in a batch.
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([secondLog, thirdLog]),
        );
      });

      it('queues events to send in batch when a flush is already pending', async () => {
        const flushPending = new Deferred<void>();
        const firstFetchCalled = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(async () => {
          firstFetchCalled.resolve();
          await flushPending.promise;
          return FETCH_RESPONSE_OK;
        });

        // Log an event to trigger the first flush.
        client.log(firstLog);
        await firstFetchCalled.promise;
        sinon.assert.calledOnce(fetchStub);
        fetchStub.reset();

        // While waiting for the previous flush to resolve, log an event.
        const secondLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 1).toISOString(),
        };
        client.log(secondLog);

        // Resolve the pending flush and advance time to reach the flush
        // interval.
        flushPending.resolve();
        await fakeClock.tickAsync(LOG_RESPONSE_FLUSH_INTERVAL);
        sinon.assert.notCalled(fetchStub);

        // Now that the interval's reached and the previous flush has resolved,
        // the next log should trigger a flush.
        const thirdLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(fakeClock.now).toISOString(),
        };
        const secondFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });
        client.log(thirdLog);

        // Verify that the two queued events were sent in a batch.
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([secondLog, thirdLog]),
        );
      });

      it('drops oldest events when max pending events is exceeded', async () => {
        const firstFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          firstFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });

        // Log an event to trigger the first flush.
        client.log(firstLog);
        await firstFetchCalled.promise;
        sinon.assert.calledOnce(fetchStub);
        fetchStub.reset();

        // Queue the max number of events.
        const newLogs = createLogEvents(MAX_PENDING_EVENTS);
        for (const log of newLogs) {
          client.log(log);
        }

        // Advance time to reach the flush interval.
        await fakeClock.tickAsync(LOG_RESPONSE_FLUSH_INTERVAL);
        sinon.assert.notCalled(fetchStub);

        // Trigger flush by logging one more event.
        const triggerLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(fakeClock.now).toISOString(),
        };
        const secondFetchCalled = new Deferred<void>();
        fetchStub.callsFake(() => {
          secondFetchCalled.resolve();
          return Promise.resolve(FETCH_RESPONSE_OK);
        });
        client.log(triggerLog);

        // Verify that the oldest queued events were dropped to maintain
        // capacity.
        await secondFetchCalled.promise;
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([...newLogs.slice(1), triggerLog]),
        );
      });
    });
  });

  it('uses the flush interval in the log response', async () => {
    const firstFetchCalled = new Deferred<void>();
    fetchStub.callsFake(() => {
      firstFetchCalled.resolve();
      return Promise.resolve(FETCH_RESPONSE_OK);
    });

    // Log an event to trigger the first flush.
    client.log(DEFAULT_LOG);
    await firstFetchCalled.promise;
    sinon.assert.calledOnce(fetchStub);
    fetchStub.reset();

    // Advance time to reach the minimum flush interval to assert we didn't
    // fallback to the minimum due to a parsing error.
    await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
    client.log(DEFAULT_LOG);
    sinon.assert.notCalled(fetchStub);

    // Advance time to reach the flush interval from the response.
    const remainingInterval = LOG_RESPONSE_FLUSH_INTERVAL - MIN_FLUSH_WAIT_MS;
    await fakeClock.tickAsync(remainingInterval);

    // Trigger flush
    const secondFetchCalled = new Deferred<void>();
    fetchStub.callsFake(() => {
      secondFetchCalled.resolve();
      return Promise.resolve(FETCH_RESPONSE_OK);
    });
    client.log(DEFAULT_LOG);
    await secondFetchCalled.promise;
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
        next_request_wait_millis: MIN_FLUSH_WAIT_MS - 10,
      }),
    },
  ];
  for (const { condition, responseBody } of conditions) {
    it(`defaults to the minimum flush interval when ${condition}`, async () => {
      const firstFetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        firstFetchCalled.resolve();
        return Promise.resolve(new Response(responseBody, { status: 200 }));
      });

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      await firstFetchCalled.promise;
      sinon.assert.calledOnce(fetchStub);
      fetchStub.reset();

      // Advance time to reach the flush interval.
      client.log(DEFAULT_LOG);
      await fakeClock.tickAsync(MIN_FLUSH_WAIT_MS);
      sinon.assert.notCalled(fetchStub);

      // Trigger flush
      const secondFetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        secondFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });
      client.log(DEFAULT_LOG);
      await secondFetchCalled.promise;
      sinon.assert.calledOnce(fetchStub);
    });
  }

  describe('dispose', () => {
    it('does nothing when there are no pending events', () => {
      client.dispose();

      sinon.assert.notCalled(fetchStub);
    });

    it('forces a flush when the flush interval has not passed', async () => {
      const firstFetchCalled = new Deferred<void>();
      fetchStub.onFirstCall().callsFake(() => {
        firstFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      await firstFetchCalled.promise;
      sinon.assert.calledOnce(fetchStub);
      fetchStub.reset();

      // While the flush interval has not passed, log another event. This
      // event should get queued.
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      client.log(otherLog);
      sinon.assert.notCalled(fetchStub);

      const secondFetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        secondFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      client.dispose();

      // Even though the flush interval has not passed, a second flush should
      // have been triggered by dispose.
      await secondFetchCalled.promise;
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([otherLog]));
    });

    it('forces a flush when a flush is already pending', async () => {
      const flushPending = new Deferred<void>();
      const firstFetchCalled = new Deferred<void>();
      fetchStub.onFirstCall().callsFake(async () => {
        firstFetchCalled.resolve();
        await flushPending.promise; // Never resolved
        return FETCH_RESPONSE_OK;
      });

      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      await firstFetchCalled.promise;
      sinon.assert.calledOnce(fetchStub);
      fetchStub.reset();

      // While the flush is still pending, log another event. This event
      // should get queued.
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      client.log(otherLog);
      sinon.assert.notCalled(fetchStub);

      const secondFetchCalled = new Deferred<void>();
      fetchStub.callsFake(() => {
        secondFetchCalled.resolve();
        return Promise.resolve(FETCH_RESPONSE_OK);
      });

      client.dispose();

      // Even though the first flush has not resolved, a second flush should
      // have been triggered by dispose.
      await secondFetchCalled.promise;
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
  return new Request(LOG_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      log_source: LOG_SOURCE,
      log_event: logEvents,
    }),
    headers: {
      [CONTENT_TYPE_JSON_HEADER.key]: CONTENT_TYPE_JSON_HEADER.value,
    },
  });
}
