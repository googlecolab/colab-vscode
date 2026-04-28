/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from '@vscode/jupyter-extension';
import { expect } from 'chai';
import * as sinon from 'sinon';
import vscode, {
  type Disposable,
  EventEmitter,
  type Extension,
  type ExtensionContext,
  type SecretStorage,
} from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { ColabClient } from '../colab/client';
import {
  COLAB_TOOLBAR,
  MOUNT_DRIVE,
  MOUNT_SERVER,
  OPEN_TERMINAL,
  REMOVE_SERVER,
  SIGN_OUT,
  UPLOAD,
} from '../colab/commands/constants';
import { ConnectionRefreshController } from '../colab/connection-refresher';
import { ServerKeepAliveController } from '../colab/keep-alive';
import { ContentsFileSystemProvider } from './contents/file-system';
import { createJupyterModule, JupyterModule } from './module';

describe('createJupyterModule', () => {
  let result: JupyterModule | undefined;
  let context: ExtensionContext;
  let jupyter: Extension<Jupyter>;
  let authProvider: sinon.SinonStubbedInstance<GoogleAuthProvider>;
  let colabClient: sinon.SinonStubbedInstance<ColabClient>;
  let fsStub: sinon.SinonStubbedMember<
    typeof vscode.workspace.registerFileSystemProvider
  >;
  let treeStub: sinon.SinonStubbedMember<typeof vscode.window.createTreeView>;
  let cmdStub: sinon.SinonStubbedMember<typeof vscode.commands.registerCommand>;

  beforeEach(() => {
    // ExtensionContext is an interface, so we can't use createStubInstance.
    // Provide just the `secrets` member that the factory's transitive
    // constructors read at construction time.
    context = {
      secrets: {
        get: sinon.stub().resolves(undefined),
        store: sinon.stub().resolves(),
        delete: sinon.stub().resolves(),
        onDidChange: sinon.stub(),
      } satisfies SecretStorage,
    } as Partial<ExtensionContext> as ExtensionContext;
    // Using the real jupyter extension would register a real `colab` server
    // collection with it (a side effect that persists across tests). Stub it.
    jupyter = {
      exports: {
        createJupyterServerCollection: sinon.stub().returns({
          dispose: sinon.stub(),
        }),
      } as Partial<Jupyter> as Jupyter,
    } as Partial<Extension<Jupyter>> as Extension<Jupyter>;
    authProvider = sinon.createStubInstance(GoogleAuthProvider);
    // `onDidChangeSessions` is a constructor-set property, not a method, so
    // createStubInstance leaves it undefined; install a real Event so that
    // the factory's listener subscriptions don't blow up.
    Object.defineProperty(authProvider, 'onDidChangeSessions', {
      value: new EventEmitter<unknown>().event,
    });
    colabClient = sinon.createStubInstance(ColabClient);

    // The integration host already has the activated extension's `colab` FS
    // provider, the two tree views, and all of the command IDs registered.
    // To keep the factory exercise from colliding with the real extension,
    // stub the registration entry points on the real `vscode` module. We can
    // still assert what the factory tried to register by inspecting these
    // stubs.
    const fakeDisposable: Disposable = { dispose: sinon.stub() };
    fsStub = sinon
      .stub(vscode.workspace, 'registerFileSystemProvider')
      .returns(fakeDisposable);
    treeStub = sinon.stub(vscode.window, 'createTreeView').returns({
      dispose: sinon.stub(),
    } as Partial<vscode.TreeView<unknown>> as vscode.TreeView<unknown>);
    cmdStub = sinon
      .stub(vscode.commands, 'registerCommand')
      .returns(fakeDisposable);
  });

  afterEach(() => {
    // Order matters: command handlers should deregister before the services
    // they depend on tear down (matches the order in `extension.ts`).
    if (result) {
      result.commandDisposables.forEach((d) => {
        d.dispose();
      });
      result.disposables.forEach((d) => {
        d.dispose();
      });
      result = undefined;
    }
    sinon.restore();
  });

  function activate(): JupyterModule {
    result = createJupyterModule(
      vscode,
      context,
      jupyter,
      authProvider,
      colabClient,
    );
    return result;
  }

  it('returns the assignment manager', () => {
    const module = activate();

    expect(module.assignmentManager).to.exist;
  });

  it('registers the colab file system provider with the right options', () => {
    activate();

    sinon.assert.calledOnce(fsStub);
    expect(fsStub.firstCall.args[0]).to.equal('colab');
    expect(fsStub.firstCall.args[1]).to.be.instanceOf(
      ContentsFileSystemProvider,
    );
    expect(fsStub.firstCall.args[2]).to.deep.equal({ isCaseSensitive: true });
  });

  it('creates the two tree views with the expected IDs', () => {
    activate();

    const viewIds = treeStub.getCalls().map((call) => call.args[0]);
    expect(viewIds).to.have.members([
      'colab-server-content-view',
      'colab-server-resource-view',
    ]);
  });

  it('registers the colab and content-browser commands', () => {
    activate();

    const registeredIds = cmdStub.getCalls().map((call) => call.args[0]);
    // Spot-check a representative subset; the full lists are covered by the
    // per-feature `register.unit.test.ts` files.
    expect(registeredIds).to.include.members([
      // Colab commands.
      SIGN_OUT.id,
      MOUNT_SERVER.id,
      MOUNT_DRIVE.id,
      REMOVE_SERVER.id,
      UPLOAD.id,
      COLAB_TOOLBAR.id,
      OPEN_TERMINAL.id,
      // Content-browser commands.
      'colab.refreshServerContentView',
      'colab.refreshServerResourceView',
      'colab.newFile',
      'colab.newFolder',
      'colab.download',
      'colab.renameFile',
      'colab.deleteFile',
    ]);
  });

  it('exposes the connection refresher and keep-alive as toggles', () => {
    const module = activate();

    expect(module.toggles).to.have.lengthOf(2);
    expect(
      module.toggles.some((t) => t instanceof ConnectionRefreshController),
    ).to.equal(true);
    expect(
      module.toggles.some((t) => t instanceof ServerKeepAliveController),
    ).to.equal(true);
  });

  it('returns non-empty service and command disposable lists', () => {
    const module = activate();

    expect(module.disposables).to.be.an('array').with.length.greaterThan(0);
    expect(module.commandDisposables)
      .to.be.an('array')
      .with.length.greaterThan(0);
  });
});
