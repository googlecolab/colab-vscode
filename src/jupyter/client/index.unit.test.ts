/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Disposable } from 'vscode';
import { Variant } from '../../colab/api';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../../colab/headers';
import { TestEventEmitter } from '../../test/helpers/events';
import { TestUri } from '../../test/helpers/uri';
import { AssignmentChangeEvent } from '../assignments';
import { ColabAssignedServer } from '../servers';
import {
  ConfigApi,
  ContentsApi,
  IdentityApi,
  KernelsApi,
  KernelspecsApi,
  SessionsApi,
  StatusApi,
  TerminalsApi,
} from './generated';
import { JupyterClient, ProxiedJupyterClient } from './index';

const TOKEN = 'access-token';
const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
  label: 'Colab GPU A100',
  variant: Variant.GPU,
  accelerator: 'A100',
  endpoint: 'm-s-foo',
  connectionInformation: {
    baseUrl: TestUri.parse('https://example.com'),
    token: TOKEN,
    tokenExpiry: new Date(Date.now() + 1000),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: TOKEN,
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: new Date(),
};

describe('ProxiedJupyterClient', () => {
  const baseUrl = TestUri.parse('https://example.com');
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch').callsFake(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  const clients = [
    ['static', () => ProxiedJupyterClient.withStaticConnection(DEFAULT_SERVER)],
    [
      'refreshing',
      () => ProxiedJupyterClient.withStaticConnection(DEFAULT_SERVER),
    ],
  ] as const;
  for (const factoryFn of clients) {
    const [clientType, factory] = factoryFn;
    const client = factory();

    describe(`${clientType} client`, () => {
      it('creates API instances lazily and caches them', () => {
        const a = client.config;
        const b = client.config;

        expect(a).to.be.instanceOf(ConfigApi);
        expect(b).to.equal(a);
      });

      it('configures the base path and headers from the connection information', async () => {
        await client.status.get();

        sinon.assert.calledOnce(fetchStub);
        const fetchArgs = fetchStub.firstCall.args;

        const url = fetchArgs[0];
        const req = fetchArgs[1];

        expect(url).to.include(baseUrl.toString());
        const headers = new Headers(req?.headers);
        expect(headers.get(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key)).to.equal(
          TOKEN,
        );
        expect(headers.get(COLAB_CLIENT_AGENT_HEADER.key)).to.equal(
          COLAB_CLIENT_AGENT_HEADER.value,
        );
      });

      const cases = [
        ['config', ConfigApi],
        ['contents', ContentsApi],
        ['identity', IdentityApi],
        ['kernels', KernelsApi],
        ['kernelspecs', KernelspecsApi],
        ['sessions', SessionsApi],
        ['status', StatusApi],
        ['terminals', TerminalsApi],
      ] as const;

      for (const [prop, ApiClass] of cases) {
        it(`exposes the ${prop} API`, () => {
          const api = client[prop as keyof typeof client];

          expect(api).to.be.instanceOf(ApiClass);
        });
      }
    });
  }

  describe('withRefreshingConnection', () => {
    let changeEmitter: TestEventEmitter<AssignmentChangeEvent>;
    let client: JupyterClient & Disposable;

    beforeEach(() => {
      changeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
      client = ProxiedJupyterClient.withRefreshingConnection(
        DEFAULT_SERVER,
        changeEmitter.event,
      );
    });

    afterEach(() => {
      client.dispose();
    });

    function lastToken() {
      const fetchArgs = fetchStub.lastCall.args;
      const url = fetchArgs[0];
      const req = fetchArgs[1];

      expect(url).to.include(baseUrl.toString());
      const headers = new Headers(req?.headers);
      return headers.get(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key);
    }

    function defaultServerWithToken(token: string) {
      return {
        ...DEFAULT_SERVER,
        connectionInformation: {
          ...DEFAULT_SERVER.connectionInformation,
          token: token,
        },
      };
    }

    it('uses the refreshed access token on each request', async () => {
      await client.status.get();
      expect(lastToken()).to.equal(TOKEN);

      changeEmitter.fire({
        added: [],
        changed: [defaultServerWithToken('first-change')],
        removed: [],
      });
      await client.status.get();
      expect(lastToken()).to.equal('first-change');

      changeEmitter.fire({
        added: [],
        changed: [defaultServerWithToken('second-change')],
        removed: [],
      });
      await client.status.get();
      expect(lastToken()).to.equal('second-change');
    });

    it('uses the last known token when the server is removed', async () => {
      await client.status.get();
      expect(lastToken()).to.equal(TOKEN);

      changeEmitter.fire({
        added: [],
        changed: [],
        removed: [{ server: DEFAULT_SERVER, userInitiated: true }],
      });

      await client.status.get();
      expect(lastToken()).to.equal(TOKEN);
    });

    it('disposes the listener when disposed', () => {
      expect(changeEmitter.hasListeners()).to.be.true;

      client.dispose();

      expect(changeEmitter.hasListeners()).to.be.false;
    });
  });
});
