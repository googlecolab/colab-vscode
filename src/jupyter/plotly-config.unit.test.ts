/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import {
  getConfiguredSessionCount,
  injectPlotlyConfig,
  resetConfiguredSessions,
} from './plotly-config';

/**
 * Type for parsed Jupyter kernel messages in tests.
 */
interface ParsedMessage {
  header: {
    msg_type: string;
    session?: string;
    msg_id?: string;
    username?: string;
  };
  content?: {
    code?: string;
    silent?: boolean;
    store_history?: boolean;
    cursor_pos?: number;
  };
  parent_header?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

describe('injectPlotlyConfig', () => {
  beforeEach(() => {
    resetConfiguredSessions();
  });

  describe('when receiving a valid execute_request', () => {
    it('injects Plotly config on the first request for a session', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-123' },
        content: { code: 'print("hello")' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;

      expect(parsed.content?.code).to.include('plotly.io');
      expect(parsed.content?.code).to.include('plotly_mimetype');
      expect(parsed.content?.code).to.include('print("hello")');
    });

    it('does not inject Plotly config on subsequent requests for the same session', () => {
      const rawMessage1 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-456' },
        content: { code: 'x = 1' },
      });
      const rawMessage2 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-456' },
        content: { code: 'y = 2' },
      });

      // First request should be modified
      const result1 = injectPlotlyConfig(rawMessage1);
      expect((JSON.parse(result1) as ParsedMessage).content?.code).to.include(
        'plotly.io',
      );

      // Second request should NOT be modified
      const result2 = injectPlotlyConfig(rawMessage2);
      const parsed2 = JSON.parse(result2) as ParsedMessage;
      expect(parsed2.content?.code).to.equal('y = 2');
      expect(parsed2.content?.code).to.not.include('plotly.io');
    });

    it('injects Plotly config for different sessions independently', () => {
      const rawMessage1 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-A' },
        content: { code: 'code_A' },
      });
      const rawMessage2 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-B' },
        content: { code: 'code_B' },
      });

      const result1 = injectPlotlyConfig(rawMessage1);
      const result2 = injectPlotlyConfig(rawMessage2);

      // Both should have Plotly config injected
      expect((JSON.parse(result1) as ParsedMessage).content?.code).to.include(
        'plotly.io',
      );
      expect((JSON.parse(result2) as ParsedMessage).content?.code).to.include(
        'plotly.io',
      );
    });

    it('preserves all other message properties', () => {
      const rawMessage = JSON.stringify({
        header: {
          msg_type: 'execute_request',
          session: 'session-789',
          msg_id: 'abc-123',
          username: 'user',
        },
        content: {
          code: 'x = 1',
          silent: false,
          store_history: true,
        },
        parent_header: {},
        metadata: { custom: 'data' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;

      expect(parsed.header.msg_id).to.equal('abc-123');
      expect(parsed.header.username).to.equal('user');
      expect(parsed.content?.silent).to.equal(false);
      expect(parsed.content?.store_history).to.equal(true);
      expect(parsed.parent_header).to.deep.equal({});
      expect(parsed.metadata).to.deep.equal({ custom: 'data' });
    });
  });

  describe('when receiving non-execute_request messages', () => {
    it('does not modify kernel_info_request messages', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'kernel_info_request', session: 'session-123' },
      });

      const result = injectPlotlyConfig(rawMessage);

      expect(result).to.equal(rawMessage);
    });

    it('does not modify inspect_request messages', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'inspect_request', session: 'session-123' },
        content: { code: 'some_variable', cursor_pos: 5 },
      });

      const result = injectPlotlyConfig(rawMessage);

      expect(result).to.equal(rawMessage);
    });

    it('does not modify complete_request messages', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'complete_request', session: 'session-123' },
        content: { code: 'import nu', cursor_pos: 9 },
      });

      const result = injectPlotlyConfig(rawMessage);

      expect(result).to.equal(rawMessage);
    });
  });

  describe('when receiving invalid input', () => {
    it('returns empty string unchanged', () => {
      const result = injectPlotlyConfig('');

      expect(result).to.equal('');
    });

    it('returns invalid JSON unchanged', () => {
      const invalidJson = 'not valid json {{{';

      const result = injectPlotlyConfig(invalidJson);

      expect(result).to.equal(invalidJson);
    });

    it('returns non-Jupyter format messages unchanged', () => {
      const rawMessage = JSON.stringify({
        random_field: 'random_value',
      });

      const result = injectPlotlyConfig(rawMessage);

      expect(result).to.equal(rawMessage);
    });

    it('returns execute_request without session unchanged', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request' },
        content: { code: 'print("test")' },
      });

      const result = injectPlotlyConfig(rawMessage);

      expect(result).to.equal(rawMessage);
    });
  });

  describe('session tracking', () => {
    it('tracks configured sessions correctly', () => {
      expect(getConfiguredSessionCount()).to.equal(0);

      injectPlotlyConfig(
        JSON.stringify({
          header: { msg_type: 'execute_request', session: 'sess-1' },
          content: { code: 'x = 1' },
        }),
      );
      expect(getConfiguredSessionCount()).to.equal(1);

      injectPlotlyConfig(
        JSON.stringify({
          header: { msg_type: 'execute_request', session: 'sess-2' },
          content: { code: 'x = 2' },
        }),
      );
      expect(getConfiguredSessionCount()).to.equal(2);

      // Same session shouldn't increase count
      injectPlotlyConfig(
        JSON.stringify({
          header: { msg_type: 'execute_request', session: 'sess-1' },
          content: { code: 'x = 3' },
        }),
      );
      expect(getConfiguredSessionCount()).to.equal(2);
    });

    it('resets tracked sessions correctly', () => {
      injectPlotlyConfig(
        JSON.stringify({
          header: { msg_type: 'execute_request', session: 'sess-1' },
          content: { code: 'x = 1' },
        }),
      );
      expect(getConfiguredSessionCount()).to.equal(1);

      resetConfiguredSessions();

      expect(getConfiguredSessionCount()).to.equal(0);

      // After reset, same session should get configured again
      const result = injectPlotlyConfig(
        JSON.stringify({
          header: { msg_type: 'execute_request', session: 'sess-1' },
          content: { code: 'y = 2' },
        }),
      );
      expect((JSON.parse(result) as ParsedMessage).content?.code).to.include(
        'plotly.io',
      );
    });
  });

  describe('injected code properties', () => {
    it('uses try/except to handle missing Plotly gracefully', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-test' },
        content: { code: 'x = 1' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;

      expect(parsed.content?.code).to.include('try:');
      expect(parsed.content?.code).to.include('except ImportError:');
      expect(parsed.content?.code).to.include('pass');
    });

    it('sets renderer to plotly_mimetype', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-test2' },
        content: { code: 'fig.show()' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;

      expect(parsed.content?.code).to.include("'plotly_mimetype'");
      expect(parsed.content?.code).to.include('pio.renderers.default');
    });

    it('only sets renderer if not already set to plotly_mimetype', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-test3' },
        content: { code: 'x = 1' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;

      // Should check before setting
      expect(parsed.content?.code).to.include(
        "if pio.renderers.default != 'plotly_mimetype'",
      );
    });

    it('prepends config code before user code', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'session-order' },
        content: { code: 'user_code_here()' },
      });

      const result = injectPlotlyConfig(rawMessage);
      const parsed = JSON.parse(result) as ParsedMessage;
      const code = parsed.content?.code ?? '';

      const plotlyIndex = code.indexOf('plotly.io');
      const userCodeIndex = code.indexOf('user_code_here()');

      expect(plotlyIndex).to.be.lessThan(userCodeIndex);
    });
  });
});
