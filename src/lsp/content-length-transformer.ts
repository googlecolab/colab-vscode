/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Transform } from "stream";

const CONTENT_LENGTH = "content-length";

/**
 * Transformer that adds a Content-Length header prefix to incoming LSP
 * messages. The Colab LSP server currently strips these out, but they are
 * required by the LSP spec, so we put them back in here.
 */
export class ContentLengthTransformer extends Transform {
  override _transform(
    chunk: string | Buffer | Uint8Array | DataView,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    // Colab's language server only chunks by complete, utf-8 JSON objects.
    let json: string;
    if (typeof chunk === "string") {
      json = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      json = chunk.toString("utf-8");
    } else if (chunk instanceof DataView) {
      json = Buffer.from(
        chunk.buffer,
        chunk.byteOffset,
        chunk.byteLength,
      ).toString("utf-8");
    } else {
      // Uint8Array or other ArrayBufferView
      json = Buffer.from(chunk).toString("utf-8");
    }

    // The Content-Length header is already present, skip.
    if (
      json.length > 0 &&
      json.substring(0, CONTENT_LENGTH.length).toLowerCase() === CONTENT_LENGTH
    ) {
      this.push(json);
      callback();
      return;
    }

    this.push(
      Buffer.from(
        `Content-Length: ${Buffer.byteLength(json, "utf-8").toString()}\r\n\r\n${json}`,
      ),
    );

    callback();
  }
}
