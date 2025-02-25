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
  static back = new InputFlowAction("back");
  static cancel = new InputFlowAction("cancel");
}

/**
 * Represents a chainable step in the input flow.
 */
export type InputStep = (
  input: MultiStepInput,
) => Thenable<InputStep | undefined>;

/**
 * The base options for all quick-input types.
 */
export interface QuickInputOptions {
  title: string;
  step: number;
  totalSteps: number;
  ignoreFocusOut?: boolean;
}

/**
 * The options for a quick pick input.
 */
export interface QuickPickOptions<T extends QuickPickItem>
  extends QuickInputOptions {
  items: T[];
  placeholder?: string;
  activeItem?: T;
}

/**
 * The options for an input box input.
 */
export interface InputBoxOptions extends QuickInputOptions {
  value: string;
  prompt: string;
  validate: (value: string) => string | undefined;
  placeholder?: string;
}

/**
 * A chainable multi-step runner for quick-inputs.
 */
export class MultiStepInput {
  private constructor(private readonly vs: typeof vscode) {}

  private steps: InputStep[] = [];
  private current?: QuickInput;

  /**
   * Runs the input flow.
   *
   * @param vs The vscode module.
   * @param start The first step in the input flow.
   * @returns A promise that resolves when the input flow is complete.
   * @throws {InputFlowAction.back} If the back button was clicked on the first
   * step, giving callers the chance to navigate back to the previous input.
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
   * @param opts The options for the quick pick input.
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
        input.ignoreFocusOut = opts.ignoreFocusOut ?? false;
        input.placeholder = opts.placeholder;
        input.items = opts.items;
        if (opts.activeItem) {
          input.activeItems = [opts.activeItem];
        }
        input.buttons = [this.vs.QuickInputButtons.Back];

        const nav = this.configureNavigation(input, reject);
        disposables.push(nav.onDidHide, nav.onDidTriggerButton);

        disposables.push(
          input.onDidChangeSelection((selectedItems) => {
            resolve(selectedItems[0]);
          }),
        );

        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      disposables.forEach((d) => d.dispose());
    }
  }

  /**
   * Creates and shows an input box.
   *
   * @param opts The options for the input box.
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
        input.ignoreFocusOut = opts.ignoreFocusOut ?? false;
        input.placeholder = opts.placeholder;
        input.buttons = [this.vs.QuickInputButtons.Back];

        const nav = this.configureNavigation(input, reject);
        disposables.push(nav.onDidHide, nav.onDidTriggerButton);

        // Handle value confirmation.
        disposables.push(
          input.onDidAccept(() => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            if (!opts.validate(value)) {
              resolve(value);
            }
            input.enabled = true;
            input.busy = false;
          }),
        );

        // Input validation.
        disposables.push(
          input.onDidChangeValue((text) => {
            input.validationMessage = opts.validate(text);
          }),
        );

        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      disposables.forEach((d) => d.dispose());
    }
  }

  /**
   * Configure the input for back navigation and hide events.
   */
  private configureNavigation(
    input: QuickInput & { onDidTriggerButton: Event<QuickInputButton> },
    reject: (reason?: unknown) => void,
  ): { onDidTriggerButton: Disposable; onDidHide: Disposable } {
    return {
      onDidTriggerButton: input.onDidTriggerButton(() => {
        reject(InputFlowAction.back);
      }),
      onDidHide: input.onDidHide(() => {
        reject(InputFlowAction.cancel);
      }),
    };
  }
}
