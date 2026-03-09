/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { SecretStorage } from 'vscode';
import { SecretStorageFake } from '../test/helpers/secret-storage';
import {
  AuthStorage,
  RefreshableAuthenticationSession,
  TEST_ONLY,
} from './storage';

const SESSIONS_KEY = TEST_ONLY.SESSIONS_KEY;
const SESSION_1: RefreshableAuthenticationSession = {
  id: '1',
  refreshToken: '//42',
  account: { id: 'foo', label: 'bar' },
  scopes: ['baz'],
};
const SESSION_2: RefreshableAuthenticationSession = {
  id: '2',
  refreshToken: 'token-2',
  account: { id: 'user1@gmail.com', label: 'User One' },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
};

describe('AuthStorage', () => {
  let secretsStub: SinonStubbedInstance<SecretStorageFake>;
  let authStorage: AuthStorage;

  beforeEach(() => {
    secretsStub = new SecretStorageFake();
    authStorage = new AuthStorage(
      secretsStub as Partial<SecretStorage> as SecretStorage,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getSessions', () => {
    it('returns an empty array when nothing is stored', async () => {
      secretsStub.get.resolves(undefined);

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([]);
      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });

    it('returns stored sessions', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([SESSION_1, SESSION_2]);
      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });

    it('caches the results after the first read', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      await authStorage.getSessions();
      await authStorage.getSessions();

      sinon.assert.calledOnce(secretsStub.get);
    });

    it('returns an empty array when storage is corrupted', async () => {
      secretsStub.get.resolves('invalid-json-{[}');

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([]);
    });

    it('returns an empty array if schema validation fails', async () => {
      secretsStub.get.resolves(JSON.stringify([{ id: 'missing-fields' }]));

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([]);
    });
  });

  describe('getSession (by scopes)', () => {
    it('finds a session that satisfies requested scopes', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const found = await authStorage.getSession([
        'https://www.googleapis.com/auth/drive.readonly',
      ]);

      expect(found?.id).to.equal(SESSION_2.id);
    });

    it('finds a session that has more scopes than requested', async () => {
      const sessionWithMoreScopes = {
        ...SESSION_2,
        scopes: [...SESSION_2.scopes, 'another-scope'],
      };
      secretsStub.get.resolves(
        JSON.stringify([SESSION_1, sessionWithMoreScopes]),
      );

      const found = await authStorage.getSession(SESSION_2.scopes);

      expect(found?.id).to.equal(SESSION_2.id);
    });

    it('returns undefined if no session satisfies all scopes', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      const found = await authStorage.getSession(['non-existent-scope']);

      expect(found).to.be.undefined;
    });

    it('returns the first session if an empty scope array is requested', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const found = await authStorage.getSession([]);

      expect(found).to.deep.equal(SESSION_1);
    });
  });

  describe('getSessionById', () => {
    it('finds a session by its ID', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const found = await authStorage.getSessionById(SESSION_2.id);
      expect(found).to.deep.equal(SESSION_2);
    });

    it('returns undefined if session ID does not exist', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      const found = await authStorage.getSessionById('non-existent-id');
      expect(found).to.be.undefined;
    });
  });

  describe('storeSession', () => {
    it('stores a single session', async () => {
      await authStorage.storeSession(SESSION_1);

      sinon.assert.calledWith(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([SESSION_1]),
      );
    });

    it('adds a new session when it has a non-existent ID', async () => {
      await authStorage.storeSession(SESSION_1);
      await authStorage.storeSession(SESSION_2);

      const sessions = await authStorage.getSessions();
      expect(sessions.length).to.equal(2);

      const lastCall = secretsStub.store.lastCall;
      expect(lastCall.args[1]).to.contain(SESSION_1.id);
      expect(lastCall.args[1]).to.contain(SESSION_2.id);
    });

    it('updates an existing session if the ID matches', async () => {
      await authStorage.storeSession(SESSION_1);
      const updatedSession = { ...SESSION_1, refreshToken: 'new-token' };

      await authStorage.storeSession(updatedSession);

      const sessions = await authStorage.getSessions();
      expect(sessions.length).to.equal(1);
      expect(sessions[0].refreshToken).to.equal('new-token');
    });

    it('updates the cache after storing', async () => {
      await authStorage.getSessions();
      secretsStub.get.resetHistory();

      await authStorage.storeSession(SESSION_1);
      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([SESSION_1]);
      sinon.assert.notCalled(secretsStub.get);
    });
  });

  describe('removeSession', () => {
    it('returns undefined if session does not exist', async () => {
      const result = await authStorage.removeSession('non-existent');

      expect(result).to.be.undefined;
      sinon.assert.notCalled(secretsStub.delete);
    });

    it('deletes the storage key entirely when the last session is removed', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      const removed = await authStorage.removeSession(SESSION_1.id);

      expect(removed).to.deep.equal(SESSION_1);
      sinon.assert.calledOnceWithExactly(secretsStub.delete, SESSIONS_KEY);
    });

    it('removes only the specified session from a multi-session list', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const removed = await authStorage.removeSession(SESSION_1.id);

      expect(removed).to.deep.equal(SESSION_1);
      sinon.assert.calledWith(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([SESSION_2]),
      );
    });
  });
});
