/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { newVsCodeStub } from '../test/helpers/vscode';
import { createDriveModule } from './module';

describe('createDriveModule', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers drive commands', () => {
    const vs = newVsCodeStub();
    vs.commands.registerCommand.callsFake(() => ({ dispose: sinon.stub() }));
    const authProvider = sinon.createStubInstance(GoogleAuthProvider);

    const result = createDriveModule(vs.asVsCode(), authProvider);

    expect(result.commandDisposables)
      .to.be.an('array')
      .with.length.greaterThan(0);
    const registeredIds = vs.commands.registerCommand
      .getCalls()
      .map((call) => call.args[0]);
    expect(registeredIds).to.include('colab.importNotebookFromUrl');
  });
});
