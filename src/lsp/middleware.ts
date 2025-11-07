/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri, TextDocument } from "vscode";
import { Middleware, vsdiag } from "vscode-languageclient/node";

/** Returns middleware for the VS Code Language Client.  */
export function getMiddleware(vs: typeof vscode): Middleware {
  return {
    // Colab runtimes run Pyright as an LSP server, which does not
    // understand the notebook syntax. Hook into middleware to filter out
    // diagnostics that are incorrect for notebooks. This is done for both
    // document and workspace diagnostics.
    async provideDiagnostics(document, previousResultId, token, next) {
      const res = await next(document, previousResultId, token);
      const doc = getDocument(vs, document);

      if (isFullReport(res) && doc) {
        res.items = res.items.filter((i) => {
          const text = doc.getText(i.range);
          const startOfLine = i.range.start.character === 0;
          return !isPythonDiagnostic(i.message, text, startOfLine);
        });
      }
      return res;
    },
    async provideWorkspaceDiagnostics(resultIds, token, resultReporter, next) {
      const customReporter: vsdiag.ResultReporter = (chunk) => {
        if (!chunk) {
          resultReporter(chunk);
          return;
        }
        const filteredItems = chunk.items.map((item) => {
          if (!isFullReport(item)) {
            return item;
          }
          const document = vs.workspace.textDocuments.find(
            (doc) => doc.uri.toString() === item.uri.toString(),
          );
          let items = item.items;
          if (document) {
            items = items.filter((i) => {
              const text = document.getText(i.range);
              const startOfLine = i.range.start.character === 0;
              return !isPythonDiagnostic(i.message, text, startOfLine);
            });
          }
          return { ...item, items };
        });
        resultReporter({ items: filteredItems });
      };
      return next(resultIds, token, customReporter);
    },
  };
}

function getDocument(
  vs: typeof vscode,
  d: Uri | TextDocument,
): TextDocument | undefined {
  if (!(d instanceof vs.Uri)) {
    return d;
  }
  return vs.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === d.toString(),
  );
}

function isFullReport(
  r?: vsdiag.DocumentDiagnosticReport | null,
): r is vsdiag.RelatedFullDocumentDiagnosticReport {
  // Avoid depending on language client which transitively depends on vscode.
  return r?.kind.toString() === "full";
}

export function isPythonDiagnostic(
  diagnosticText: string,
  text: string,
  startOfLine: boolean,
): boolean {
  // Bash commands are not recognized by Pyright, and will typically return the
  // error mentioned in https://github.com/microsoft/vscode-jupyter/issues/8055.
  if (text.startsWith("!")) {
    return true;
  }
  // Pyright does not recognize magics.
  if (text.startsWith("%")) {
    return true;
  }
  // IPython 7+ allows for calling await at the top level, outside of an async
  // function.
  if (
    diagnosticText.includes("allowed only within async function") &&
    text.startsWith("await") &&
    startOfLine
  ) {
    return true;
  }
  return false;
}
