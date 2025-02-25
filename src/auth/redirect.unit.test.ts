import { expect } from "chai";
import { SinonFakeTimers } from "sinon";
import * as sinon from "sinon";
import { CancellationTokenSource, Uri } from "vscode";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { RedirectUriCodeProvider } from "./redirect";

describe("RedirectUriCodeProvider", () => {
  let vsCodeStub: VsCodeStub;
  let clock: SinonFakeTimers;
  let cancellationTokenSource: CancellationTokenSource;
  let provider: RedirectUriCodeProvider;

  function uri(value: string): Uri {
    return vsCodeStub.Uri.parse(encodeURI(value));
  }

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
    cancellationTokenSource = new vsCodeStub.CancellationTokenSource();
    provider = new RedirectUriCodeProvider();
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it("throws when waiting for the same nonce", () => {
    const nonce = "1";

    void provider.waitForCode(nonce, cancellationTokenSource.token);

    expect(
      provider.waitForCode(nonce, cancellationTokenSource.token),
    ).to.eventually.throw(/waiting/);
  });
  it("throws when the URI does not include a code", async () => {
    const nonce = "1";
    const gotCode = provider.waitForCode(nonce, cancellationTokenSource.token);

    expect(() => {
      provider.handleUri(uri(`vscode://google.colab?nonce=${nonce}`));
    }).to.throw(/code/);

    // Ensure no code is resolved and ultimately times out.
    clock.tick(60_001);
    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("throws when the URI does not include a nonce", async () => {
    const code = "42";
    const gotCode = provider.waitForCode("123", cancellationTokenSource.token);

    expect(() => {
      provider.handleUri(uri(`vscode://google.colab?code=${code}`));
    }).to.throw(/nonce/);

    // Ensure no code is resolved and ultimately times out.
    clock.tick(60_001);
    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("rejects when the timeout is exceeded", async () => {
    const gotCode = provider.waitForCode("1", cancellationTokenSource.token);

    clock.tick(60_001);

    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("rejects when no matching nonce is received", async () => {
    const code = "42";
    const gotCode = provider.waitForCode("123", cancellationTokenSource.token);

    // Simulate receiving a code exchange for a different nonce.
    expect(() => {
      provider.handleUri(uri(`vscode://google.colab?code=${code}&nonce=99`));
    }).to.throw(/Unexpected/);

    // Ensure no code is resolved and ultimately times out.
    clock.tick(60_001);
    await expect(gotCode).to.be.rejectedWith(/timeout/);
  });

  it("rejects when the user cancels", async () => {
    const gotCode = provider.waitForCode("1", cancellationTokenSource.token);

    cancellationTokenSource.cancel();

    await expect(gotCode).to.be.rejectedWith(/cancelled/);
  });

  it("resolves a code", async () => {
    const code = "42";
    const nonce = "123";

    const gotCode = provider.waitForCode(nonce, cancellationTokenSource.token);
    provider.handleUri(
      uri(`vscode://google.colab?code=${code}&nonce=${nonce}`),
    );

    await expect(gotCode).to.eventually.equal(code);
  });

  it("resolves the code corresponding to the nonce", async () => {
    const redirects = [
      { nonce: "1", code: "42" },
      { nonce: "2", code: "99" },
    ];

    const gotFirstCode = provider.waitForCode(
      redirects[0].nonce,
      cancellationTokenSource.token,
    );
    const gotSecondCode = provider.waitForCode(
      redirects[1].nonce,
      cancellationTokenSource.token,
    );
    // Redirect the second before the first.
    provider.handleUri(
      uri(
        `vscode://google.colab?code=${redirects[1].code}&nonce=${redirects[1].nonce}`,
      ),
    );
    provider.handleUri(
      uri(
        `vscode://google.colab?code=${redirects[0].code}&nonce=${redirects[0].nonce}`,
      ),
    );

    await expect(gotFirstCode).to.eventually.equal(redirects[0].code);
    await expect(gotSecondCode).to.eventually.equal(redirects[1].code);
  });

  it("resolves a code while another request times out", async () => {
    const code = "42";
    const nonce = "2";
    const gotFirstCode = provider.waitForCode(
      "1",
      cancellationTokenSource.token,
    );
    // Wait 30s after the first.
    clock.tick(30_000);
    const gotSecondCode = provider.waitForCode(
      nonce,
      cancellationTokenSource.token,
    );
    // Wait just over another 30s to time-out the first.
    clock.tick(30_001);
    await expect(gotFirstCode).to.be.rejectedWith(/timeout/);

    provider.handleUri(
      uri(`vscode://google.colab?code=${code}&nonce=${nonce}`),
    );

    await expect(gotSecondCode).to.eventually.equal(code);
  });
});
