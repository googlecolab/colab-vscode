/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri, TextDocument } from 'vscode';
import {
  ProvideDiagnosticSignature,
  ProvideWorkspaceDiagnosticSignature,
  vsdiag,
} from 'vscode-languageclient/node';

/**
 * Filters non IPython diagnostics.
 *
 * A Python language server is not IPython-aware. This filters diagnostics
 * raised what would be errors/warnings in Python, but are valid IPython.
 *
 * @param vs - The "vscode" module. Injected in order to be unit testable.
 * @param document - The document or URI for which diagnostics are being
 * provided.
 * @param previousResultId - An identifier for the previous diagnostic report,
 * used for incremental updates.
 * @param token - A cancellation token to signal cancellation of the request.
 * @param next - The next middleware function in the chain, or the language
 * client's actual diagnostic provider.
 * @returns A promise that resolves to the filtered document diagnostic report.
 */
export async function filterNonIPythonDiagnostics(
  vs: typeof vscode,
  document: vscode.TextDocument | vscode.Uri,
  previousResultId: string | undefined,
  token: vscode.CancellationToken,
  next: ProvideDiagnosticSignature,
): Promise<vsdiag.DocumentDiagnosticReport | null | undefined> {
  const report = await next(document, previousResultId, token);
  const doc = getDocument(vs, document);
  if (!isFullReport(report) || !doc) {
    return report;
  }
  return {
    ...report,
    items: report.items.filter((i) => shouldKeepDiagnostic(i, doc)),
  };
}

/**
 * Filters non IPython workspace diagnostics.
 *
 * A Python language server is not IPython-aware. This filters workspace
 * diagnostics raised what would be errors/warnings in Python, but are valid
 * IPython.
 *
 * @param vs - The "vscode" module. Injected in order to be unit testable.
 * @param resultIds - An array of previous result identifiers for workspace
 * diagnostics.
 * @param token - A cancellation token to signal cancellation of the request.
 * @param resultReporter - A function to report diagnostic results.
 * @param next - The next middleware function in the chain, or the language
 * client's actual workspace diagnostic provider.
 * @returns A promise that resolves to the filtered workspace diagnostic report.
 */
export async function filterNonIPythonWorkspaceDiagnostics(
  vs: typeof vscode,
  resultIds: vsdiag.PreviousResultId[],
  token: vscode.CancellationToken,
  resultReporter: vsdiag.ResultReporter,
  next: ProvideWorkspaceDiagnosticSignature,
): Promise<vsdiag.WorkspaceDiagnosticReport | null | undefined> {
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
  return r?.kind.toString() === 'full';
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
  if (text.startsWith('!')) {
    return false;
  }
  // Pyright does not recognize magics.
  if (text.startsWith('%')) {
    return false;
  }
  // IPython 7+ allows for calling await at the top level, outside of an async
  // function.
  const isStartOfLine = diagnostic.range.start.character === 0;
  if (
    isStartOfLine &&
    text.startsWith('await') &&
    diagnostic.message.includes('allowed only within async function')
  ) {
    return false;
  }
  return true;
}
