/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Transform } from "stream";

/**
 * Transformer that adds a Content-Length header prefix to incoming LSP
 * messages. The Colab LSP server currently strips these out, but they are
 * required by the LSP spec, so we put them back in here.
 */
export class ContentLengthTransformer extends Transform {
  private buffer = "";

  override _transform(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.buffer += chunk.toString("utf-8");

    let braceLevel = 0;
    let messageStart = -1;
    // The Content-Length header is already present, skip.
    if (this.buffer.length > 0 && this.buffer.startsWith("C")) {
      this.push(this.buffer.toString());
      callback();
      return;
    }
    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char === "{") {
        if (braceLevel === 0) {
          messageStart = i;
        }
        braceLevel++;
      } else if (char === "}") {
        if (braceLevel > 0) {
          braceLevel--;
        }

        if (braceLevel === 0 && messageStart !== -1) {
          const message = this.buffer.substring(messageStart, i + 1);
          this.push(
            Buffer.from(
              `Content-Length: ${Buffer.byteLength(
                message,
                "utf-8",
              ).toString()}\r\n\r\n${message}`,
            ),
          );
          this.buffer = this.buffer.substring(i + 1);
          i = -1;
          messageStart = -1;
        }
      }
    }
    callback();
  }
}