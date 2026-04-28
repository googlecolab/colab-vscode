/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { GoogleAuthProvider } from '../../auth/auth-provider';
import { AssignmentManager } from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { newVsCodeStub } from '../../test/helpers/vscode';
import {
  COLAB_TOOLBAR,
  MOUNT_DRIVE,
  MOUNT_SERVER,
  OPEN_TERMINAL,
  REMOVE_SERVER,
  SIGN_OUT,
  UPLOAD,
} from './constants';
import { registerColabCommands } from './register';

describe('registerColabCommands', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers all expected colab command IDs', () => {
    const vs = newVsCodeStub();
    vs.commands.registerCommand.callsFake(() => ({ dispose: sinon.stub() }));
    const authProvider = sinon.createStubInstance(GoogleAuthProvider);
    const assignmentManager = sinon.createStubInstance(AssignmentManager);
    const fs = sinon.createStubInstance(ContentsFileSystemProvider);

    const disposables = registerColabCommands(vs.asVsCode(), {
      authProvider,
      assignmentManager,
      fs,
    });

    const registeredIds = vs.commands.registerCommand
      .getCalls()
      .map((call) => call.args[0]);
    expect(registeredIds).to.have.members([
      SIGN_OUT.id,
      MOUNT_SERVER.id,
      MOUNT_DRIVE.id,
      REMOVE_SERVER.id,
      UPLOAD.id,
      COLAB_TOOLBAR.id,
      OPEN_TERMINAL.id,
    ]);
    expect(disposables).to.have.lengthOf(registeredIds.length);
  });
});
