/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { newVsCodeStub } from '../../test/helpers/vscode';
// These providers extend VS Code value classes (TreeItem-shaped trees), so
// importing them here as values would pull `require('vscode')` into the
// unit-test bundle (and fail at load time per AGENTS.md). Type-only imports
// keep them out of the runtime; the deps below are minimal structural fakes.
import type { ResourceTreeProvider } from '../resource-monitor/resource-tree';
import type { ContentTreeProvider } from './content-tree';
import { registerContentBrowserCommands } from './register';

describe('registerContentBrowserCommands', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers all expected content browser command IDs', () => {
    const vs = newVsCodeStub();
    vs.commands.registerCommand.callsFake(() => ({ dispose: sinon.stub() }));
    const contentTree = {
      refresh: sinon.stub(),
    } as Partial<ContentTreeProvider> as ContentTreeProvider;
    const resourceTree = {
      refresh: sinon.stub(),
    } as Partial<ResourceTreeProvider> as ResourceTreeProvider;

    const disposables = registerContentBrowserCommands(vs.asVsCode(), {
      contentTree,
      resourceTree,
    });

    const registeredIds = vs.commands.registerCommand
      .getCalls()
      .map((call) => call.args[0]);
    expect(registeredIds).to.have.members([
      'colab.refreshServerContentView',
      'colab.refreshServerResourceView',
      'colab.newFile',
      'colab.newFolder',
      'colab.download',
      'colab.renameFile',
      'colab.deleteFile',
    ]);
    expect(disposables).to.have.lengthOf(registeredIds.length);
  });
});
