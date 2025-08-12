/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from "path";
import vscode from "vscode";

interface UriOptions {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

/**
 * An approximate test double for vscode.Uri.
 */
export class TestUri implements vscode.Uri {
  static parse(stringUri: string): TestUri {
    const url = new URL(stringUri);
    return new TestUri(
      url.protocol.replace(/:$/, ""),
      url.hostname,
      url.pathname,
      url.search.replace(/^\?/, ""),
      url.hash.replace(/^#/, ""),
    );
  }

  static file(filePath: string): TestUri {
    return new TestUri(
      "file",
      "",
      filePath.split("?")[0] || "",
      filePath.split("?")[1] || "",
      "",
    );
  }

  static joinPath(base: TestUri, ...pathSegments: string[]): TestUri {
    const { path: p, ...rest } = base;
    return new this(
      rest.scheme,
      rest.authority,
      join(p, ...pathSegments),
      rest.query,
      rest.fragment,
    );
  }

  static from(components: UriOptions): vscode.Uri {
    return new TestUri(
      components.scheme,
      components.authority,
      components.path,
      components.query,
      components.fragment,
    );
  }

  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;

  get fsPath(): string {
    return this.path;
  }

  constructor(
    scheme: string,
    authority: string,
    path: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  with(change: Partial<UriOptions>): vscode.Uri {
    return new TestUri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(): string {
    // eslint-disable-next-line prefer-const
    let { scheme, authority, path, query, fragment } = this;
    if (query.length > 0) query = `?${query}`;
    if (fragment.length > 0) fragment = `#${fragment}`;
    return `${scheme}://${authority}${path}${query}${fragment}`;
  }

  toJSON(): string {
    return JSON.stringify({
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    });
  }
}
