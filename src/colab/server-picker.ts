import vscode, { QuickPickItem } from "vscode";
import { InputStep, MultiStepInput } from "../common/multi-step-quickpick";
import { ColabServerDescriptor } from "../jupyter/servers";
import { Accelerator, Variant } from "./api";

export class ServerPicker {
  constructor(private readonly vs: typeof vscode) {}

  /**
   * Prompt the user through a multi-step series of inputs to pick a Colab
   * server type.
   *
   * @param vs The vscode module.
   * @param availableServers The available servers to pick from.
   * @returns The selected server, or undefined if the user cancels.
   */
  async prompt(
    availableServers: ColabServerDescriptor[],
  ): Promise<ColabServerDescriptor | undefined> {
    const variantToAccelerators = new Map<Variant, Set<Accelerator>>();
    for (const server of availableServers) {
      const accelerators =
        variantToAccelerators.get(server.variant) ?? new Set();
      accelerators.add(server.accelerator ?? Accelerator.NONE);
      variantToAccelerators.set(server.variant, accelerators);
    }
    if (variantToAccelerators.size === 0) {
      return undefined;
    }

    const state: Partial<Server> = {};
    await MultiStepInput.run(this.vs, (input) =>
      promptForVariant(input, state, variantToAccelerators),
    );
    if (
      state.variant === undefined ||
      state.accelerator === undefined ||
      !state.alias
    ) {
      return undefined;
    }
    return {
      label: state.alias,
      variant: state.variant,
      accelerator: state.accelerator,
    };
  }
}

interface Server {
  variant: Variant;
  accelerator: Accelerator;
  alias: string;
}

/**
 * A partial of {@link Server} with all properties optional except for K.
 */
type ServerWith<K extends keyof Server> = Partial<Server> &
  Required<Pick<Server, K>>;

function isVariantDefined(
  state: Partial<Server>,
): state is ServerWith<"variant"> {
  return state.variant !== undefined;
}

function isAcceleratorDefined(
  state: Partial<Server>,
): state is ServerWith<"accelerator"> {
  return state.accelerator !== undefined;
}

function variantToString(variant: Variant): string {
  switch (variant) {
    case Variant.DEFAULT:
      return "CPU";
    case Variant.GPU:
      return "GPU";
    case Variant.TPU:
      return "TPU";
  }
}

interface VariantPick extends QuickPickItem {
  value: Variant;
}

interface AcceleratorPick extends QuickPickItem {
  value: Accelerator;
}

async function promptForVariant(
  input: MultiStepInput,
  state: Partial<Server>,
  acceleratorsByVariant: Map<Variant, Set<Accelerator>>,
): Promise<InputStep | undefined> {
  const items: VariantPick[] = [];
  for (const variant of acceleratorsByVariant.keys()) {
    items.push({
      value: variant,
      label: variantToString(variant),
      // TODO: Add a description for each variant?
    });
  }
  const pick = await input.showQuickPick({
    title: "Select a variant",
    step: 1,
    totalSteps: 2,
    items,
    activeItem: items.find((item) => item.value === state.variant),
  });
  state.variant = pick.value;
  if (!isVariantDefined(state)) {
    return;
  }
  // Skip prompting for an accelerator for the default variant (CPU).
  if (state.variant === Variant.DEFAULT) {
    state.accelerator = Accelerator.NONE;
    return (input: MultiStepInput) => promptForAlias(input, state);
  }
  return (input: MultiStepInput) =>
    promptForAccelerator(input, state, acceleratorsByVariant);
}

async function promptForAccelerator(
  input: MultiStepInput,
  state: ServerWith<"variant">,
  acceleratorsByVariant: Map<Variant, Set<Accelerator>>,
): Promise<InputStep | undefined> {
  const accelerators = acceleratorsByVariant.get(state.variant) ?? new Set();
  const items: AcceleratorPick[] = [];
  for (const accelerator of accelerators) {
    items.push({
      value: accelerator,
      label: accelerator,
    });
  }
  const pick = await input.showQuickPick({
    title: "Select an accelerator",
    step: 2,
    // Since we have to pick an accelerator, we've added a step.
    totalSteps: 3,
    items,
    activeItem: items.find((item) => item.value === state.accelerator),
  });
  state.accelerator = pick.value;
  if (!isAcceleratorDefined(state)) {
    return;
  }

  return (input: MultiStepInput) => promptForAlias(input, state);
}

async function promptForAlias(
  input: MultiStepInput,
  state: ServerWith<"variant">,
): Promise<InputStep | undefined> {
  const acceleratorPart =
    state.accelerator && state.accelerator !== Accelerator.NONE
      ? ` ${state.accelerator}`
      : "";
  const placeholder = `Colab ${variantToString(state.variant)}${acceleratorPart}`;
  const alias = await input.showInputBox({
    title: "Alias your server",
    step: 3,
    totalSteps: 3,
    // TODO: Incrementally number the same variant/server machines. E.g. Colab CPU (1), Colab GPU A100 (2).
    value: state.alias ?? "",
    prompt: "Provide a local convenience alias to the server.",
    validate: (value) => {
      if (value.length > 10) {
        return "Name must be less than 10 characters.";
      }
      return undefined;
    },
    placeholder,
  });
  state.alias = alias ? alias : placeholder;
  return;
}
