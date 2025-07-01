import * as sinon from "sinon";
import { Uri } from "vscode";
import { TestUri } from "../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ExtensionUriHandler } from "./uri-handler";

describe("ExtensionUriHandler", () => {
  let vs: VsCodeStub;
  let handler: ExtensionUriHandler;

  beforeEach(() => {
    vs = newVsCodeStub();
    handler = new ExtensionUriHandler(vs.asVsCode());
  });

  afterEach(() => {
    sinon.restore();
    handler.dispose();
  });

  it("disposes of the event emitter when disposed", () => {
    const disposeSpy = sinon.spy();
    const fakeEmitterInstance = {
      event: sinon.stub(),
      fire: sinon.stub(),
      dispose: disposeSpy,
    };
    const emitterStub = sinon.stub().returns(fakeEmitterInstance);
    vs.EventEmitter = emitterStub as unknown as typeof vs.EventEmitter;
    const testHandler = new ExtensionUriHandler(vs.asVsCode());

    testHandler.dispose();

    sinon.assert.calledOnce(emitterStub);
    sinon.assert.calledOnce(disposeSpy);
  });

  it("fires a single URI event", () => {
    const onReceivedUriStub: sinon.SinonStub<[Uri], void> = sinon.stub();
    handler.onReceivedUri(onReceivedUriStub);
    const testUri = TestUri.parse("vscode://google.colab?foo=bar");

    handler.handleUri(testUri);

    sinon.assert.calledOnceWithExactly(onReceivedUriStub, testUri);
  });

  it("fires multiple URI events", () => {
    const onReceivedUriStub: sinon.SinonStub<[Uri], void> = sinon.stub();
    handler.onReceivedUri(onReceivedUriStub);
    const testUri1 = TestUri.parse("vscode://google.colab?foo=bar");
    const testUri2 = TestUri.parse("vscode://google.colab?foo=baz");

    handler.handleUri(testUri1);
    handler.handleUri(testUri2);

    sinon.assert.calledWithExactly(onReceivedUriStub, testUri1);
    sinon.assert.calledWithExactly(onReceivedUriStub, testUri2);
  });
});
