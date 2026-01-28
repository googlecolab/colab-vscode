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
const FETCH_RESPONSE_500 = new Response('', { status: 500 });

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

    describe('throws an error', () => {
      it('when Clearcut responds with a non-200 status', async () => {
        fetchStub.resolves(FETCH_RESPONSE_500);
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

      it('when the client is disposed', () => {
        client.dispose();

        expect(() => {
          client.log(DEFAULT_LOG);
        }).to.throw(
          'ClearcutClient cannot be used after it has been disposed.',
        );
      });
    });

    describe('while waiting between flushes', () => {
      const firstLog = DEFAULT_LOG;

      describe('queues events to send in batch', () => {
        it('when the flush interval has not passed', async () => {
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
          await fakeClock.tickAsync(15 * 60 * 1000);
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

        it('when a flush is already pending', async () => {
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
      });

      it('drops oldest events when max pending events is exceeded', async () => {
        fetchStub.resolves(FETCH_RESPONSE_OK);

        // Log an event to trigger the first flush.
        client.log(firstLog);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));
        fetchStub.resetHistory();

        const oldestEvent = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW).toISOString(),
        };
        client.log(oldestEvent);

        // Log MAX_PENDING_EVENTS more events to exceed the limit.
        const newEvents: ColabLogEvent[] = [];
        for (let i = 0; i < TEST_ONLY.MAX_PENDING_EVENTS; i++) {
          const logEvent = {
            ...DEFAULT_LOG,
            timestamp: new Date(NOW + i).toISOString(),
          };
          newEvents.push(logEvent);
          // Advance time to allow flush of last event
          if (i === TEST_ONLY.MAX_PENDING_EVENTS - 1) {
            await fakeClock.tickAsync(LOG_RESPONSE.next_request_wait_millis);
          }
          client.log(logEvent);
        }

        // Verify that the oldest event was dropped.
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest(newEvents));
      });
    });
  });

  describe('dispose', () => {
    it('does nothing when there are no pending events', () => {
      client.dispose();

      sinon.assert.notCalled(fetchStub);
    });

    describe('forces a flush', () => {
      it('when the flush interval has not passed', () => {
        fetchStub.resolves(FETCH_RESPONSE_OK);

        // Log an event to trigger the first flush.
        client.log(DEFAULT_LOG);
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([DEFAULT_LOG]),
        );
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

      it('when a flush is already pending', () => {
        const flushPending = new Deferred<void>();
        fetchStub.onFirstCall().callsFake(async () => {
          await flushPending.promise; // Never resolved
          return FETCH_RESPONSE_OK;
        });

        // Log an event to trigger the first flush.
        client.log(DEFAULT_LOG);
        sinon.assert.calledOnceWithExactly(
          fetchStub,
          logRequest([DEFAULT_LOG]),
        );
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
});

// Helper to match the expected Clearcut log request structure
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
