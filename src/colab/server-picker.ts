/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { InputStep, MultiStepInput } from '../common/multi-step-quickpick';
import { AssignmentManager } from '../jupyter/assignments';
import { ColabServerDescriptor } from '../jupyter/servers';
import {
  Variant,
  variantToMachineType,
  Shape,
  shapeToMachineShape,
  ExperimentFlag,
} from './api';
import { getFlag } from './experiment-state';

/** Provides an explanation to the user on updating the server alias. */
export const PROMPT_SERVER_ALIAS =
  'Provide a local convenience alias to the server.';

/** Validates the server alias. */
export const validateServerAlias = (value: string) =>
  value.length > 10 ? 'Name must be less than 10 characters.' : '';

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
    const variantToAccelerators = new Map<Variant, Set<string>>();
    const acceleratorsToShapes = new Map<string, Set<Shape>>();
    for (const server of availableServers) {
      const serverAccelerator = server.accelerator ?? 'NONE';

      const accelerators =
        variantToAccelerators.get(server.variant) ?? new Set();
      accelerators.add(serverAccelerator);
      variantToAccelerators.set(server.variant, accelerators);

      const shapes = acceleratorsToShapes.get(serverAccelerator) ?? new Set();
      shapes.add(server.shape ?? Shape.STANDARD);
      acceleratorsToShapes.set(serverAccelerator, shapes);
    }
    if (variantToAccelerators.size === 0 || acceleratorsToShapes.size === 0) {
      return;
    }

    const state: Partial<Server> = {};
    const versions = getRuntimeVersions();
    await MultiStepInput.run(this.vs, (input) =>
      this.promptForVariant(
        input,
        state,
        variantToAccelerators,
        acceleratorsToShapes,
        versions,
      ),
    );
    if (
      state.variant === undefined ||
      state.accelerator === undefined ||
      state.shape === undefined ||
      state.version === undefined ||
      !state.alias
    ) {
      return undefined;
    }
    return {
      label: state.alias,
      variant: state.variant,
      accelerator: state.accelerator,
      shape: state.shape,
      version: state.version,
    };
  }

  private async promptForVariant(
    input: MultiStepInput,
    state: Partial<Server>,
    acceleratorsByVariant: Map<Variant, Set<string>>,
    shapesByAccelerators: Map<string, Set<Shape>>,
    versions: string[],
  ): Promise<InputStep | undefined> {
    const items: VariantPick[] = [];
    for (const variant of acceleratorsByVariant.keys()) {
      items.push({
        value: variant,
        label: variantToMachineType(variant),
        // TODO: Add a description for each variant?
      });
    }
    const pick = await input.showQuickPick({
      title: 'Select a variant',
      step: 1,
      totalSteps:
        versions.length > 0
          ? 3 // (1) variant, (2) version and (3) alias
          : 2, // (1) variant and (2) alias
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
      state.accelerator = 'NONE';
      const { defaultShape, shapePicks } = getShapeInfoForAccelerator(
        shapesByAccelerators,
        state.accelerator,
      );
      if (shapePicks.length <= 1) {
        state.shape = defaultShape;
        if (versions.length === 0) {
          state.version = ''; // Latest version
          return (input: MultiStepInput) =>
            this.promptForAlias(input, state, /* totalSteps= */ 2);
        }
        return (input: MultiStepInput) =>
          this.promptForVersion(input, state, versions, /* step= */ 2);
      }
      return (input: MultiStepInput) =>
        this.promptForMachineShape(
          input,
          state,
          shapePicks,
          versions,
          /* step= */ 2,
        );
    }
    return (input: MultiStepInput) =>
      this.promptForAccelerator(
        input,
        state,
        acceleratorsByVariant,
        shapesByAccelerators,
        versions,
      );
  }

  private async promptForAccelerator(
    input: MultiStepInput,
    state: PartialServerWith<'variant'>,
    acceleratorsByVariant: Map<Variant, Set<string>>,
    shapesByAccelerators: Map<string, Set<Shape>>,
    versions: string[],
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
      title: 'Select an accelerator',
      step: 2,
      totalSteps:
        versions.length > 0
          ? 4 // (1) variant, (2) accelerator, (3) version and (4) alias
          : 3, // (1) variant, (2) accelerator, and (3) alias
      items,
      activeItem: items.find((item) => item.value === state.accelerator),
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.accelerator = pick.value;
    if (!isAcceleratorDefined(state)) {
      return;
    }
    const { defaultShape, shapePicks } = getShapeInfoForAccelerator(
      shapesByAccelerators,
      state.accelerator,
    );
    if (shapePicks.length <= 1) {
      state.shape = defaultShape;
      if (versions.length === 0) {
        state.version = ''; // Latest version
        return (input: MultiStepInput) =>
          this.promptForAlias(input, state, /* totalSteps= */ 3);
      }
      return (input: MultiStepInput) =>
        this.promptForVersion(input, state, versions, /* step= */ 3);
    }
    return (input: MultiStepInput) =>
      this.promptForMachineShape(
        input,
        state,
        shapePicks,
        versions,
        /** step= */ 3,
      );
  }

  private async promptForMachineShape(
    input: MultiStepInput,
    state: PartialServerWith<'variant'>,
    items: ShapePick[],
    versions: string[],
    step: number,
  ) {
    const totalSteps =
      versions.length === 0
        ? step + 1 // Add 1 step for alias.
        : step + 2; // Add 2 steps for version and alias.
    const pick = await input.showQuickPick({
      title: 'Select a machine shape',
      step,
      totalSteps,
      items,
      activeItem: items.find((item) => item.value === state.shape),
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.shape = pick.value;
    if (!isShapeDefined(state)) {
      return;
    }
    if (versions.length === 0) {
      state.version = ''; // Latest version
      return (input: MultiStepInput) =>
        this.promptForAlias(input, state, totalSteps);
    }
    return (input: MultiStepInput) =>
      this.promptForVersion(input, state, versions, step + 1);
  }

  private async promptForVersion(
    input: MultiStepInput,
    state: PartialServerWith<'variant'>,
    versions: string[],
    step: number,
  ) {
    const items: RuntimeVersionPick[] = [
      {
        value: '',
        label: 'Latest',
      },
    ];
    for (const version of versions) {
      items.push({
        value: version,
        label: version,
      });
    }
    const totalSteps = step + 1; // Add 1 step for alias.
    const pick = await input.showQuickPick({
      title: 'Select a runtime version',
      step,
      totalSteps,
      items,
      activeItem: items.find((item) => item.value === state.version),
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.version = pick.value;
    if (!isVersionDefined(state)) {
      return;
    }

    return (input: MultiStepInput) =>
      this.promptForAlias(input, state, totalSteps);
  }

  private async promptForAlias(
    input: MultiStepInput,
    state: PartialServerWith<'variant'>,
    totalSteps: number,
  ): Promise<InputStep | undefined> {
    const placeholder = await this.assignments.getDefaultLabel(
      state.variant,
      state.accelerator,
    );
    const alias = await input.showInputBox({
      title: 'Alias your server',
      step: totalSteps,
      totalSteps,
      value: state.alias ?? '',
      prompt: PROMPT_SERVER_ALIAS,
      validate: validateServerAlias,
      placeholder,
      buttons: [input.vs.QuickInputButtons.Back],
    });
    state.alias = alias || placeholder;
    return;
  }
}

interface Server {
  variant: Variant;
  accelerator: string;
  shape: Shape;
  version: string;
  alias: string;
}

/**
 * A partial of {@link Server} with all properties optional except for K.
 */
type PartialServerWith<K extends keyof Server> = Partial<Server> &
  Required<Pick<Server, K>>;

function isVariantDefined(
  state: Partial<Server>,
): state is PartialServerWith<'variant'> {
  return state.variant !== undefined;
}

function isAcceleratorDefined(
  state: Partial<Server>,
): state is PartialServerWith<'accelerator'> {
  return state.accelerator !== undefined;
}

function isShapeDefined(
  state: Partial<Server>,
): state is PartialServerWith<'shape'> {
  return state.shape !== undefined;
}

function isVersionDefined(
  state: Partial<Server>,
): state is PartialServerWith<'version'> {
  return state.version !== undefined;
}

interface VariantPick extends QuickPickItem {
  value: Variant;
}

interface AcceleratorPick extends QuickPickItem {
  value: string;
}

interface ShapePick extends QuickPickItem {
  value: Shape;
}

interface RuntimeVersionPick extends QuickPickItem {
  value: string;
}

function getShapeInfoForAccelerator(
  shapesByAccelerators: Map<string, Set<Shape>>,
  accelerator: string,
): { defaultShape: Shape; shapePicks: ShapePick[] } {
  const shapes = shapesByAccelerators.get(accelerator);
  const shapePicks: ShapePick[] = [];
  if (!shapes) {
    return {
      defaultShape: Shape.STANDARD,
      shapePicks,
    };
  }
  for (const shape of shapes) {
    shapePicks.push({
      value: shape,
      label: shapeToMachineShape(shape),
    });
  }
  return {
    defaultShape: shapePicks.length >= 1 ? shapePicks[0].value : Shape.STANDARD,
    shapePicks,
  };
}

function getRuntimeVersions(): string[] {
  const versions = getFlag(ExperimentFlag.RuntimeVersionNames);
  if (Array.isArray(versions) && versions.every((v) => typeof v === 'string')) {
    return versions;
  }
  return [];
}
