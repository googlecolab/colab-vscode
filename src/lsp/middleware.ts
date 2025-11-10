/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri, TextDocument } from "vscode";
import { Middleware, vsdiag } from "vscode-languageclient/node";

/**
 * Returns middleware for the VS Code Language Client.
 *
 * This strips out diagnostics that are not applicable to IPython notebooks.
 * Since we use Pyright under the hood, there are a couple Python-only
 * diagnostics that are irrelevant.
 */
export function getMiddleware(vs: typeof vscode): Middleware {
  return {
    async provideDiagnostics(document, previousResultId, token, next) {
      const report = await next(document, previousResultId, token);
      const doc = getDocument(vs, document);
      if (!isFullReport(report) || !doc) {
        return report;
      }
      return {
        ...report,
        items: report.items.filter((i) => shouldKeepDiagnostic(i, doc)),
      };
    },
    async provideWorkspaceDiagnostics(resultIds, token, resultReporter, next) {
      const customReporter: vsdiag.ResultReporter = (chunk) => {
        if (!chunk) {
          resultReporter(chunk);
          return;
        }
        const filteredItems = chunk.items.map((report) => {
          const doc = getDocument(vs, report.uri);
          if (!isFullReport(report) || !doc) {
            return report;
          }
          return {
            ...report,
            items: report.items.filter((i) => shouldKeepDiagnostic(i, doc)),
          };
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

/**
 * Returns whether the diagnostic is applicable to IPython and should be
 * kept.
 */
function shouldKeepDiagnostic(
  diagnostic: vscode.Diagnostic,
  document: vscode.TextDocument,
): boolean {
  const text = document.getText(diagnostic.range);

  // Bash commands are not recognized by Pyright, and will typically return the
  // error mentioned in https://github.com/microsoft/vscode-jupyter/issues/8055.
  if (text.startsWith("!")) {
    return false;
  }
  // Pyright does not recognize magics.
  if (text.startsWith("%")) {
    return false;
  }
  // IPython 7+ allows for calling await at the top level, outside of an async
  // function.
  const isStartOfLine = diagnostic.range.start.character === 0;
  if (
    isStartOfLine &&
    text.startsWith("await") &&
    diagnostic.message.includes("allowed only within async function")
  ) {
    return false;
  }
  return true;
}
