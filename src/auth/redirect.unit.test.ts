import { expect } from "chai";
import { SinonFakeTimers } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";
import {
  TestCancellationTokenSource,
  TestUri,
  vscodeStub,
} from "../test/helpers/vscode";
import { RedirectUriCodeProvider } from "./redirect";

const DEFAULT_SCOPE = "profile email";

describe("RedirectUriCodeProvider", () => {
  let clock: SinonFakeTimers;
  let cancellationTokenSource: TestCancellationTokenSource;
  let redirect: RedirectUriCodeProvider;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    cancellationTokenSource = new TestCancellationTokenSource();
    redirect = new RedirectUriCodeProvider(vscodeStub as typeof vscode);
  });

  afterEach(() => {
    clock.restore();
    sinon.reset();
  });

  it("times out waiting for code exchange", async () => {
    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      "123",
      cancellationTokenSource.token,
    );

    clock.tick(60_001);

    await expect(gotCode).to.be.rejectedWith(/timed out/);
  });

  it("rejects waiting for code when user cancels the request", async () => {
    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      "123",
      cancellationTokenSource.token,
    );

    cancellationTokenSource.cancel();

    await expect(gotCode).to.be.rejectedWith(/cancelled/);
  });

  it("rejects when URI does not include a code", async () => {
    const nonce = "123";

    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      nonce,
      cancellationTokenSource.token,
    );
    redirect.handleUri(
      TestUri.parse(
        encodeURI(`vscode://google.colab?nonce=${nonce}&scope=email+profile`),
      ),
    );

    await expect(gotCode).to.be.rejectedWith("Missing code");
  });

  it("rejects when URI does not include a nonce", async () => {
    const code = "42";

    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      "123",
      cancellationTokenSource.token,
    );
    redirect.handleUri(
      TestUri.parse(`vscode://google.colab?code=${code}&scope=email+profile`),
    );

    await expect(gotCode).to.be.rejectedWith("Missing nonce");
  });

  it("times out when no request with a matching nonce is received", async () => {
    const code = "42";

    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      "123",
      cancellationTokenSource.token,
    );
    redirect.handleUri(
      TestUri.parse(
        encodeURI(
          `vscode://google.colab?code=${code}&nonce=99&scope=email+profile`,
        ),
      ),
    );

    clock.tick(60_001);

    await expect(gotCode).to.be.rejectedWith(/timed out/);
  });

  it("successfully waits for code", async () => {
    const code = "42";
    const nonce = "123";

    const gotCode = redirect.waitForCode(
      DEFAULT_SCOPE,
      nonce,
      cancellationTokenSource.token,
    );
    redirect.handleUri(
      TestUri.parse(
        encodeURI(
          `vscode://google.colab?code=${code}&nonce=${nonce}&scope=email+profile`,
        ),
      ),
    );

    await expect(gotCode).to.eventually.equal(code);
  });

  it("successfully resolves the correct code for the scope", async () => {
    const redirects = [
      { code: "42", nonce: "123", scope: "email" },
      { code: "99", nonce: "321", scope: "email+profile" },
    ];

    const firstCode = redirect.waitForCode(
      redirects[0].scope,
      redirects[0].nonce,
      cancellationTokenSource.token,
    );
    const secondCode = redirect.waitForCode(
      redirects[1].scope,
      redirects[1].nonce,
      cancellationTokenSource.token,
    );
    // Redirect the second before the first.
    redirect.handleUri(
      TestUri.parse(
        encodeURI(
          `vscode://google.colab?code=${redirects[1].code}&nonce=${redirects[1].nonce}&scope=${redirects[1].scope}`,
        ),
      ),
    );
    redirect.handleUri(
      TestUri.parse(
        encodeURI(
          `vscode://google.colab?code=${redirects[0].code}&nonce=${redirects[0].nonce}&scope=${redirects[0].scope}`,
        ),
      ),
    );

    await expect(firstCode).to.eventually.equal(redirects[0].code);
    await expect(secondCode).to.eventually.equal(redirects[1].code);
  });
});
