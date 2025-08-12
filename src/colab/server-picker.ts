/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from "vscode";
import { InputStep, MultiStepInput } from "../common/multi-step-quickpick";
import { AssignmentManager } from "../jupyter/assignments";
import { ColabServerDescriptor } from "../jupyter/servers";
import { Accelerator, Variant } from "./api";

/** Provides an explanation to the user on updating the server alias. */
export const PROMPT_SERVER_ALIAS =
  "Provide a local convenience alias to the server.";

/** Validates the server alias. */
export const validateServerAlias = (value: string) =>
  value.length > 10 ? "Name must be less than 10 characters." : "";

/**
 * Supports prompting the user to pick a Colab server to be created.
 */
export class ServerPicker {
  constructor(
    private readonly vs: typeof vscode,
    private readonly assignments: AssignmentManager,
  ) {}

  /**
   * Prompt the user through a multi-step series of inputs to pick a Colab
   * server type.
   *
   * @param availableServers - The available servers to pick from.
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
      return;
    }

    const state: Partial<Server> = {};
    await MultiStepInput.run(this.vs, (input) =>
      this.promptForVariant(input, state, variantToAccelerators),
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

  private async promptForVariant(
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
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.variant = pick.value;
    if (!isVariantDefined(state)) {
      return;
    }
    // Skip prompting for an accelerator for the default variant (CPU).
    if (state.variant === Variant.DEFAULT) {
      state.accelerator = Accelerator.NONE;
      return (input: MultiStepInput) => this.promptForAlias(input, state);
    }
    return (input: MultiStepInput) =>
      this.promptForAccelerator(input, state, acceleratorsByVariant);
  }

  private async promptForAccelerator(
    input: MultiStepInput,
    state: PartialServerWith<"variant">,
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
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.accelerator = pick.value;
    if (!isAcceleratorDefined(state)) {
      return;
    }

    return (input: MultiStepInput) => this.promptForAlias(input, state);
  }

  private async promptForAlias(
    input: MultiStepInput,
    state: PartialServerWith<"variant">,
  ): Promise<InputStep | undefined> {
    const placeholder = await this.getPlaceholder(
      state.variant,
      state.accelerator,
    );
    const step =
      state.accelerator && state.accelerator !== Accelerator.NONE ? 3 : 2;
    const alias = await input.showInputBox({
      title: "Alias your server",
      step,
      totalSteps: step,
      value: state.alias ?? "",
      prompt: PROMPT_SERVER_ALIAS,
      validate: validateServerAlias,
      placeholder,
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.alias = alias || placeholder;
    return;
  }

  private async getPlaceholder(
    variant: Variant,
    accelerator?: Accelerator,
  ): Promise<string> {
    const servers = await this.assignments.getAssignedServers();
    const a =
      accelerator && accelerator !== Accelerator.NONE ? ` ${accelerator}` : "";
    const v = variantToString(variant);
    const labelBase = `Colab ${v}${a}`;
    const labelRegex = new RegExp(`^${labelBase}(?:\\s\\((\\d+)\\))?$`);
    const indices = new Set(
      servers
        .map((s) => {
          const match = labelRegex.exec(s.label);
          if (!match) {
            return null;
          }
          if (!match[1]) {
            return 0;
          }
          return +match[1];
        })
        .filter((i) => i !== null),
    );
    let placeholderIdx = 0;
    // Find the first missing index. Follows standard file explorer "duplicate"
    // file naming scheme.
    while (indices.has(placeholderIdx)) {
      placeholderIdx++;
    }
    if (placeholderIdx === 0) {
      return labelBase;
    }
    return `${labelBase} (${placeholderIdx.toString()})`;
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
type PartialServerWith<K extends keyof Server> = Partial<Server> &
  Required<Pick<Server, K>>;

function isVariantDefined(
  state: Partial<Server>,
): state is PartialServerWith<"variant"> {
  return state.variant !== undefined;
}

function isAcceleratorDefined(
  state: Partial<Server>,
): state is PartialServerWith<"accelerator"> {
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
