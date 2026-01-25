/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import fetch, { Response, Request } from 'node-fetch';
import { SinonFakeTimers } from 'sinon';
import * as sinon from 'sinon';
import {
  ClearcutClient,
  ColabLogEvent,
  MAX_PENDING_EVENTS,
  MIN_WAIT_BETWEEN_FLUSHES_MS,
} from './client';

const NOW = Date.now();
const DEFAULT_LOG: ColabLogEvent = {
  extension_version: '0.1.0',
  jupyter_extension_version: '2025.9.0',
  session_id: 'test-session-id',
  timestamp: new Date(NOW).toISOString(),
  ui_kind: 'UI_KIND_DESKTOP',
  vscode_version: '1.108.1',
};

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
      fetchStub.resolves(new Response('', { status: 500 }));
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

    describe('while waiting between flushes', () => {
      const firstLog = DEFAULT_LOG;

      beforeEach(() => {
        // Log an event to trigger the first flush.
        client.log(firstLog);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));
      });

      it('queues events to send in batch after the flush interval has passed', async () => {
        // While waiting for the flush interval to pass, log an event.
        const secondLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 1).toISOString(),
        };
        client.log(secondLog);

        // Advance time to reach the flush interval.
        await fakeClock.tickAsync(MIN_WAIT_BETWEEN_FLUSHES_MS);
        sinon.assert.calledOnceWithExactly(fetchStub, logRequest([firstLog]));

        // Now that the interval's reached, the next log should trigger a flush.
        const thirdLog = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW + 2).toISOString(),
        };
        client.log(thirdLog);

        // Verify that the two queued events were sent in a batch.
        sinon.assert.calledTwice(fetchStub);
        sinon.assert.calledWithExactly(
          fetchStub.secondCall,
          logRequest([secondLog, thirdLog]),
        );
      });

      it('drops oldest events when max pending events is exceeded', async () => {
        fetchStub.resetHistory();
        const oldestEvent = {
          ...DEFAULT_LOG,
          timestamp: new Date(NOW).toISOString(),
        };
        client.log(oldestEvent);

        // Log MAX_PENDING_EVENTS more events to exceed the limit.
        const newEvents: ColabLogEvent[] = [];
        for (let i = 0; i < MAX_PENDING_EVENTS; i++) {
          const logEvent = {
            ...DEFAULT_LOG,
            timestamp: new Date(NOW + i).toISOString(),
          };
          newEvents.push(logEvent);
          // Advance time to allow flush of last event
          if (i === MAX_PENDING_EVENTS - 1) {
            await fakeClock.tickAsync(MIN_WAIT_BETWEEN_FLUSHES_MS);
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

    it('forces a flush regardless of the flush interval', () => {
      // Log an event to trigger the first flush.
      client.log(DEFAULT_LOG);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));

      // While the flush interval has not passed, log another event. This event
      // should get queued.
      const otherLog = {
        ...DEFAULT_LOG,
        timestamp: new Date(NOW + 1).toISOString(),
      };
      client.log(otherLog);
      sinon.assert.calledOnceWithExactly(fetchStub, logRequest([DEFAULT_LOG]));

      client.dispose();

      // Even though the flush interval has not passed, a second flush should
      // have been triggered by dispose.
      sinon.assert.calledTwice(fetchStub);
      sinon.assert.calledWithExactly(
        fetchStub.secondCall,
        logRequest([otherLog]),
      );
    });
  });
});

// Helper to match the expected Clearcut log request structure
function logRequest(events: ColabLogEvent[]): Request {
  const logEvents = events.map((event) => ({
    source_extension_json: JSON.stringify(event),
  }));
  return new Request('https://play.googleapis.com/log', {
    method: 'POST',
    body: JSON.stringify({
      log_source: 'COLAB_VSCODE',
      log_event: logEvents,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
