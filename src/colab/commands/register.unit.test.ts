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
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';
import { newVsCodeStub } from '../../test/helpers/vscode';
import type { ContentItem } from '../content-browser/content-item';
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

  describe('OPEN_TERMINAL command source discrimination', () => {
    type OpenTerminalHandler = (
      sourceOrContextItem?: CommandSource | ContentItem,
      withBackButton?: boolean,
    ) => Promise<void>;

    /**
     * Registers Colab commands and returns the handler bound to
     * `OPEN_TERMINAL.id`.
     *
     * @returns The handler registered for `OPEN_TERMINAL.id`.
     */
    function getOpenTerminalHandler(): OpenTerminalHandler {
      const vs = newVsCodeStub();
      vs.commands.registerCommand.callsFake(() => ({ dispose: sinon.stub() }));
      const authProvider = sinon.createStubInstance(GoogleAuthProvider);
      const assignmentManager = sinon.createStubInstance(AssignmentManager);
      const fs = sinon.createStubInstance(ContentsFileSystemProvider);
      // No assigned servers: openTerminal returns early without further
      // side effects beyond the telemetry call we want to observe.
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      registerColabCommands(vs.asVsCode(), {
        authProvider,
        assignmentManager,
        fs,
      });

      const call = vs.commands.registerCommand
        .getCalls()
        .find((c) => c.args[0] === OPEN_TERMINAL.id);
      if (!call) {
        throw new Error('OPEN_TERMINAL command was not registered');
      }
      return call.args[1] as OpenTerminalHandler;
    }

    it('uses the passed CommandSource when invoked from the notebook toolbar', async () => {
      const logStub = sinon.stub(telemetry, 'logOpenTerminal');
      const handler = getOpenTerminalHandler();

      await handler(CommandSource.COMMAND_SOURCE_COLAB_TOOLBAR);

      sinon.assert.calledOnceWithExactly(
        logStub,
        CommandSource.COMMAND_SOURCE_COLAB_TOOLBAR,
      );
    });

    it('uses COMMAND_SOURCE_TREE_VIEW_INLINE when invoked with a ContentItem', async () => {
      const logStub = sinon.stub(telemetry, 'logOpenTerminal');
      const handler = getOpenTerminalHandler();
      // The wrapper discriminates based on the argument's runtime shape; any
      // non-numeric, non-undefined value takes the tree-view-inline branch.
      // Avoid constructing a real ContentItem to keep this test free of the
      // `vscode` runtime dependency.
      const contextItem = {} as ContentItem;

      await handler(contextItem);

      sinon.assert.calledOnceWithExactly(
        logStub,
        CommandSource.COMMAND_SOURCE_TREE_VIEW_INLINE,
      );
    });

    it('uses COMMAND_SOURCE_COMMAND_PALETTE when invoked with no arguments', async () => {
      const logStub = sinon.stub(telemetry, 'logOpenTerminal');
      const handler = getOpenTerminalHandler();

      await handler();

      sinon.assert.calledOnceWithExactly(
        logStub,
        CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
      );
    });
  });
});
