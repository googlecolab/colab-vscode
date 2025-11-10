/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import * as sinon from "sinon";
import type vscode from "vscode";
import { type Middleware, type vsdiag } from "vscode-languageclient/node";
import { TestCancellationToken } from "../test/helpers/cancellation";
import { TestUri } from "../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { getMiddleware } from "./middleware";

describe("getMiddleware", () => {
  let vsCodeStub: VsCodeStub;
  let cancellationToken: TestCancellationToken;
  let middleware: Middleware;
  let getText: sinon.SinonStub<[Range | undefined], string>;
  let textDocument: vscode.TextDocument;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    cancellationToken = new TestCancellationToken(
      new vsCodeStub.EventEmitter<void>(),
    );
    getText = sinon.stub();
    textDocument = {
      uri: new TestUri("file", "", "/path/to/notebook.ipynb", "", ""),
      getText,
    } as unknown as vscode.TextDocument;
    vsCodeStub.workspace.textDocuments = [textDocument];
    middleware = getMiddleware(vsCodeStub.asVsCode());
  });

  describe("provideDiagnostics", () => {
    let next: sinon.SinonStub;

    beforeEach(() => {
      next = sinon.stub();
    });

    describe("filters diagnostics", () => {
      it("for bash commands", async () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
        };
        next.returns(report);
        getText.withArgs(sinon.match(report.items[0].range)).returns("!");

        const result = await middleware.provideDiagnostics?.(
          textDocument.uri,
          undefined,
          cancellationToken,
          next,
        );

        expect(result).to.deep.equal({ ...report, items: [] });
      });

      it("for magic commands", async () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
        };
        next.returns(report);
        getText.withArgs(sinon.match(report.items[0].range)).returns("%");

        const result = await middleware.provideDiagnostics?.(
          textDocument.uri,
          undefined,
          cancellationToken,
          next,
        );

        expect(result).to.deep.equal({ ...report, items: [] });
      });

      it("for awaits outside of an async function", async () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "await is allowed only within async functions",
            },
          ],
        };
        next.returns(report);
        getText.withArgs(sinon.match(report.items[0].range)).returns("await");

        const result = await middleware.provideDiagnostics?.(
          textDocument.uri,
          undefined,
          cancellationToken,
          next,
        );

        expect(result).to.deep.equal({ ...report, items: [] });
      });
    });

    it("handles when some diagnostics should be filtered", async () => {
      const report = {
        kind: "full",
        items: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 1 },
            },
            message: "should be kept!",
          },
          {
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 1 },
            },
          },
        ],
      };
      next.returns(report);
      getText
        .withArgs(sinon.match(report.items[0].range))
        .returns("!")
        .withArgs(sinon.match(report.items[1].range))
        .returns("#")
        .withArgs(sinon.match(report.items[2].range))
        .returns("!");

      const result = await middleware.provideDiagnostics?.(
        textDocument.uri,
        undefined,
        cancellationToken,
        next,
      );

      expect(result).to.deep.equal({ ...report, items: [report.items[1]] });
    });

    describe("does not filter diagnostics", () => {
      it("when the report kind is not full", async () => {
        const report = {
          kind: "unChanged",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
        };
        next.returns(report);

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            cancellationToken,
            next,
          );

        expect(result).to.deep.equal(report);
        sinon.assert.notCalled(getText);
      });

      it("when the document is not found", async () => {
        vsCodeStub.workspace.textDocuments = [];
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
        };
        next.returns(report);

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            cancellationToken,
            next,
          );

        expect(result).to.deep.equal(report);
        sinon.assert.notCalled(getText);
      });

      it("when the report does not contain Python-only diagnostics", async () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 13 },
                end: { line: 0, character: 13 },
              },
              message: "",
            },
          ],
        };
        next.returns(report);
        getText
          .withArgs(sinon.match(report.items[0].range))
          .returns("print('error'");

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            cancellationToken,
            next,
          );

        expect(result).to.deep.equal(report);
      });
    });
  });

  describe("provideWorkspaceDiagnostics", () => {
    let customReporter: vsdiag.ResultReporter;
    let resultReporter: sinon.SinonStub;

    beforeEach(async () => {
      resultReporter = sinon.stub();
      const next = sinon.stub();
      await middleware.provideWorkspaceDiagnostics?.(
        [],
        cancellationToken,
        resultReporter,
        next,
      );
      customReporter = next.args[0][2] as vsdiag.ResultReporter;
    });

    describe("filters diagnostics", () => {
      it("for bash commands", () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
          uri: textDocument.uri,
        };
        getText.withArgs(sinon.match(report.items[0].range)).returns("!");

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [
            {
              ...report,
              items: [],
            },
          ],
        });
      });

      it("for magic commands", () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
          uri: textDocument.uri,
        };
        getText.withArgs(sinon.match(report.items[0].range)).returns("%");

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [
            {
              ...report,
              items: [],
            },
          ],
        });
      });

      it("for awaits outside of an async function", () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "await is allowed only within async functions",
            },
          ],
          uri: textDocument.uri,
        };
        getText.withArgs(sinon.match(report.items[0].range)).returns("await");

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [
            {
              ...report,
              items: [],
            },
          ],
        });
      });
    });

    it("handles when some diagnostics should be filtered", () => {
      const report = {
        kind: "full",
        items: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 1 },
            },
            message: "should be kept!",
          },
          {
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 1 },
            },
          },
        ],
        uri: textDocument.uri,
      };
      getText
        .withArgs(sinon.match(report.items[0].range))
        .returns("!")
        .withArgs(sinon.match(report.items[1].range))
        .returns("#")
        .withArgs(sinon.match(report.items[2].range))
        .returns("!");

      customReporter({
        items: [report],
      } as unknown as vsdiag.WorkspaceDiagnosticReport);

      expect(resultReporter.calledOnce).to.be.true;
      sinon.assert.calledWithExactly(resultReporter, {
        items: [
          {
            ...report,
            items: [report.items[1]],
          },
        ],
      });
    });

    it("handles when some reports should be filtered", () => {
      const report = {
        kind: "full",
        items: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
          },
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 1 },
            },
            message: "should be kept!",
          },
        ],
        uri: textDocument.uri,
      };
      const unfilteredReport = {
        ...report,
        items: [report.items[1]],
      };
      getText
        .withArgs(sinon.match(report.items[0].range))
        .returns("!")
        .withArgs(sinon.match(report.items[1].range))
        .returns("#");

      customReporter({
        items: [report, unfilteredReport],
      } as unknown as vsdiag.WorkspaceDiagnosticReport);

      expect(resultReporter.calledOnce).to.be.true;
      sinon.assert.calledWithExactly(resultReporter, {
        items: [
          {
            ...report,
            items: [report.items[1]],
          },
          unfilteredReport,
        ],
      });
    });

    describe("does not filter out diagnostics", () => {
      it("when the report kind is not full", () => {
        const report = {
          kind: "unChanged",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
          uri: textDocument.uri,
        };

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [report],
        });
        sinon.assert.notCalled(getText);
      });

      it("when the document is not found", () => {
        vsCodeStub.workspace.textDocuments = [];
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
          uri: textDocument.uri,
        };

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [report],
        });
        sinon.assert.notCalled(getText);
      });

      it("when the report does not contain Python-only diagnostics", () => {
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 13 },
              },
              message: "",
            },
          ],
          uri: textDocument.uri,
        };
        getText
          .withArgs(sinon.match(report.items[0].range))
          .returns("print('error'");

        customReporter({
          items: [report],
        } as unknown as vsdiag.WorkspaceDiagnosticReport);

        expect(resultReporter.calledOnce).to.be.true;
        sinon.assert.calledWithExactly(resultReporter, {
          items: [report],
        });
      });
    });
  });
});
