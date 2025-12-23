/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Identifying information for a Colab command. */
export interface Command {
  /** The human readable label of the registered command. */
  readonly label: string;
  /** An optional icon for the command if it appears outside of the command palette. */
  readonly icon?: string;
  /** An optional description of the command. */
  readonly description?: string;
}

/** Identifying information for a Colab-registered command. */
export interface RegisteredCommand extends Command {
  /** The ID of the registered command. */
  readonly id: string;
}

/** Command to open the toolbar command selection. */
export const COLAB_TOOLBAR: RegisteredCommand = {
  id: 'colab.toolbarCommand',
  label: 'Colab',
};

/** Command to sign out. */
export const SIGN_OUT: RegisteredCommand = {
  id: 'colab.signOut',
  label: 'Sign Out',
};

/** Command to trigger the sign-in flow, to view existing Colab servers. */
export const SIGN_IN_VIEW_EXISTING: Command = {
  label: 'View Existing Servers',
  icon: 'sign-in',
  description: 'Click to sign-in...',
};

/** Command to auto-connect a Colab server. */
export const AUTO_CONNECT: Command = {
  label: 'Auto Connect',
  icon: 'symbol-event',
  description: '1-click connect! Most recently created server, or a new one.',
};

/** Command to create a new Colab server. */
export const NEW_SERVER: Command = {
  label: 'New Colab Server',
  icon: 'add',
  description: 'CPU, GPU or TPU.',
};

/** Command to open Colab in the browser. */
export const OPEN_COLAB_WEB: Command = {
  label: 'Open Colab Web',
  icon: 'link-external',
  description: 'Open Colab web.',
};

/** Command to mount a server's file-system. */
export const MOUNT_SERVER: RegisteredCommand = {
  id: 'colab.mountServer',
  label: 'Mount Server to Workspace',
  icon: 'remote',
  description: 'Reloads VS Code if a Workspace is not already open.',
};

/** Command to remove a server. */
export const REMOVE_SERVER: RegisteredCommand = {
  id: 'colab.removeServer',
  label: 'Remove Server',
  icon: 'trash',
};

/** Command to rename a server alias. */
export const RENAME_SERVER_ALIAS: RegisteredCommand = {
  id: 'colab.renameServerAlias',
  label: 'Rename Server Alias',
};

/** Command to open the Colab signup page, to upgrade to pro. */
export const UPGRADE_TO_PRO: Command = {
  label: 'Upgrade to Pro',
  icon: 'accounts-view-bar-icon',
  description: 'More machines, more quota, more Colab!',
};

/** Command to upload files to a Colab server. */
export const UPLOAD: RegisteredCommand = {
  id: 'colab.upload',
  label: 'Upload to Colab',
  icon: 'cloud-upload',
};
