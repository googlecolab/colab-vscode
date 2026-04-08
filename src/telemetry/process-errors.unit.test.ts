/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon, { SinonStub } from 'sinon';
import { createProcessErrorHandler } from './process-errors';
import { telemetry } from '.';

const EXTENSION_PATH = '/home/user/.vscode/extensions/google.colab-1.2.3';

describe('createProcessErrorHandler', () => {
  let logErrorStub: SinonStub;
  let handler: (error: unknown) => void;

  beforeEach(() => {
    logErrorStub = sinon.stub(telemetry, 'logError');
    handler = createProcessErrorHandler(EXTENSION_PATH);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('logs errors with a stack trace containing the extension path', () => {
    const error = new Error('test error');
    error.stack = `Error: test error\n    at Object.<anonymous> (${EXTENSION_PATH}/out/extension.js:42:13)`;

    handler(error);

    sinon.assert.calledOnceWithExactly(logErrorStub, error);
  });

  it('ignores errors with a stack trace not containing the extension path', () => {
    const error = new Error('spawn nvidia-smi ENOENT');
    error.stack =
      'Error: spawn nvidia-smi ENOENT\n    at Process.ChildProcess._handle.onexit (node:internal/child_process:285:19)';

    handler(error);

    sinon.assert.notCalled(logErrorStub);
  });

  it('ignores errors from other extensions', () => {
    const error = new Error('other extension error');
    error.stack = `Error: other extension error\n    at Object.<anonymous> (/home/user/.vscode/extensions/other.extension-2.0.0/out/main.js:10:5)`;

    handler(error);

    sinon.assert.notCalled(logErrorStub);
  });

  it('ignores errors without a stack trace', () => {
    const error = new Error('no stack');
    error.stack = undefined;

    handler(error);

    sinon.assert.notCalled(logErrorStub);
  });

  it('ignores non-Error values', () => {
    handler('string error');
    handler(42);
    handler({ message: 'object error' });
    handler(undefined);
    handler(null);

    sinon.assert.notCalled(logErrorStub);
  });
});
