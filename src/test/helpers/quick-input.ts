/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as sinon from "sinon";
import { Disposable, InputBox, QuickPick, QuickPickItem } from "vscode";

/**
 * Convenience type used for stubbing the input event listeners.
 */
type Listener = [
  /* eslint-disable @typescript-eslint/no-explicit-any */
  listener: (e: any) => any,
  thisArgs?: any,
  /* eslint-enable @typescript-eslint/no-explicit-any */
  disposables?: Disposable[] | undefined,
];

/**
 * A stub for the required members of {@link QuickPick}.
 */
export type QuickPickStub = sinon.SinonStubbedInstance<
  Pick<
    QuickPick<QuickPickItem>,
    | "title"
    | "step"
    | "totalSteps"
    | "ignoreFocusOut"
    | "placeholder"
    | "items"
    | "activeItems"
    | "buttons"
    | "onDidTriggerButton"
    | "onDidHide"
    | "onDidChangeSelection"
    | "show"
    | "dispose"
  >
>;

export function buildQuickPickStub(
  opts: {
    onDidTriggerButtonDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    onDidHideDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    onDidChangeSelectionDisposeStub: sinon.SinonStubbedInstance<Disposable>;
  } = {
    onDidTriggerButtonDisposeStub: {
      dispose: sinon.stub(),
    },
    onDidHideDisposeStub: {
      dispose: sinon.stub(),
    },
    onDidChangeSelectionDisposeStub: {
      dispose: sinon.stub(),
    },
  },
): QuickPickStub & { nextShow: () => Promise<void> } {
  const showStub: sinon.SinonStub<[], void> = sinon.stub();
  return {
    title: undefined,
    step: undefined,
    totalSteps: undefined,
    ignoreFocusOut: false,
    placeholder: undefined,
    items: [],
    activeItems: [],
    buttons: [],
    onDidTriggerButton: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidTriggerButtonDisposeStub),
    onDidHide: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidHideDisposeStub),
    onDidChangeSelection: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidChangeSelectionDisposeStub),
    show: showStub,
    dispose: sinon.stub(),
    /**
     * A promise that resolves the next time the quick pick is shown.
     */
    nextShow: () =>
      new Promise<void>((resolve) => {
        showStub.callsFake(() => {
          resolve();
        });
      }),
  };
}

/**
 * A stub for the required members of {@link QuickPick}.
 */
export type InputBoxStub = sinon.SinonStubbedInstance<
  Pick<
    InputBox,
    | "title"
    | "step"
    | "totalSteps"
    | "value"
    | "prompt"
    | "validationMessage"
    | "ignoreFocusOut"
    | "placeholder"
    | "buttons"
    | "onDidTriggerButton"
    | "onDidHide"
    | "onDidAccept"
    | "onDidChangeValue"
    | "show"
    | "dispose"
  >
>;

export function buildInputBoxStub(
  opts: {
    onDidTriggerButtonDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    onDidHideDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    onDidAcceptDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    onDidChangeValueDisposeStub: sinon.SinonStubbedInstance<Disposable>;
  } = {
    onDidTriggerButtonDisposeStub: {
      dispose: sinon.stub(),
    },
    onDidHideDisposeStub: {
      dispose: sinon.stub(),
    },
    onDidAcceptDisposeStub: {
      dispose: sinon.stub(),
    },
    onDidChangeValueDisposeStub: {
      dispose: sinon.stub(),
    },
  },
): InputBoxStub & { nextShow: () => Promise<void> } {
  const showStub: sinon.SinonStub<[], void> = sinon.stub();
  return {
    title: undefined,
    step: undefined,
    totalSteps: undefined,
    value: "",
    prompt: undefined,
    validationMessage: undefined,
    ignoreFocusOut: false,
    placeholder: undefined,
    buttons: [],
    onDidTriggerButton: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidTriggerButtonDisposeStub),
    onDidHide: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidHideDisposeStub),
    onDidAccept: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidAcceptDisposeStub),
    onDidChangeValue: sinon
      .stub<Listener, Disposable>()
      .returns(opts.onDidChangeValueDisposeStub),
    show: showStub,
    dispose: sinon.stub(),
    /**
     * A promise that resolves the next time the quick pick is shown.
     */
    nextShow: () =>
      new Promise<void>((resolve) => {
        showStub.callsFake(() => {
          resolve();
        });
      }),
  };
}
