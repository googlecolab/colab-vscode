/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri } from 'vscode';
import { ColabAssignedServer } from '../jupyter/servers';

/**
 * Creates a URI for a file on a Colab server using the 'colab' scheme.
 *
 * @param vs - The VS Code module.
 * @param server - The assigned Colab server whose endpoint is used as the URI
 * authority.
 * @param filePath - The optional name or path of the file.
 * @returns A {@link Uri} representing the file on the Colab server.
 */
export function buildColabFileUri(
  vs: typeof vscode,
  server: ColabAssignedServer,
  filePath = '',
): Uri {
  return vs.Uri.joinPath(
    vs.Uri.from({
      scheme: 'colab',
      authority: server.endpoint,
      path: '/',
    }),
    filePath,
  );
}
