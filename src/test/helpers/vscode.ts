/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as sinon from 'sinon';
import vscode, { FileSystemError, ThemeIcon } from 'vscode';
import { FakeAuthenticationProviderManager } from './authentication';
import { TestCancellationTokenSource } from './cancellation';
import { TestFileSystemError } from './errors';
import { TestEventEmitter } from './events';
import { TestThemeIcon } from './theme';
import { TestUri } from './uri';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class TestQuickInputButtons implements vscode.QuickInputButtons {
  static readonly Back: vscode.QuickInputButton = {
    iconPath: {
      id: 'back',
    },
  };
}

enum UIKind {
  Desktop = 1,
  Web = 2,
}

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FileChangeType {
  Changed = 1,
  Created = 2,
  Deleted = 3,
}

enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export interface VsCodeStub {
  /**
   * Returns a stub of the vscode module typed as vscode.
   */
  asVsCode: () => typeof vscode;
  ThemeIcon: typeof ThemeIcon;
  Uri: typeof TestUri;
  CancellationTokenSource: typeof TestCancellationTokenSource;
  EventEmitter: typeof TestEventEmitter;
  QuickPickItemKind: typeof QuickPickItemKind;
  DiagnosticSeverity: typeof DiagnosticSeverity;
  FileSystemError: typeof FileSystemError;
  commands: {
    executeCommand: sinon.SinonStubbedMember<
      typeof vscode.commands.executeCommand
    >;
  };
  UIKind: typeof UIKind;
  env: {
    uriScheme: string;
    uiKind: vscode.UIKind;
    openExternal: sinon.SinonStubbedMember<typeof vscode.env.openExternal>;
    asExternalUri: sinon.SinonStubbedMember<typeof vscode.env.asExternalUri>;
  };
  window: {
    withProgress: sinon.SinonStubbedMember<typeof vscode.window.withProgress>;
    showInformationMessage: sinon.SinonStubbedMember<
      typeof vscode.window.showInformationMessage
    >;
    showWarningMessage: sinon.SinonStubbedMember<
      typeof vscode.window.showWarningMessage
    >;
    showErrorMessage: sinon.SinonStubbedMember<
      typeof vscode.window.showErrorMessage
    >;
    showQuickPick: sinon.SinonStubbedMember<typeof vscode.window.showQuickPick>;
    showInputBox: sinon.SinonStubbedMember<typeof vscode.window.showInputBox>;
    showSaveDialog: sinon.SinonStubbedMember<
      typeof vscode.window.showSaveDialog
    >;
    createOutputChannel: sinon.SinonStubbedMember<
      typeof vscode.window.createOutputChannel
    >;
    createInputBox: sinon.SinonStubbedMember<
      typeof vscode.window.createInputBox
    >;
    createQuickPick: sinon.SinonStubbedMember<
      typeof vscode.window.createQuickPick
    >;
  };
  workspace: {
    getConfiguration: sinon.SinonStubbedMember<
      typeof vscode.workspace.getConfiguration
    >;
    getWorkspaceFolder: sinon.SinonStubbedMember<
      typeof vscode.workspace.getWorkspaceFolder
    >;
    updateWorkspaceFolders: sinon.SinonStubbedMember<
      typeof vscode.workspace.updateWorkspaceFolders
    >;
    onDidChangeConfiguration: sinon.SinonStubbedMember<
      typeof vscode.workspace.onDidChangeConfiguration
    >;
    onDidChangeWorkspaceFolders: sinon.SinonStubbedMember<
      typeof vscode.workspace.onDidChangeWorkspaceFolders
    >;
    workspaceFolders: sinon.SinonStubbedMember<
      typeof vscode.workspace.workspaceFolders
    >;
    textDocuments: vscode.TextDocument[];
    fs: {
      stat: sinon.SinonStubbedMember<typeof vscode.workspace.fs.stat>;
      readDirectory: sinon.SinonStubbedMember<
        typeof vscode.workspace.fs.readDirectory
      >;
      createDirectory: sinon.SinonStubbedMember<
        typeof vscode.workspace.fs.createDirectory
      >;
      readFile: sinon.SinonStubbedMember<typeof vscode.workspace.fs.readFile>;
      writeFile: sinon.SinonStubbedMember<typeof vscode.workspace.fs.writeFile>;
      delete: sinon.SinonStubbedMember<typeof vscode.workspace.fs.delete>;
      rename: sinon.SinonStubbedMember<typeof vscode.workspace.fs.rename>;
      copy: sinon.SinonStubbedMember<typeof vscode.workspace.fs.copy>;
      isWritableFileSystem: sinon.SinonStubbedMember<
        typeof vscode.workspace.fs.isWritableFileSystem
      >;
    };
  };
  ExtensionMode: typeof vscode.ExtensionMode;
  FileType: typeof vscode.FileType;
  FileChangeType: typeof vscode.FileChangeType;
  ProgressLocation: typeof ProgressLocation;
  QuickInputButtons: typeof TestQuickInputButtons;
  extensions: {
    getExtension: sinon.SinonStubbedMember<
      typeof vscode.extensions.getExtension
    >;
  };
  authentication: {
    // eslint-disable-next-line @/max-len
    registerAuthenticationProvider: typeof vscode.authentication.registerAuthenticationProvider;
    getSession: typeof vscode.authentication.getSession;
  };
}

/**
 * Creates a new instance of a VsCodeStub.
 *
 * In most cases, tests should avoid re-using instances of this so the stubs
 * don't interfere with each other.
 */
export function newVsCodeStub(): VsCodeStub {
  const fakeAuthentication = new FakeAuthenticationProviderManager();

  return {
    asVsCode: function (): typeof vscode {
      return {
        ...this,
        env: { ...this.env } as Partial<typeof vscode.env> as typeof vscode.env,
        window: {
          ...this.window,
          // The unknown casts are necessary due to the complex overloading.
          /* eslint-disable @/max-len */
          createOutputChannel: this.window
            .createOutputChannel as unknown as typeof vscode.window.createOutputChannel,
          /* eslint-enable @/max-len */
          showQuickPick: this.window
            .showQuickPick as unknown as typeof vscode.window.showQuickPick,
        } as Partial<typeof vscode.window> as typeof vscode.window,
        workspace: this.workspace as Partial<
          typeof vscode.workspace
        > as typeof vscode.workspace,
        commands: { ...this.commands } as Partial<
          typeof vscode.commands
        > as typeof vscode.commands,
        extensions: { ...this.extensions } as Partial<
          typeof vscode.extensions
        > as typeof vscode.extensions,
        authentication: { ...this.authentication } as Partial<
          typeof vscode.authentication
        > as typeof vscode.authentication,
      } as Partial<typeof vscode> as typeof vscode;
    },
    ThemeIcon: TestThemeIcon,
    Uri: TestUri,
    CancellationTokenSource: TestCancellationTokenSource,
    EventEmitter: TestEventEmitter,
    QuickPickItemKind: QuickPickItemKind,
    DiagnosticSeverity: DiagnosticSeverity,
    FileSystemError: TestFileSystemError,
    commands: {
      executeCommand: sinon.stub(),
    },
    UIKind: UIKind,
    env: {
      uriScheme: 'vscode',
      uiKind: UIKind.Desktop,
      openExternal: sinon.stub(),
      asExternalUri: sinon.stub(),
    },
    window: {
      withProgress: sinon.stub(),
      showInformationMessage: sinon.stub(),
      showWarningMessage: sinon.stub(),
      showErrorMessage: sinon.stub(),
      showQuickPick: sinon.stub(),
      showInputBox: sinon.stub(),
      showSaveDialog: sinon.stub(),
      createOutputChannel: sinon.stub(),
      createInputBox: sinon.stub(),
      createQuickPick: sinon.stub(),
    },
    workspace: {
      getConfiguration: sinon.stub(),
      getWorkspaceFolder: sinon.stub(),
      updateWorkspaceFolders: sinon.stub(),
      onDidChangeConfiguration: sinon.stub(),
      onDidChangeWorkspaceFolders: sinon.stub(),
      workspaceFolders: undefined,
      textDocuments: [],
      fs: {
        stat: sinon.stub(),
        readDirectory: sinon.stub(),
        createDirectory: sinon.stub(),
        readFile: sinon.stub(),
        writeFile: sinon.stub(),
        delete: sinon.stub(),
        rename: sinon.stub(),
        copy: sinon.stub(),
        isWritableFileSystem: sinon.stub(),
      },
    },
    ExtensionMode: ExtensionMode,
    FileType: FileType,
    FileChangeType: FileChangeType,
    ProgressLocation: ProgressLocation,
    QuickInputButtons: TestQuickInputButtons,
    extensions: {
      getExtension: sinon.stub(),
    },
    authentication: {
      registerAuthenticationProvider:
        fakeAuthentication.registerAuthenticationProvider.bind(
          fakeAuthentication,
        ),
      getSession: fakeAuthentication.getSession.bind(fakeAuthentication),
    },
  };
}
