/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { SecretStorage } from 'vscode';
import { PROVIDER_ID } from '../config/constants';
import { SecretStorageFake } from '../test/helpers/secret-storage';
import { AuthStorage, RefreshableAuthenticationSession } from './storage';

const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;
const SESSION_1: RefreshableAuthenticationSession = {
  id: '1',
  refreshToken: '//42',
  account: { id: 'foo', label: 'bar' },
  scopes: ['baz'],
};
const SESSION_2: RefreshableAuthenticationSession = {
  id: '2',
  refreshToken: '\\43',
  account: { id: 'qux', label: 'quux' },
  scopes: ['corgi'],
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

    it('returns an empty array when storage is corrupted', async () => {
      secretsStub.get.resolves('invalid-json-{[}');

      await expect(authStorage.getSessions()).to.be.rejected;
    });

    it('returns an empty array if schema validation fails', async () => {
      secretsStub.get.resolves(JSON.stringify([{ id: 'missing-fields' }]));

      await expect(authStorage.getSessions()).to.be.rejected;
    });

    it('returns a stored session', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([SESSION_1]);
      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });

    it('returns stored sessions', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const sessions = await authStorage.getSessions();

      expect(sessions).to.deep.equal([SESSION_1, SESSION_2]);
      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });
  });

  describe('getSession', () => {
    it('finds a session that satisfies requested scopes', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1, SESSION_2]));

      const found = await authStorage.getSession(['corgi']);

      expect(found?.id).to.equal(SESSION_2.id);
    });

    it('does not find a session that has more scopes than requested', async () => {
      const sessionWithMoreScopes = {
        ...SESSION_2,
        scopes: [...SESSION_2.scopes, 'another-scope'],
      };
      secretsStub.get.resolves(
        JSON.stringify([SESSION_1, sessionWithMoreScopes]),
      );

      const found = await authStorage.getSession(SESSION_2.scopes);

      expect(found).to.equal(undefined);
    });

    it('returns undefined if no session satisfies all scopes', async () => {
      secretsStub.get.resolves(JSON.stringify([SESSION_1]));

      const found = await authStorage.getSession(['non-existent-scope']);

      expect(found).to.be.undefined;
    });

    it('returns the first session if two sessions have the same scopes', async () => {
      secretsStub.get.resolves(
        JSON.stringify([SESSION_1, { ...SESSION_1, id: SESSION_2.id }]),
      );

      const found = await authStorage.getSession(SESSION_1.scopes);

      expect(found).to.deep.equal(SESSION_1);
    });
  });

  describe('storeSession', () => {
    it('stores a session when no stored sessions exist', async () => {
      await authStorage.storeSession(SESSION_1);

      const sessions = await authStorage.getSessions();
      expect(sessions.length).to.equal(1);

      expect(sessions[0].id).to.equal(SESSION_1.id);
      sinon.assert.calledWith(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([SESSION_1]),
      );
    });

    it('stores a session when no sessions with the same ID exist', async () => {
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
