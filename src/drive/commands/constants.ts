/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RegisteredCommand } from '../../colab/commands/constants';

/** Command to import a notebook from a user provided URL. */
export const IMPORT_NOTEBOOK_FROM_URL: RegisteredCommand = {
  id: 'colab.importNotebookFromUrl',
  label: 'Import notebook file from URL',
  icon: 'arrow-down',
  description: 'Imports a notebook file from the provided URL',
};

/** The path for the deep-linking URL for importing a notebook from Google Drive. */
export const IMPORT_DRIVE_FILE_PATH = 'import-drive-file';
