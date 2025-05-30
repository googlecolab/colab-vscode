import { randomUUID } from "crypto";
import { expect } from "chai";
import * as sinon from "sinon";
import { InputBox, QuickPick, QuickPickItem } from "vscode";
import { AssignmentManager } from "../jupyter/assignments";
import { COLAB_SERVERS, ColabAssignedServer } from "../jupyter/servers";
import {
  buildInputBoxStub,
  buildQuickPickStub,
} from "../test/helpers/quick-input";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { Accelerator, Variant } from "./api";
import { ServerPicker } from "./server-picker";

const ALL_SERVERS = Array.from(COLAB_SERVERS);

describe("ServerPicker", () => {
  let vsCodeStub: VsCodeStub;
  let defaultServer: ColabAssignedServer;
  let assignmentStub: sinon.SinonStubbedInstance<AssignmentManager>;
  let serverPicker: ServerPicker;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    defaultServer = {
      id: randomUUID(),
      label: "Colab GPU T4",
      variant: Variant.GPU,
      accelerator: Accelerator.T4,
      endpoint: "m-s-foo",
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse("https://example.com"),
        token: "123",
        headers: {
          "X-Colab-Runtime-Proxy-Token": "123",
          "X-Colab-Client-Agent": "vscode",
        },
      },
    };
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
      const prompt = serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      variantQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.equal(undefined);
    });

    it("returns undefined when selecting an accelerator is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      acceleratorQuickPickStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it("returns undefined when selecting an alias is cancelled", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: Accelerator.T4, label: "T4" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidHide.yield();

      await expect(prompt).to.eventually.be.undefined;
    });

    it("prompting for an accelerated is skipped when there are none", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);

      await aliasInputShown;
      sinon.assert.notCalled(acceleratorQuickPickStub.show);
    });

    it("returns the server type when all prompts are answered", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: Accelerator.T4, label: "T4" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "foo";
      aliasInputBoxStub.onDidChangeValue.yield("foo");
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: "foo",
        variant: Variant.GPU,
        accelerator: Accelerator.T4,
      });
    });

    it("returns a validation error message if over character limit", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      void serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "s".repeat(11);
      aliasInputBoxStub.onDidChangeValue.yield(aliasInputBoxStub.value);

      expect(aliasInputBoxStub.validationMessage).to.match(/less than 10/);
    });

    it("returns the server type with the placeholder as the label when the alias is omitted", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);

      const variantPickerShown = variantQuickPickStub.nextShow();
      const prompt = serverPicker.prompt(ALL_SERVERS);
      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: Accelerator.T4, label: "T4" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.onDidAccept.yield();

      await expect(prompt).to.eventually.be.deep.equal({
        label: "Colab GPU T4",
        variant: Variant.GPU,
        accelerator: Accelerator.T4,
      });
    });

    describe("alias placeholder", () => {
      async function progressToAliasInput() {
        const variantQuickPickStub = stubQuickPickForCall(0);
        const acceleratorQuickPickStub = stubQuickPickForCall(1);
        const aliasInputBoxStub = stubInputBoxForCall(0);

        const variantPickerShown = variantQuickPickStub.nextShow();
        void serverPicker.prompt(ALL_SERVERS);
        await variantPickerShown;
        const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
        variantQuickPickStub.onDidChangeSelection.yield([
          { value: Variant.GPU, label: "GPU" },
        ]);
        await acceleratorPickerShown;
        const aliasInputShown = aliasInputBoxStub.nextShow();
        acceleratorQuickPickStub.onDidChangeSelection.yield([
          { value: Accelerator.T4, label: "T4" },
        ]);
        await aliasInputShown;
        return aliasInputBoxStub;
      }

      it("shows the simple variant-accelerator placeholder when there are no assigned servers", async () => {
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4");
      });

      it("shows the simple variant-accelerator placeholder when there are only custom aliased servers", async () => {
        const s = { ...defaultServer, label: "foo" };
        assignmentStub.getAssignedServers.resolves([s]);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4");
      });

      it("uses the next sequential placeholder with one assigned server", async () => {
        assignmentStub.getAssignedServers.resolves([defaultServer]);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4 (1)");
      });

      it("uses the next sequential placeholder with multiple assigned servers", async () => {
        const servers = [
          defaultServer,
          {
            ...defaultServer,
            id: randomUUID(),
            label: "Colab GPU T4 (1)",
          },
        ];
        assignmentStub.getAssignedServers.resolves(servers);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4 (2)");
      });

      it("only increments from matching variant-accelerator server pairs", async () => {
        const servers = [
          defaultServer,
          {
            ...defaultServer,
            id: randomUUID(),
            variant: Variant.DEFAULT,
            accelerator: Accelerator.NONE,
            label: "Colab CPU",
          },
          {
            ...defaultServer,
            id: randomUUID(),
            accelerator: Accelerator.A100,
            label: "Colab GPU A100",
          },
          {
            ...defaultServer,
            id: randomUUID(),
            accelerator: Accelerator.A100,
            label: "Colab GPU A100 (1)",
          },
        ];
        assignmentStub.getAssignedServers.resolves(servers);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4 (1)");
      });

      // To ensure a string sort isn't used, which would put "10" before "2".
      it("uses the next sequential placeholder with many assigned servers", async () => {
        const servers = Array.from({ length: 10 }, (_, i) => i + 1)
          .map((i) => ({
            ...defaultServer,
            id: randomUUID(),
            label: `Colab GPU T4 (${i.toString()})`,
          }))
          .concat(defaultServer);
        assignmentStub.getAssignedServers.resolves(servers);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4 (11)");
      });

      it("uses the next sequential placeholder when there's an assigned server gap", async () => {
        const servers = [
          defaultServer,
          {
            ...defaultServer,
            id: randomUUID(),
            label: "Colab GPU T4 (2)",
          },
        ];
        assignmentStub.getAssignedServers.resolves(servers);
        const input = await progressToAliasInput();

        expect(input.placeholder).to.equal("Colab GPU T4 (1)");
      });
    });

    it("can navigate back when no accelerator was prompted", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(ALL_SERVERS);

      await variantPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);
      await aliasInputShown;
      const secondVariantQuickPickStub = stubQuickPickForCall(1);
      const secondVariantPickerShown = secondVariantQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondVariantPickerShown;
    });

    it("sets the previously specified value when navigating back", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();

      void serverPicker.prompt(ALL_SERVERS);

      await variantPickerShown;
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      const aliasInputShown = aliasInputBoxStub.nextShow();
      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: Accelerator.T4, label: "T4" },
      ]);
      await aliasInputShown;
      aliasInputBoxStub.value = "foo";
      aliasInputBoxStub.onDidChangeValue.yield("foo");
      // Navigate back.
      const secondAcceleratorQuickPickStub = stubQuickPickForCall(2);
      const secondVariantQuickPickStub = stubQuickPickForCall(3);
      const secondAcceleratorPickerShown =
        secondAcceleratorQuickPickStub.nextShow();
      aliasInputBoxStub.onDidTriggerButton.yield(
        vsCodeStub.QuickInputButtons.Back,
      );
      await secondAcceleratorPickerShown;
      expect(secondAcceleratorQuickPickStub.activeItems).to.be.deep.equal([
        { value: Accelerator.T4, label: "T4" },
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
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(ALL_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.DEFAULT, label: "CPU" },
      ]);

      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(2);
      expect(aliasInputBoxStub.totalSteps).to.equal(2);
    });

    it("sets the right step when accelerators are available", async () => {
      const variantQuickPickStub = stubQuickPickForCall(0);
      const acceleratorQuickPickStub = stubQuickPickForCall(1);
      const aliasInputBoxStub = stubInputBoxForCall(0);
      const variantPickerShown = variantQuickPickStub.nextShow();
      const acceleratorPickerShown = acceleratorQuickPickStub.nextShow();
      const aliasInputShown = aliasInputBoxStub.nextShow();

      void serverPicker.prompt(ALL_SERVERS);

      await variantPickerShown;
      expect(variantQuickPickStub.step).to.equal(1);
      expect(variantQuickPickStub.totalSteps).to.equal(2);

      variantQuickPickStub.onDidChangeSelection.yield([
        { value: Variant.GPU, label: "GPU" },
      ]);
      await acceleratorPickerShown;
      expect(acceleratorQuickPickStub.step).to.equal(2);
      expect(acceleratorQuickPickStub.totalSteps).to.equal(3);

      acceleratorQuickPickStub.onDidChangeSelection.yield([
        { value: Accelerator.T4, label: "T4" },
      ]);
      await aliasInputShown;
      expect(aliasInputBoxStub.step).to.equal(3);
      expect(aliasInputBoxStub.totalSteps).to.equal(3);
    });
  });
});
