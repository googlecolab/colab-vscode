/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Identifying information for a Colab command. */
export interface Command {
  /** The human readable label of the registered command. */
  label: string;
  /** An optional description of the command. */
  description?: string;
}

/** Identifying information for a Colab-registered command. */
export interface RegisteredCommand extends Command {
  /** The ID of the registered command. */
  id: string;
}

/** Command to open the toolbar command selection. */
export const COLAB_TOOLBAR: RegisteredCommand = {
  id: "colab.toolbarCommand",
  label: "Colab",
};

/** Command to sign out. */
export const SIGN_OUT: RegisteredCommand = {
  id: "colab.signOut",
  label: "Sign Out",
};

/** Command to trigger the sign-in flow, to view existing Colab servers. */
export const SIGN_IN_VIEW_EXISTING: Command = {
  label: "$(sign-in)  View Existing Servers",
  description: "Click to sign-in...",
};

/** Command to auto-connect a Colab server. */
export const AUTO_CONNECT: Command = {
  label: "$(symbol-event)  Auto Connect",
  description: "1-click connect! Most recently created server, or a new one.",
};

/** Command to create a new Colab server. */
export const NEW_SERVER: Command = {
  label: "$(add)  New Colab Server",
  description: "CPU, GPU or TPU.",
};

/** Command to open Colab in the browser. */
export const OPEN_COLAB_WEB: Command = {
  label: "$(link-external)  Open Colab Web",
  description: "Open Colab web.",
};

/** Command to remove a server. */
export const REMOVE_SERVER: RegisteredCommand = {
  id: "colab.removeServer",
  label: "Remove Server",
};

/** Command to rename a server alias. */
export const RENAME_SERVER_ALIAS: RegisteredCommand = {
  id: "colab.renameServerAlias",
  label: "Rename Server Alias",
};

/** Command to open the Colab signup page, to upgrade to pro. */
export const UPGRADE_TO_PRO: Command = {
  label: "$(accounts-view-bar-icon)  Upgrade to Pro",
  description: "More machines, more quota, more Colab!",
};
