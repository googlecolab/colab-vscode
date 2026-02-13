/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { InputBox, QuickPick, QuickPickItem } from 'vscode';
import { AssignmentManager } from '../jupyter/assignments';
import { DEFAULT_CPU_SERVER } from '../jupyter/servers';
import {
  buildInputBoxStub,
  buildQuickPickStub,
} from '../test/helpers/quick-input';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { Variant, Shape, ExperimentFlag } from './api';
import { resetFlagsForTest, setFlagForTest } from './experiment-state';
import { ServerPicker } from './server-picker';

const STANDARD_T4_SERVER = {
  label: 'Colab GPU T4',
  variant: Variant.GPU,
  accelerator: 'T4',
};

const STANDARD_A100_SERVER = {
  label: 'Colab GPU A100',
  variant: Variant.GPU,
  accelerator: 'A100',
};

const STANDARD_V6E1_SERVER = {
  label: 'Colab TPU V6E1',
  variant: Variant.TPU,
  accelerator: 'V6E1',
};

const AVAILABLE_SERVERS = [
  DEFAULT_CPU_SERVER,
  STANDARD_T4_SERVER,
  STANDARD_A100_SERVER,
  STANDARD_V6E1_SERVER,
];

const AVAILABLE_SERVERS_FOR_PRO_USERS = [
  ...AVAILABLE_SERVERS.slice(0, 2),
  { ...DEFAULT_CPU_SERVER, shape: Shape.HIGHMEM },
  { ...STANDARD_T4_SERVER, shape: Shape.HIGHMEM },
  { ...STANDARD_A100_SERVER, shape: Shape.HIGHMEM },
  { ...STANDARD_V6E1_SERVER, shape: Shape.HIGHMEM },
];

describe('ServerPicker', () => {
  let vsCodeStub: VsCodeStub;
  let assignmentStub: sinon.SinonStubbedInstance<AssignmentManager>;
  let serverPicker: ServerPicker;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    serverPicker = new ServerPicker(vsCodeStub.asVsCode(), assignmentStub);
    setFlagForTest(ExperimentFlag.RuntimeVersionNames, []);

    // Type assertion needed due to overloading on getServers
    (assignmentStub.getServers as sinon.SinonStub)
      .withArgs('extension')
      .resolves([]);
  });

  afterEach(() => {
    sinon.restore();
    resetFlagsForTest();
  });

  describe('prompt', () => {
    function stubQuickPickForCall(n: number) {
      const stub = buildQuickPickStub();
      vsCodeStub.window.createQuickPick
        .onCall(n)
        .returns(
          stub as Partial<QuickPick<QuickPickItem>> as QuickPick<QuickPickItem>,
        );
      return stub;
    }

    function stubInputBoxForCall(n: number) {
      const stub = buildInputBoxStub();
      vsCodeStub.window.createInputBox
        .onCall(n)
        .returns(stub as Partial<InputBox> as InputBox);
      return stub;
    }

    it('returns undefined when there are no available servers', async () => {
      await expect(serverPicker.prompt([])).to.eventually.equal(undefined);
    });

    it('returns undefined when selecting a variant is cancelled', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      variantQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.equal(undefined);
    });

    it('returns undefined when selecting an accelerator is cancelled', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      acceleratorQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it('returns undefined when selecting a shape is cancelled', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await shapePickerShown;
      shapeQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it('returns undefined when selecting a version is cancelled', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const versionQuickPickStub = stubQuickPickForCall(3);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await shapePickerShown;
      const versionPickerShown = versionQuickPickStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: 'Standard' },
      ]);
      await versionPickerShown;
      versionQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it('returns undefined when selecting an alias is cancelled', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it('prompting for an accelerated is skipped when there are none', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);
      await aliasInputShown;
      sinon.assert.notCalled(acceleratorQuickPickStub.show);
    });

    it('skips prompting for machine shapes when accelerator is high-mem only', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'V6E1', label: 'V6E1' },
      ]);
      await aliasInputShown;
      sinon.assert.notCalled(shapeQuickPickStub.show);
    });

    it('returns the server type when all prompts are answered', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const versionQuickPickStub = stubQuickPickForCall(3);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await shapePickerShown;
      const versionPickerShown = versionQuickPickStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.HIGHMEM, label: 'High-RAM' },
      ]);
      await versionPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = 'foo';
      aliasInputBoxStub.onDidChangeValue.yield('foo');
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: 'foo',
        variant: Variant.GPU,
        accelerator: 'T4',
        shape: Shape.HIGHMEM,
        version: 'v1',
      });
    });

    it('returns a validation error message if over character limit', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = 's'.repeat(11);
      aliasInputBoxStub.onDidChangeValue.yield(aliasInputBoxStub.value);

      expect(aliasInputBoxStub.validationMessage).to.match(/less than 10/);
    });

    it('returns the server type with the placeholder as the label when the alias is omitted', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      assignmentStub.getDefaultLabel
        .withArgs(Variant.GPU, 'T4')
        .resolves('Colab GPU T4');
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: 'Colab GPU T4',
        variant: Variant.GPU,
        accelerator: 'T4',
        shape: Shape.STANDARD,
        version: '',
      });
    });

    it('can navigate back when no accelerator was prompted', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);
      await aliasInputShown;
      const secondVariantQuickPickStub = stubQuickPickForCall(1);
      const secondVariantPickerShown = secondVariantQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondVariantPickerShown;
    });

    it('sets the previously specified value when navigating back', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);

      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const versionQuickPickStub = stubQuickPickForCall(3);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);

      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);
      await shapePickerShown;
      const versionPickerShown = versionQuickPickStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.HIGHMEM, label: 'High-RAM' },
      ]);
      await versionPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = 'foo';
      aliasInputBoxStub.onDidChangeValue.yield('foo');
      // Navigate back.
      const secondVersionQuickPickStub = stubQuickPickForCall(4);
      const secondShapeQuickPickStub = stubQuickPickForCall(5);
      const secondAcceleratorQuickPickStub = stubQuickPickForCall(6);
      const secondVariantQuickPickStub = stubQuickPickForCall(7);

      const secondVersionPickerShown = secondVersionQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondVersionPickerShown;
      expect(secondVersionQuickPickStub.activeItems).to.be.deep.equal([
        { value: 'v1', label: 'v1' },
      ]);
      const secondShapePickerShown = secondShapeQuickPickStub.nextShow();
      secondVersionQuickPickStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondShapePickerShown;
      expect(secondShapeQuickPickStub.activeItems).to.be.deep.equal([
        { value: Shape.HIGHMEM, label: 'High-RAM' },
      ]);
      const secondAcceleratorPickerShown =
        secondAcceleratorQuickPickStub.nextShow();
      secondShapeQuickPickStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondAcceleratorPickerShown;
      expect(secondAcceleratorQuickPickStub.activeItems).to.be.deep.equal([
        { value: 'T4', label: 'T4' },
      ]);
      const secondVariantPickerShown = secondVariantQuickPickStub.nextShow();
      secondAcceleratorQuickPickStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondVariantPickerShown;
      expect(secondVariantQuickPickStub.activeItems).to.be.deep.equal([
        { value: Variant.GPU, label: 'GPU' },
      ]);
    });

    it('sets the right step', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(2);
      expect(aliasInputBoxStub.totalSteps).to.equal(2);
    });

    it('sets the right step when accelerators are available', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(3);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(3);
      expect(aliasInputBoxStub.totalSteps).to.equal(3);
    });

    it('sets the right step when machine shapes are available', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(2);
      expect(shapeQuickPickStub.totalSteps).to.equal(3);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: 'Standard' },
      ]);
      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(3);
      expect(aliasInputBoxStub.totalSteps).to.equal(3);
    });

    it('sets the right step when versions are available', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const versionQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const versionPickerShown = versionQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);

      await versionPickerShown;
      expect(versionQuickPickStub.step).to.equal(2);
      expect(versionQuickPickStub.totalSteps).to.equal(3);

      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);
      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(3);
      expect(aliasInputBoxStub.totalSteps).to.equal(3);
    });

    it('sets the right step when machine shapes and accelerators are available', async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(3);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(3);
      expect(shapeQuickPickStub.totalSteps).to.equal(4);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: 'Standard' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(4);
      expect(aliasInputBoxStub.totalSteps).to.equal(4);
    });

    it('sets the right step when machine shapes and versions are available', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const versionQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const versionPickerShown = versionQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: 'CPU' },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(2);
      expect(shapeQuickPickStub.totalSteps).to.equal(4);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: 'Standard' },
      ]);

      await versionPickerShown;
      expect(versionQuickPickStub.step).to.equal(3);
      expect(versionQuickPickStub.totalSteps).to.equal(4);

      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(4);
      expect(aliasInputBoxStub.totalSteps).to.equal(4);
    });

    it('sets the right step when versions and accelerators are available', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const versionQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const versionPickerShown = versionQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(4);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);

      await versionPickerShown;
      expect(versionQuickPickStub.step).to.equal(3);
      expect(versionQuickPickStub.totalSteps).to.equal(4);

      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(4);
      expect(aliasInputBoxStub.totalSteps).to.equal(4);
    });

    it('sets the right step when versions, machine shapes and accelerators are available', async () => {
      setFlagForTest(ExperimentFlag.RuntimeVersionNames, ['v1', 'v2']);
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const versionQuickPickStub = stubQuickPickForCall(3);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();
      const versionPickerShown = versionQuickPickStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: 'GPU' },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(4);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: 'T4', label: 'T4' },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(3);
      expect(shapeQuickPickStub.totalSteps).to.equal(5);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: 'Standard' },
      ]);
      await versionPickerShown;
      expect(versionQuickPickStub.step).to.equal(4);
      expect(versionQuickPickStub.totalSteps).to.equal(5);

      versionQuickPickStub.onDidChangeSelection.yield([
        { value: 'v1', label: 'v1' },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(5);
      expect(aliasInputBoxStub.totalSteps).to.equal(5);
    });
  });
});
