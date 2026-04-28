/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { newVsCodeStub } from '../../test/helpers/vscode';
import { DriveClient } from '../client';
import { IMPORT_NOTEBOOK_FROM_URL } from './constants';
import { registerDriveCommands } from './register';

describe('registerDriveCommands', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers the import-notebook-from-url command', () => {
    const vs = newVsCodeStub();
    vs.commands.registerCommand.callsFake(() => ({ dispose: sinon.stub() }));
    const driveClient = sinon.createStubInstance(DriveClient);

    const disposables = registerDriveCommands(vs.asVsCode(), {
      driveClient,
    });

    const registeredIds = vs.commands.registerCommand
      .getCalls()
      .map((call) => call.args[0]);
    expect(registeredIds).to.deep.equal([IMPORT_NOTEBOOK_FROM_URL.id]);
    expect(disposables).to.have.lengthOf(1);
  });
});
