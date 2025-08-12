/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import { SinonFakeTimers } from "sinon";
import * as sinon from "sinon";
import { CancellationTokenSource } from "vscode";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { CodeManager } from "./code-manager";

describe("CodeManager", () => {
  let vsCodeStub: VsCodeStub;
  let clock: SinonFakeTimers;
  let cancellationTokenSource: CancellationTokenSource;
  let manager: CodeManager;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
    cancellationTokenSource = new vsCodeStub.CancellationTokenSource();
    manager = new CodeManager();
  });

  afterEach(() => {
    manager.dispose();
    clock.restore();
    sinon.restore();
  });

  it("rejects outstanding codes when disposed", async () => {
    const code = manager.waitForCode("1", cancellationTokenSource.token);

    manager.dispose();

    await expect(code).to.be.rejectedWith(/disposed/);
  });

  it("rejects when waiting for the same nonce", async () => {
    const nonce = "1";

    void manager.waitForCode(nonce, cancellationTokenSource.token);

    await expect(
      manager.waitForCode(nonce, cancellationTokenSource.token),
    ).to.be.rejectedWith(/waiting/);
  });

  it("throws when resolving an unknown nonce", async () => {
    const nonce = "1";
    const code = "42";
    const gotCode = manager.waitForCode(nonce, cancellationTokenSource.token);

    expect(() => {
      manager.resolveCode("unknown", code);
    }).to.throw(/Unexpected/);

    // Ensure no code is resolved and ultimately times out.
    clock.tick(60_001);
    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("rejects when the timeout is exceeded", async () => {
    const gotCode = manager.waitForCode("1", cancellationTokenSource.token);

    clock.tick(60_001);

    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("rejects when the user cancels", async () => {
    const gotCode = manager.waitForCode("1", cancellationTokenSource.token);

    cancellationTokenSource.cancel();

    await expect(gotCode).to.be.rejectedWith(/cancelled/);
  });

  it("resolves a code", async () => {
    const code = "42";
    const nonce = "123";

    const gotCode = manager.waitForCode(nonce, cancellationTokenSource.token);
    manager.resolveCode(nonce, code);

    await expect(gotCode).to.eventually.equal(code);
  });

  it("resolves the code corresponding to the nonce", async () => {
    const redirects = [
      { nonce: "1", code: "42" },
      { nonce: "2", code: "99" },
    ];

    const gotFirstCode = manager.waitForCode(
      redirects[0].nonce,
      cancellationTokenSource.token,
    );
    const gotSecondCode = manager.waitForCode(
      redirects[1].nonce,
      cancellationTokenSource.token,
    );
    // Redirect the second before the first.
    manager.resolveCode(redirects[1].nonce, redirects[1].code);
    manager.resolveCode(redirects[0].nonce, redirects[0].code);

    await expect(gotFirstCode).to.eventually.equal(redirects[0].code);
    await expect(gotSecondCode).to.eventually.equal(redirects[1].code);
  });

  it("resolves a code while another request times out", async () => {
    const code = "42";
    const nonce = "2";
    const gotFirstCode = manager.waitForCode(
      "1",
      cancellationTokenSource.token,
    );
    // Wait 30s after the first.
    clock.tick(30_000);
    const gotSecondCode = manager.waitForCode(
      nonce,
      cancellationTokenSource.token,
    );
    // Wait just over another 30s to time-out the first.
    clock.tick(30_001);
    await expect(gotFirstCode).to.be.rejectedWith(/timeout/);

    manager.resolveCode(nonce, code);

    await expect(gotSecondCode).to.eventually.equal(code);
  });
});
