/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Transform } from "stream";

/**
 * Transformer that adds a Content-Length header prefix to incoming LSP
 * messages.
 *
 * This is a client-side workaround needed since the Colab language server is
 * not spec-compliant. It returns the JSON object without the "Content-Length"
 * header, which the spec requires and the LanguageClient expects.
 */
export class ContentLengthTransformer extends Transform {
  override _transform(
    chunk: string | Buffer | Uint8Array | DataView,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const json = chunkToString(chunk);

    // The Content-Length header is already present, skip.
    if (/^content-length/i.test(json)) {
      this.push(chunk);
    } else {
      const l = Buffer.byteLength(json, "utf-8");
      this.push(Buffer.from(`Content-Length: ${l.toString()}\r\n\r\n${json}`));
    }

    callback();
  }
}

function chunkToString(chunk: string | Buffer | Uint8Array | DataView): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf-8");
  }
  if (chunk instanceof DataView) {
    return Buffer.from(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    ).toString("utf-8");
  }
  // Uint8Array or other ArrayBufferView
  return Buffer.from(chunk).toString("utf-8");
}
