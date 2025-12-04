/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import * as sinon from "sinon";
import { InputBox, QuickPick, QuickPickItem } from "vscode";
import { AssignmentManager } from "../jupyter/assignments";
import { DEFAULT_CPU_SERVER } from "../jupyter/servers";
import {
  buildInputBoxStub,
  buildQuickPickStub,
} from "../test/helpers/quick-input";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { Variant, Shape } from "./api";
import { ServerPicker } from "./server-picker";

const STANDARD_T4_SERVER = {
  label: "Colab GPU T4",
  variant: Variant.GPU,
  accelerator: "T4",
};

const STANDARD_A100_SERVER = {
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: "A100",
};

const STANDARD_V6E1_SERVER = {
  label: "Colab TPU V6E1",
  variant: Variant.TPU,
  accelerator: "V6E1",
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

describe("ServerPicker", () => {
  let vsCodeStub: VsCodeStub;
  let assignmentStub: sinon.SinonStubbedInstance<AssignmentManager>;
  let serverPicker: ServerPicker;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    serverPicker = new ServerPicker(vsCodeStub.asVsCode(), assignmentStub);

    assignmentStub.getAssignedServers.resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("prompt", () => {
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

    it("returns undefined when there are no available servers", async () => {
      await expect(serverPicker.prompt([])).to.eventually.equal(undefined);
    });

    it("returns undefined when selecting a variant is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      variantQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.equal(undefined);
    });

    it("returns undefined when selecting an accelerator is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      acceleratorQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it("returns undefined when selecting a shape is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);
      await shapePickerShown;
      shapeQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it("returns undefined when selecting an alias is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it("prompting for an accelerated is skipped when there are none", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);

      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      sinon.assert.called(aliasInputBoxStub.show);
    });

    it("shows a subset of machine shapes for high-mem only GPU", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "V6E1", label: "V6E1" },
      ]);
      await shapePickerShown;
      expect(shapeQuickPickStub.items).to.deep.equal([
        { value: Shape.HIGHMEM, label: "High-RAM" },
      ]);
    });

    it("returns the server type when all prompts are answered", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS_FOR_PRO_USERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.HIGHMEM, label: "High-RAM" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "foo";
      aliasInputBoxStub.onDidChangeValue.yield("foo");
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: "foo",
        variant: Variant.GPU,
        accelerator: "T4",
        shape: Shape.HIGHMEM,
      });
    });

    it("returns a validation error message if over character limit", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "s".repeat(11);
      aliasInputBoxStub.onDidChangeValue.yield(aliasInputBoxStub.value);

      expect(aliasInputBoxStub.validationMessage).to.match(/less than 10/);
    });

    it("returns the server type with the placeholder as the label when the alias is omitted", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(AVAILABLE_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      assignmentStub.getDefaultLabel
        .withArgs(Variant.GPU, "T4")
        .resolves("Colab GPU T4");
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: "Colab GPU T4",
        variant: Variant.GPU,
        accelerator: "T4",
        shape: Shape.STANDARD,
      });
    });

    it("can navigate back when no accelerator was prompted", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      const secondShapeQuickPickStub = stubQuickPickForCall(2);
      const secondShapePickerShown = secondShapeQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondShapePickerShown;
    });

    it("sets the previously specified value when navigating back", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const shapePickerShown = shapeQuickPickStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);
      await shapePickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "foo";
      aliasInputBoxStub.onDidChangeValue.yield("foo");
      // Navigate back.
      const secondShapeQuickPickStub = stubQuickPickForCall(3);
      const secondAcceleratorQuickPickStub = stubQuickPickForCall(4);
      const secondVariantQuickPickStub = stubQuickPickForCall(5);
      const secondShapePickerShown = secondShapeQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondShapePickerShown;
      expect(secondShapeQuickPickStub.activeItems).to.be.deep.equal([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      const secondAcceleratorPickerShown =
        secondAcceleratorQuickPickStub.nextShow();
      secondShapeQuickPickStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondAcceleratorPickerShown;
      expect(secondAcceleratorQuickPickStub.activeItems).to.be.deep.equal([
        { value: "T4", label: "T4" },
      ]);
      const secondVariantPickerShown = secondVariantQuickPickStub.nextShow();
      secondAcceleratorQuickPickStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondVariantPickerShown;
      expect(secondVariantQuickPickStub.activeItems).to.be.deep.equal([
        { value: Variant.GPU, label: "GPU" },
      ]);
    });

    it("sets the right step", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const shapeQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(2);
      expect(shapeQuickPickStub.totalSteps).to.equal(3);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);
      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(3);
      expect(aliasInputBoxStub.totalSteps).to.equal(3);
    });

    it("sets the right step when accelerators are available", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const shapeQuickPickStub = stubQuickPickForCall(2);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const shapePickerShown = shapeQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(AVAILABLE_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(3);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(4);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: "T4", label: "T4" },
      ]);

      await shapePickerShown;
      expect(shapeQuickPickStub.step).to.equal(3);
      expect(shapeQuickPickStub.totalSteps).to.equal(4);

      shapeQuickPickStub.onDidChangeSelection.yield([
        { value: Shape.STANDARD, label: "Standard" },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(4);
      expect(aliasInputBoxStub.totalSteps).to.equal(4);
    });
  });
});
