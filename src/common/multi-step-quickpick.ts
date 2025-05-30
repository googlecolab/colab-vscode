import {
  QuickPickItem,
  Disposable,
  QuickInput,
  Event,
  QuickInputButton,
} from "vscode";
import vscode from "vscode";

/**
 * Represents an action that can be taken during an input flow.
 */
export class InputFlowAction extends Error {
  /** Navigate back in the input flow. */
  static back = new InputFlowAction("back");
  /** Cancel the input flow. */
  static cancel = new InputFlowAction("cancel");
}

/**
 * Represents a chainable step in the input flow.
 *
 * An {@link InputStep} can be returned to chain the next step in the input
 * flow. If undefined is returned, the input flow is complete.
 */
export type InputStep = (
  input: MultiStepInput,
) => Thenable<InputStep | undefined>;

/**
 * The base options for all quick-input types.
 */
export interface QuickInputOptions {
  /** The title of the input. */
  title: string;
  /** The current step count. */
  step?: number;
  /** The total step count. */
  totalSteps?: number;
  /** Buttons for actions in the UI. */
  buttons?: QuickInputButton[];
}

/**
 * The options for a quick pick input.
 */
export interface QuickPickOptions<T extends QuickPickItem>
  extends QuickInputOptions {
  /** Items to pick from. */
  items: T[];
  /** The optional placeholder text shown when no value has been input. */
  placeholder?: string;
  /** The actively picked item. */
  activeItem?: T;
}

/**
 * The options for an input box input.
 */
export interface InputBoxOptions extends QuickInputOptions {
  /** The current value of the input box. */
  value: string;
  /** The prompt text providing some ask or explanation to the user. */
  prompt: string;
  /** A function that validates the input value. If a string is returned, it is
   * set as the validation message indicating a problem with the current input
   * value. If undefined is returned, the validation message is cleared. */
  validate: (value: string) => string | undefined;
  /** The optional placeholder text shown when no value has been input. */
  placeholder?: string;
}

/**
 * A chainable multi-step runner for quick-inputs.
 */
export class MultiStepInput {
  private constructor(readonly vs: typeof vscode) {}

  private readonly steps: InputStep[] = [];
  private current?: QuickInput;

  /**
   * Runs the input flow.
   *
   * @param vs - The vscode module.
   * @param start - The first step in the input flow.
   * @returns A promise that resolves when the input flow is complete.
   * @throws {@link InputFlowAction.back} If the back button was clicked on the
   * first step, giving callers the chance to navigate back to the previous
   * input.
   */
  static async run(vs: typeof vscode, start: InputStep): Promise<void> {
    const input = new MultiStepInput(vs);
    return input.step(start);
  }

  private async step(start: InputStep): Promise<void> {
    let step: InputStep | undefined = start;
    try {
      while (step) {
        this.steps.push(step);
        if (this.current) {
          this.current.enabled = false;
          this.current.busy = true;
        }
        try {
          step = await step(this);
        } catch (err) {
          switch (err) {
            case InputFlowAction.back:
              this.steps.pop();
              // "Back" was hit on the first step.
              if (this.steps.length === 0) {
                throw err;
              }
              step = this.steps.pop();
              break;
            case InputFlowAction.cancel:
              step = undefined;
              break;
            default:
              throw err;
          }
        }
      }
    } finally {
      if (this.current) {
        this.current.dispose();
      }
    }
  }

  /**
   * Creates and shows a quick pick input.
   *
   * @param opts - The options for the quick pick input.
   * @returns The selected item.
   */
  async showQuickPick<T extends QuickPickItem>(
    opts: QuickPickOptions<T>,
  ): Promise<T> {
    const disposables: Disposable[] = [];

    try {
      return await new Promise<T>((resolve, reject) => {
        const input = this.vs.window.createQuickPick<T>();
        input.title = opts.title;
        input.step = opts.step;
        input.totalSteps = opts.totalSteps;
        input.placeholder = opts.placeholder;
        input.items = opts.items;
        if (opts.activeItem) {
          input.activeItems = [opts.activeItem];
        }
        if (opts.buttons) {
          input.buttons = opts.buttons;
        }

        const nav = this.configureNavigation(input, reject);

        disposables.push(
          nav.onDidHide,
          nav.onDidTriggerButton,
          input.onDidChangeSelection((selectedItems) => {
            resolve(selectedItems[0]);
          }),
        );

        this.current?.dispose();
        this.current = input;
        this.current.show();
      });
    } finally {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    }
  }

  /**
   * Creates and shows an input box.
   *
   * @param opts - The options for the input box.
   * @returns The entered value.
   */
  async showInputBox(opts: InputBoxOptions): Promise<string> {
    const disposables: Disposable[] = [];

    try {
      return await new Promise<string>((resolve, reject) => {
        const input = this.vs.window.createInputBox();
        input.title = opts.title;
        input.step = opts.step;
        input.totalSteps = opts.totalSteps;
        input.value = opts.value || "";
        input.prompt = opts.prompt;
        input.placeholder = opts.placeholder;
        if (opts.buttons) {
          input.buttons = opts.buttons;
        }

        const nav = this.configureNavigation(input, reject);

        disposables.push(
          nav.onDidHide,
          nav.onDidTriggerButton,
          input.onDidAccept(() => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            const validationMessage = opts.validate(value);
            if (!validationMessage) {
              resolve(value);
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue((text) => {
            input.validationMessage = opts.validate(text);
          }),
        );

        this.current?.dispose();
        this.current = input;
        this.current.show();
      });
    } finally {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    }
  }

  /**
   * Configure the input for back navigation and hide events.
   *
   * This enables callers waiting on the provided input to handle it navigating
   * back by throwing a {@link InputFlowAction.back} or hiding by throwing a
   * {@link InputFlowAction.cancel}.
   */
  private configureNavigation(
    input: QuickInput & { onDidTriggerButton: Event<QuickInputButton> },
    reject: (reason?: unknown) => void,
  ): { onDidTriggerButton: Disposable; onDidHide: Disposable } {
    return {
      onDidTriggerButton: input.onDidTriggerButton((e) => {
        if (e === this.vs.QuickInputButtons.Back) {
          reject(InputFlowAction.back);
        }
      }),
      onDidHide: input.onDidHide(() => {
        reject(InputFlowAction.cancel);
      }),
    };
  }
}
