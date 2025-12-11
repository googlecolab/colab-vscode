/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { ThemeIcon } from 'vscode';
import { Command } from './constants';

/**
 * Build a label that's prefixed with the provided icon.
 *
 * This is needed in cases where we want the same styling as a quick pick, but
 * can only provide a simple label (as a string).
 *
 * @param icon - The VS Code icon to prepend the label with.
 * @param label - The label to follow the icon.
 * @returns A string combining the icon and label in the same way quick picks
 * do.
 */
export function buildIconLabel(command: Command) {
  const iconPart = command.icon ? `$(${command.icon})  ` : '';
  return `${iconPart}${command.label}`;
}

/**
 * Strips the icon from the command's labeled, if it is prefixed with one.
 *
 * This is needed in cases where we need to handle commands whose labels were
 * styled with the icon but we need to match against the command's true label
 * (without the icon).
 *
 * @param iconLabel - The label whose icon prefix should be stripped.
 * @returns A string with the optional icon prefix, including the separating
 * spaces, stripped.
 */
export function stripIconLabel(iconLabel: string): string {
  return iconLabel.replace(/^\$\(.+\)\s{2}/, '');
}

/**
 * Build a {@link ThemeIcon} for the command.
 *
 * @param vs - The vscode module.
 * @param command - The command to build a {@link ThemeIcon} for.
 * @returns The {@link ThemeIcon} corresponding to the command's
 * {@link Command.icon | icon} or undefined if the command does not have an
 * icon.
 */
export function commandThemeIcon(
  vs: typeof vscode,
  command: Command,
): ThemeIcon | undefined {
  return command.icon ? new vs.ThemeIcon(command.icon) : undefined;
}
