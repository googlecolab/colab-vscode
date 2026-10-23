/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Disposable, InputBox, QuickPick, QuickPickItem } from 'vscode';
import {
  buildInputBoxStub,
  buildQuickPickStub,
  InputBoxStub,
  QuickPickStub,
} from '../test/helpers/quick-input';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import {
  InputBoxOptions,
  InputFlowAction,
  InputStep,
  MultiStepInput,
  QuickPickOptions,
} from './multi-step-quickpick';

describe('MultiStepQuickPick', () => {
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('run', () => {
    function inputStepStub(): sinon.SinonStub<
      [input: MultiStepInput],
      Thenable<InputStep | undefined>
    > {
      return sinon.stub();
    }

    it('runs a single step', async () => {
      const start = inputStepStub().returns(Promise.resolve(undefined));

      await expect(MultiStepInput.run(vsCodeStub.asVsCode(), start)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnce(start);
    });

    it('runs multiple steps', async () => {
      const second = inputStepStub().returns(Promise.resolve(undefined));
      const first = inputStepStub().returns(Promise.resolve(second));

      await expect(MultiStepInput.run(vsCodeStub.asVsCode(), first)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnce(first);
      sinon.assert.calledOnce(second);
      sinon.assert.callOrder(first, second);
    });

    it('rejects with "back" error when going back from the first step', async () => {
      const first = inputStepStub().throws(InputFlowAction.back);

      await expect(
        MultiStepInput.run(vsCodeStub.asVsCode(), first),
      ).to.eventually.be.rejectedWith(InputFlowAction.back);

      sinon.assert.calledOnce(first);
    });

    it('goes back a step when one past the first', async () => {
      // First > Second > (back) First > Second > Done.
      const second = inputStepStub();
      second.onFirstCall().throws(InputFlowAction.back);
      second.onSecondCall().returns(Promise.resolve(undefined));
      const first = inputStepStub().returns(Promise.resolve(second));

      await expect(MultiStepInput.run(vsCodeStub.asVsCode(), first)).to
        .eventually.be.fulfilled;

      sinon.assert.callOrder(first, second, first, second);
    });

    it('goes back a step when multiple past the first', async () => {
      // First > Second > Third (back) Second > Third > Done.
      const third = inputStepStub();
      third.onFirstCall().throws(InputFlowAction.back);
      third.onSecondCall().returns(Promise.resolve(undefined));
      const second = inputStepStub();
      second.onFirstCall().returns(Promise.resolve(third));
      second.onSecondCall().returns(Promise.resolve(third));
      const first = inputStepStub()
        .onFirstCall()
        .returns(Promise.resolve(second));

      await expect(MultiStepInput.run(vsCodeStub.asVsCode(), first)).to
        .eventually.be.fulfilled;

      sinon.assert.callOrder(first, second, third, second, third);
    });

    it('stops when "cancel" is thrown', async () => {
      const start = inputStepStub().throws(InputFlowAction.cancel);

      await expect(MultiStepInput.run(vsCodeStub.asVsCode(), start)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnce(start);
    });
  });

  describe('showQuickPick', () => {
    const ONLY_FOO: QuickPickOptions<QuickPickItem> = {
      title: 'Select foo',
      step: 1,
      totalSteps: 1,
      items: [{ label: 'foo' }],
    };
    let onDidTriggerButtonDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidHideDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidChangeSelectionDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let quickPickStub: QuickPickStub & { nextShow: () => Promise<void> };

    beforeEach(() => {
      onDidTriggerButtonDisposeStub = {
        dispose: sinon.stub(),
      };
      onDidHideDisposeStub = {
        dispose: sinon.stub(),
      };
      onDidChangeSelectionDisposeStub = {
        dispose: sinon.stub(),
      };

      quickPickStub = buildQuickPickStub({
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidChangeSelectionDisposeStub,
        onDidAcceptDisposeStub: { dispose: sinon.stub() },
      });
      vsCodeStub.window.createQuickPick.returns(
        quickPickStub as Partial<
          QuickPick<QuickPickItem>
        > as QuickPick<QuickPickItem>,
      );
    });

    it('rejects on "back"', async () => {
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showQuickPick(ONLY_FOO);
        return undefined;
      };

      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the quick pick has been shown, trigger the back button.
      await inputShown;
      quickPickStub.onDidTriggerButton.yield(vsCodeStub.QuickInputButtons.Back);

      await expect(input).to.eventually.be.rejectedWith(InputFlowAction.back);
      sinon.assert.calledOnce(quickPickStub.dispose);
    });

    it('returns undefined on "cancel"', async () => {
      let selected: QuickPickItem | undefined;
      const step: InputStep = async (input: MultiStepInput) => {
        selected = await input.showQuickPick(ONLY_FOO);
        return undefined;
      };

      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the quick pick has been shown, trigger cancellation by hiding.
      await inputShown;
      quickPickStub.onDidHide.yield();

      await expect(input).to.eventually.be.fulfilled;
      expect(selected).to.equal(undefined);
      sinon.assert.calledOnce(quickPickStub.dispose);
    });

    it('resolves the selected item', async () => {
      let selected: QuickPickItem | undefined;
      const step: InputStep = async (input: MultiStepInput) => {
        selected = await input.showQuickPick(ONLY_FOO);
        return undefined;
      };

      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the quick pick has been shown, select "foo".
      await inputShown;
      quickPickStub.onDidChangeSelection.yield([{ label: 'foo' }]);

      await expect(input).to.eventually.be.fulfilled;
      expect(selected).to.deep.equal({ label: 'foo' });
      sinon.assert.calledOnce(quickPickStub.dispose);
    });

    it('configures the provided options', async () => {
      const opts: QuickPickOptions<QuickPickItem> = {
        title: 'Select foo',
        step: 1,
        totalSteps: 1,
        placeholder: 'foo',
        items: [{ label: 'foo' }],
        activeItem: { label: 'foo' },
        buttons: [vsCodeStub.QuickInputButtons.Back],
        ignoreFocusOut: true,
      };
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showQuickPick(opts);
        return undefined;
      };

      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the quick pick has been shown, evaluate if the right options
      // were set then select "foo".
      await inputShown;
      const { activeItem, ...optsToCompare } = opts;
      expect(quickPickStub).to.deep.include({
        ...optsToCompare,
        activeItems: [activeItem],
      });
      quickPickStub.onDidChangeSelection.yield([{ label: 'foo' }]);

      await expect(input).to.eventually.be.fulfilled;
    });

    it('disposes the input and registered listeners', async () => {
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showQuickPick(ONLY_FOO);
        return undefined;
      };

      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the quick pick has been shown, select "foo".
      await inputShown;
      quickPickStub.onDidChangeSelection.yield([{ label: 'foo' }]);

      await expect(input).to.eventually.be.fulfilled;
      sinon.assert.calledOnce(quickPickStub.dispose);
      for (const disposable of [
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidChangeSelectionDisposeStub,
      ]) {
        sinon.assert.calledOnce(disposable.dispose);
      }
    });
  });

  describe('showQuickPickMany', () => {
    const FOO: QuickPickItem = { label: 'foo' };
    const BAR: QuickPickItem = { label: 'bar' };
    const BAZ: QuickPickItem = { label: 'baz' };
    let onDidTriggerButtonDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidHideDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidAcceptDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let quickPickStub: QuickPickStub & { nextShow: () => Promise<void> };

    beforeEach(() => {
      onDidTriggerButtonDisposeStub = { dispose: sinon.stub() };
      onDidHideDisposeStub = { dispose: sinon.stub() };
      onDidAcceptDisposeStub = { dispose: sinon.stub() };
      quickPickStub = buildQuickPickStub({
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidChangeSelectionDisposeStub: { dispose: sinon.stub() },
        onDidAcceptDisposeStub,
      });
      vsCodeStub.window.createQuickPick.returns(
        quickPickStub as Partial<
          QuickPick<QuickPickItem>
        > as QuickPick<QuickPickItem>,
      );
    });

    /** The state of a quick pick when it's accepted. */
    interface Acceptance {
      /** The items to pick from. */
      items: QuickPickItem[];
      /** The checked items. */
      selected: QuickPickItem[];
      /** The highlighted items. */
      active: QuickPickItem[];
    }

    /**
     * Shows a quick pick, then accepts it in the given state.
     *
     * @param acceptance - The state to accept the quick pick in.
     * @returns The items the quick pick resolved with.
     */
    async function accept({
      items,
      selected,
      active,
    }: Acceptance): Promise<QuickPickItem[] | undefined> {
      let picked: QuickPickItem[] | undefined;
      const inputShown = quickPickStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), async (i) => {
        picked = await i.showQuickPickMany({ title: 'Select items', items });
        return undefined;
      });
      await inputShown;
      quickPickStub.selectedItems = selected;
      quickPickStub.activeItems = active;
      quickPickStub.onDidAccept.yield();
      await expect(input).to.eventually.be.fulfilled;
      return picked;
    }

    it('allows selecting multiple items', async () => {
      await accept({ items: [FOO, BAR], selected: [FOO, BAR], active: [] });

      expect(quickPickStub.canSelectMany).to.equal(true);
    });

    // Resolves with the selected items, or the highlighted item if none are
    // selected.
    const ONE = [FOO];
    const THREE = [FOO, BAR, BAZ];
    const cases: (Acceptance & { name: string; picked: QuickPickItem[] })[] = [
      {
        name: 'one item, neither selected nor active',
        items: ONE,
        selected: [],
        active: [],
        picked: [],
      },
      {
        name: 'one item, selected but not active',
        items: ONE,
        selected: [FOO],
        active: [],
        picked: [FOO],
      },
      {
        name: 'one item, active but not selected',
        items: ONE,
        selected: [],
        active: [FOO],
        picked: [FOO],
      },
      {
        name: 'three items, none selected nor active',
        items: THREE,
        selected: [],
        active: [],
        picked: [],
      },
      {
        name: 'three items, none selected and one active',
        items: THREE,
        selected: [],
        active: [BAR],
        picked: [BAR],
      },
      {
        name: 'three items, one selected and none active',
        items: THREE,
        selected: [FOO],
        active: [],
        picked: [FOO],
      },
      {
        name: 'three items, one selected and active',
        items: THREE,
        selected: [FOO],
        active: [FOO],
        picked: [FOO],
      },
      {
        name: 'three items, one selected and another active',
        items: THREE,
        selected: [FOO],
        active: [BAR],
        picked: [FOO],
      },
      {
        name: 'three items, two selected and none active',
        items: THREE,
        selected: [FOO, BAR],
        active: [],
        picked: [FOO, BAR],
      },
      {
        name: 'three items, two selected and one of them active',
        items: THREE,
        selected: [FOO, BAR],
        active: [BAR],
        picked: [FOO, BAR],
      },
      {
        name: 'three items, two selected and the other active',
        items: THREE,
        selected: [FOO, BAR],
        active: [BAZ],
        picked: [FOO, BAR],
      },
      {
        name: 'three items, all selected and none active',
        items: THREE,
        selected: THREE,
        active: [],
        picked: THREE,
      },
      {
        name: 'three items, all selected and one active',
        items: THREE,
        selected: THREE,
        active: [BAR],
        picked: THREE,
      },
    ];
    for (const { name, picked, ...acceptance } of cases) {
      it(`resolves the right items when accepted with ${name}`, async () => {
        expect(await accept(acceptance)).to.deep.equal(picked);
      });
    }

    it('disposes the input and registered listeners', async () => {
      await accept({ items: [FOO, BAR], selected: [FOO], active: [] });

      sinon.assert.calledOnce(quickPickStub.dispose);
      for (const disposable of [
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidAcceptDisposeStub,
      ]) {
        sinon.assert.calledOnce(disposable.dispose);
      }
    });
  });

  describe('showInputBox', () => {
    const ENTER_A_VALUE: InputBoxOptions = {
      title: 'Got a value?',
      step: 1,
      totalSteps: 1,
      value: '',
      prompt: 'Enter a value',
      validate: () => undefined,
    };
    let onDidTriggerButtonDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidHideDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidAcceptDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let onDidChangeValueDisposeStub: sinon.SinonStubbedInstance<Disposable>;
    let inputBoxStub: InputBoxStub & { nextShow: () => Promise<void> };

    beforeEach(() => {
      onDidTriggerButtonDisposeStub = {
        dispose: sinon.stub(),
      };
      onDidHideDisposeStub = {
        dispose: sinon.stub(),
      };
      onDidAcceptDisposeStub = {
        dispose: sinon.stub(),
      };
      onDidChangeValueDisposeStub = {
        dispose: sinon.stub(),
      };

      inputBoxStub = buildInputBoxStub({
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidAcceptDisposeStub,
        onDidChangeValueDisposeStub,
      });
      vsCodeStub.window.createInputBox.returns(
        inputBoxStub as Partial<InputBox> as InputBox,
      );
    });

    it('rejects on "back"', async () => {
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showInputBox(ENTER_A_VALUE);
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, trigger the back button.
      await inputShown;
      inputBoxStub.onDidTriggerButton.yield(vsCodeStub.QuickInputButtons.Back);

      await expect(input).to.eventually.be.rejectedWith(InputFlowAction.back);
      sinon.assert.calledOnce(inputBoxStub.dispose);
    });

    it('returns undefined on "cancel"', async () => {
      let entered: string | undefined;
      const step: InputStep = async (input: MultiStepInput) => {
        entered = await input.showInputBox(ENTER_A_VALUE);
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, trigger cancellation by hiding.
      await inputShown;
      inputBoxStub.onDidHide.yield();

      await expect(input).to.eventually.be.fulfilled;
      expect(entered).to.equal(undefined);
      sinon.assert.calledOnce(inputBoxStub.dispose);
    });

    it('resolves the selected item', async () => {
      let entered: string | undefined;
      const step: InputStep = async (input: MultiStepInput) => {
        entered = await input.showInputBox(ENTER_A_VALUE);
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, enter "foo".
      await inputShown;
      inputBoxStub.value = 'foo';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      inputBoxStub.onDidAccept.yield();

      await expect(input).to.eventually.be.fulfilled;
      expect(entered).to.deep.equal('foo');
      sinon.assert.calledOnce(inputBoxStub.dispose);
    });

    it('validates the input as it changes', async () => {
      const needFoo = "Nope, need 'foo'";
      let entered: string | undefined;
      const step: InputStep = async (input: MultiStepInput) => {
        entered = await input.showInputBox({
          ...ENTER_A_VALUE,
          validate: (text) => (text === 'foo' ? undefined : needFoo),
        });
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, simulate typing "foo" (character
      // by character).
      await inputShown;
      inputBoxStub.value = 'f';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      expect(inputBoxStub.validationMessage).to.equal(needFoo);
      inputBoxStub.value = 'fo';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      expect(inputBoxStub.validationMessage).to.equal(needFoo);
      inputBoxStub.value = 'foo';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      expect(inputBoxStub.validationMessage).to.equal(undefined);
      inputBoxStub.onDidAccept.yield();

      await expect(input).to.eventually.be.fulfilled;
      expect(entered).to.deep.equal('foo');
      sinon.assert.calledOnce(inputBoxStub.dispose);
    });

    it('configures the provided options', async () => {
      const opts: InputBoxOptions = {
        title: 'Got a value?',
        step: 1,
        totalSteps: 1,
        value: '',
        prompt: 'Enter a value',
        placeholder: '42',
        validate: () => undefined,
        buttons: [vsCodeStub.QuickInputButtons.Back],
        ignoreFocusOut: true,
        password: true,
      };
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showInputBox(opts);
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, evaluate if the right options
      // were set then enter "foo".
      await inputShown;
      const { validate: _, ...optsToCompare } = opts;
      expect(inputBoxStub).to.deep.include(optsToCompare);
      inputBoxStub.value = 'foo';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      inputBoxStub.onDidAccept.yield();

      await expect(input).to.eventually.be.fulfilled;
    });

    it('disposes the input and registered listeners', async () => {
      const step: InputStep = async (input: MultiStepInput) => {
        await input.showInputBox(ENTER_A_VALUE);
        return undefined;
      };

      const inputShown = inputBoxStub.nextShow();
      const input = MultiStepInput.run(vsCodeStub.asVsCode(), step);
      // Once the input box has been shown, enter "foo".
      await inputShown;
      inputBoxStub.value = 'foo';
      inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
      inputBoxStub.onDidAccept.yield();

      await expect(input).to.eventually.be.fulfilled;
      sinon.assert.calledOnce(inputBoxStub.dispose);
      for (const disposable of [
        onDidTriggerButtonDisposeStub,
        onDidHideDisposeStub,
        onDidAcceptDisposeStub,
        onDidChangeValueDisposeStub,
      ]) {
        sinon.assert.calledOnce(disposable.dispose);
      }
    });
  });
});
