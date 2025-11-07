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
  let middleware: Middleware;
  let provideDiagnosticsNext: sinon.SinonStub;
  let textDocument: vscode.TextDocument;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    middleware = getMiddleware(vsCodeStub.asVsCode());
    provideDiagnosticsNext = sinon.stub();
    textDocument = {
      uri: new TestUri("file", "", "/path/to/notebook.ipynb", "", ""),
      getText: sinon.stub(),
    } as unknown as vscode.TextDocument;
    vsCodeStub.workspace.textDocuments = [textDocument];
  });

  it("should return middleware", () => {
    expect(middleware).to.exist;
  });

  describe("provideDiagnostics", () => {
    describe("filters out Python diagnostics", () => {
      it("for bash commands", async () => {
        (textDocument.getText as sinon.SinonStub).returns("!");
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              message: "Invalid syntax",
            },
          ],
        };
        provideDiagnosticsNext.returns(report);
        const expected = { ...report, items: [] };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });

      it("for magic commands", async () => {
        (textDocument.getText as sinon.SinonStub).returns("%");
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              message: "Invalid syntax",
            },
          ],
        };
        provideDiagnosticsNext.returns(report);
        const expected = { ...report, items: [] };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });

      it("for awaits outside of an async function", async () => {
        (textDocument.getText as sinon.SinonStub).returns("await");
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
        provideDiagnosticsNext.returns(report);
        const expected = { ...report, items: [] };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });
    });

    describe("does not filter out Python diagnostics", () => {
      it("when the document diagnostic report kind is not full", async () => {
        (textDocument.getText as sinon.SinonStub).returns("!ls");
        const report = {
          kind: "unChanged",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              message: "Invalid syntax",
            },
          ],
        };
        provideDiagnosticsNext.returns(report);
        // Create a copy since middleware modifies the report in place.
        const expected = { ...report };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });

      it("when the document is not found", async () => {
        vsCodeStub.workspace.textDocuments = [];
        (textDocument.getText as sinon.SinonStub).returns("!ls");
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              message: "Invalid syntax",
            },
          ],
        };
        provideDiagnosticsNext.returns(report);
        // Create a copy since middleware modifies the report in place.
        const expected = { ...report };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });

      it("when the report does not contain python diagnostics", async () => {
        (textDocument.getText as sinon.SinonStub).returns("print('error'");
        const report = {
          kind: "full",
          items: [
            {
              range: {
                start: { line: 0, character: 13 },
                end: { line: 0, character: 13 },
              },
              message: "Invalid syntax",
            },
          ],
        };
        provideDiagnosticsNext.returns(report);
        // Create a copy since middleware modifies the report in place.
        const expected = { ...report };

        const result: vscode.ProviderResult<vsdiag.DocumentDiagnosticReport> =
          await middleware.provideDiagnostics?.(
            textDocument.uri,
            undefined,
            new TestCancellationToken(new vsCodeStub.EventEmitter<void>()),
            provideDiagnosticsNext,
          );

        expect(result).to.deep.equal(expected);
      });
    });
  });

  describe("provideWorkspaceDiagnostics", () => {});
});
