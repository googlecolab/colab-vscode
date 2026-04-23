/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { newVsCodeStub } from '../test/helpers/vscode';
import { registerCommand } from './commands';

describe('registerCommand', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('registers the command with vscode.commands.registerCommand', () => {
    const vs = newVsCodeStub();
    const disposable = { dispose: sinon.stub() };
    vs.commands.registerCommand.returns(disposable);
    const handler = sinon.stub();

    const result = registerCommand(vs.asVsCode(), 'colab.test', handler);

    expect(result).to.equal(disposable);
    sinon.assert.calledOnce(vs.commands.registerCommand);
    expect(vs.commands.registerCommand.firstCall.args[0]).to.equal(
      'colab.test',
    );
    expect(typeof vs.commands.registerCommand.firstCall.args[1]).to.equal(
      'function',
    );
    // The function passed to vscode.commands.registerCommand must NOT be the
    // raw handler; it must be a wrapper. This is what proves wrapping
    // happened independently of any behavioral assertion below.
    expect(vs.commands.registerCommand.firstCall.args[1]).to.not.equal(handler);
  });

  it('wraps the handler with error tracking', async () => {
    const vs = newVsCodeStub();
    let wrappedHandler: ((...args: unknown[]) => unknown) | undefined;
    vs.commands.registerCommand.callsFake(
      (_id: string, h: (...args: unknown[]) => unknown) => {
        wrappedHandler = h;
        return { dispose: sinon.stub() };
      },
    );
    const handler = sinon.stub().rejects(new Error('boom'));

    registerCommand(vs.asVsCode(), 'colab.test', handler);

    // The wrapped handler should still propagate the rejection (telemetry
    // logs the error as a side effect; we don't assert on telemetry here).
    expect(wrappedHandler).to.be.a('function');
    if (!wrappedHandler) {
      throw new Error('wrappedHandler was not set');
    }
    expect(wrappedHandler).to.not.equal(handler);
    await expect(wrappedHandler()).to.be.rejectedWith('boom');
  });
});
