/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon from 'sinon';
import { JupyterClient } from '../../jupyter/client';
import {
  ConfigApi,
  ContentsApi,
  IdentityApi,
  KernelsApi,
  KernelspecsApi,
  SessionsApi,
  StatusApi,
  TerminalsApi,
} from '../../jupyter/client/generated';

/**
 * A stub of a JupyterClient.
 */
export interface JupyterClientStub extends JupyterClient {
  readonly config: sinon.SinonStubbedInstance<JupyterClient['config']>;
  readonly contents: sinon.SinonStubbedInstance<JupyterClient['contents']>;
  readonly identity: sinon.SinonStubbedInstance<JupyterClient['identity']>;
  readonly kernels: sinon.SinonStubbedInstance<JupyterClient['kernels']>;
  readonly kernelspecs: sinon.SinonStubbedInstance<
    JupyterClient['kernelspecs']
  >;
  readonly sessions: sinon.SinonStubbedInstance<JupyterClient['sessions']>;
  readonly status: sinon.SinonStubbedInstance<JupyterClient['status']>;
  readonly terminals: sinon.SinonStubbedInstance<JupyterClient['terminals']>;
}

/**
 * Creates a stub of a JupyterClient.
 */
export function createJupyterClientStub(): JupyterClientStub {
  return {
    config: sinon.createStubInstance(ConfigApi),
    contents: sinon.createStubInstance(ContentsApi),
    identity: sinon.createStubInstance(IdentityApi),
    kernels: sinon.createStubInstance(KernelsApi),
    kernelspecs: sinon.createStubInstance(KernelspecsApi),
    sessions: sinon.createStubInstance(SessionsApi),
    status: sinon.createStubInstance(StatusApi),
    terminals: sinon.createStubInstance(TerminalsApi),
  };
}
