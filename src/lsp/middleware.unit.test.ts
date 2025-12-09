/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import type vscode from 'vscode';
import {
  type ProvideDiagnosticSignature,
  type ProvideWorkspaceDiagnosticSignature,
  vsdiag,
} from 'vscode-languageclient/node';
import { TestCancellationToken } from '../test/helpers/cancellation';
import { TestUri } from '../test/helpers/uri';
import {
  DiagnosticSeverity,
  newVsCodeStub,
  VsCodeStub,
} from '../test/helpers/vscode';
import {
  filterNonIPythonDiagnostics,
  filterNonIPythonWorkspaceDiagnostics,
} from './middleware';

function createDiagnostic(
  range: vscode.Range,
  message = '',
): vscode.Diagnostic {
  return {
    range,
    message,
    severity: DiagnosticSeverity.Error,
    source: 'Colab',
    code: '',
    tags: [],
    relatedInformation: [],
  };
}

function createReport(
  uri: vscode.Uri,
  items: vscode.Diagnostic[],
  version = 0,
  resultId = '1',
): vsdiag.WorkspaceFullDocumentDiagnosticReport {
  return {
    uri,
    kind: 'full' as vsdiag.DocumentDiagnosticReportKind.full,
    items,
    version,
    resultId,
  };
}

function createUnchangedReport(
  resultId = '1',
): vsdiag.RelatedUnchangedDocumentDiagnosticReport {
  return {
    kind: 'unChanged' as vsdiag.DocumentDiagnosticReportKind.unChanged,
    resultId,
  };
}

function createDocument(
  uri: vscode.Uri,
  getTextStub: sinon.SinonStub<[range?: vscode.Range], string>,
): vscode.TextDocument {
  return {
    uri,
    getText: getTextStub,
  } as Partial<vscode.TextDocument> as vscode.TextDocument;
}

function createRange(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): vscode.Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  } as Partial<vscode.Range> as vscode.Range;
}

describe('filterNonIPythonDiagnostics', () => {
  let vsCodeStub: VsCodeStub;
  let cancellationToken: TestCancellationToken;
  let next: sinon.SinonStub<
    Parameters<ProvideDiagnosticSignature>,
    ReturnType<ProvideDiagnosticSignature>
  >;
  let getText: sinon.SinonStub<[range?: vscode.Range], string>;
  let textDocument: vscode.TextDocument;
  const docUri = new TestUri('file', '', '/path/to/notebook.ipynb', '', '');

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    cancellationToken = new TestCancellationToken(
      new vsCodeStub.EventEmitter<void>(),
    );
    next = sinon.stub();
    getText = sinon.stub();
    textDocument = createDocument(docUri, getText);
    vsCodeStub.workspace.textDocuments = [textDocument];
  });

  it('filters bash diagnostics', async () => {
    const diagnostic = createDiagnostic(createRange(0, 0, 0, 1));
    const report = createReport(docUri, [diagnostic]);
    next.resolves(report);
    getText.withArgs(diagnostic.range).returns('!');

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.deep.equal({ ...report, items: [] });
  });

  it('filters magic diagnostics', async () => {
    const diagnostic = createDiagnostic(createRange(0, 0, 0, 1));
    const report = createReport(docUri, [diagnostic]);
    next.resolves(report);
    getText.withArgs(diagnostic.range).returns('%');

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.deep.equal({ ...report, items: [] });
  });

  it('filters top-level await diagnostics', async () => {
    const diagnostic = createDiagnostic(
      createRange(0, 0, 0, 5),
      'await is allowed only within async function',
    );
    const report = createReport(docUri, [diagnostic]);
    next.resolves(report);
    getText.withArgs(diagnostic.range).returns('await');

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.deep.equal({ ...report, items: [] });
  });

  it('retains valid diagnostics and filters invalid ones', async () => {
    const d1 = createDiagnostic(createRange(0, 0, 0, 1)); // filter
    const d2 = createDiagnostic(createRange(1, 0, 1, 5)); // keep
    const d3 = createDiagnostic(createRange(2, 0, 2, 1)); // filter
    const report = createReport(docUri, [d1, d2, d3]);
    next.resolves(report);
    getText.withArgs(d1.range).returns('!');
    getText.withArgs(d2.range).returns('print()');
    getText.withArgs(d3.range).returns('%');

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.deep.equal({ ...report, items: [d2] });
  });

  it('does not filter non-full reports', async () => {
    const report = createUnchangedReport();
    next.resolves(report);

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.equal(report);
    sinon.assert.notCalled(getText);
  });

  it('does not filter if document is not found', async () => {
    vsCodeStub.workspace.textDocuments = [];
    const report = createReport(docUri, [
      createDiagnostic(createRange(0, 0, 0, 1)),
    ]);
    next.resolves(report);

    const result = await filterNonIPythonDiagnostics(
      vsCodeStub.asVsCode(),
      docUri,
      undefined,
      cancellationToken,
      next,
    );

    expect(result).to.equal(report);
    sinon.assert.notCalled(getText);
  });
});

describe('filterNonIPythonWorkspaceDiagnostics', () => {
  let vsCodeStub: VsCodeStub;
  let cancellationToken: TestCancellationToken;
  let next: sinon.SinonStub<
    Parameters<ProvideWorkspaceDiagnosticSignature>,
    ReturnType<ProvideWorkspaceDiagnosticSignature>
  >;
  let resultReporter: sinon.SinonStub;
  let getText: sinon.SinonStub<[range?: vscode.Range], string>;
  let textDocument: vscode.TextDocument;
  const docUri = new TestUri('file', '', '/path/to/notebook.ipynb', '', '');

  async function getCustomReporter(): Promise<vsdiag.ResultReporter> {
    await filterNonIPythonWorkspaceDiagnostics(
      vsCodeStub.asVsCode(),
      [],
      cancellationToken,
      resultReporter,
      next,
    );
    return next.args[0][2];
  }

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    cancellationToken = new TestCancellationToken(
      new vsCodeStub.EventEmitter<void>(),
    );
    next = sinon.stub();
    resultReporter = sinon.stub();
    getText = sinon.stub();
    textDocument = createDocument(docUri, getText);
    vsCodeStub.workspace.textDocuments = [textDocument];
  });

  it('filters diagnostics from the result reporter', async () => {
    const d1 = createDiagnostic(createRange(0, 0, 0, 1)); // filter
    const d2 = createDiagnostic(createRange(1, 0, 1, 5)); // keep
    const report = createReport(docUri, [d1, d2]);
    getText.withArgs(d1.range).returns('!');
    getText.withArgs(d2.range).returns('print()');

    const customReporter = await getCustomReporter();
    customReporter({ items: [report] });

    const expectedReport = { ...report, items: [d2] };
    sinon.assert.calledOnceWithExactly(resultReporter, {
      items: [expectedReport],
    });
  });

  it('does not filter non-full reports', async () => {
    const report: vsdiag.WorkspaceDocumentDiagnosticReport = {
      ...createUnchangedReport(),
      uri: docUri,
      version: 0,
    };

    const customReporter = await getCustomReporter();
    customReporter({ items: [report] });

    sinon.assert.calledOnceWithExactly(resultReporter, { items: [report] });
    sinon.assert.notCalled(getText);
  });

  it('does not filter if document is not found', async () => {
    vsCodeStub.workspace.textDocuments = [];
    const report: vsdiag.WorkspaceDocumentDiagnosticReport = {
      ...createReport(docUri, [createDiagnostic(createRange(0, 0, 0, 1))]),
      version: 0,
    };

    const customReporter = await getCustomReporter();
    customReporter({ items: [report] });

    sinon.assert.calledOnceWithExactly(resultReporter, { items: [report] });
    sinon.assert.notCalled(getText);
  });

  it('should handle multiple reports in a single chunk', async () => {
    const d1 = createDiagnostic(createRange(0, 0, 0, 1)); // filter
    const d2 = createDiagnostic(createRange(1, 0, 1, 5)); // keep
    const report1 = createReport(docUri, [d1]);
    const report2 = createReport(docUri, [d2]);
    getText.withArgs(d1.range).returns('!');
    getText.withArgs(d2.range).returns('print()');

    const customReporter = await getCustomReporter();
    customReporter({ items: [report1, report2] });

    sinon.assert.calledOnceWithExactly(resultReporter, {
      items: [{ ...report1, items: [] }, report2],
    });
  });

  it('should pass null chunks through to the reporter', async () => {
    const customReporter = await getCustomReporter();
    customReporter(null);
    sinon.assert.calledOnceWithExactly(resultReporter, null);
  });
});
