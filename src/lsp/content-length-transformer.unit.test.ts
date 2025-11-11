/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from "stream";
import { expect } from "chai";
import { ContentLengthTransformer } from "./content-length-transformer";

async function transformChunks(
  chunks: (string | Buffer | Uint8Array | DataView)[],
): Promise<string> {
  const transformer = new ContentLengthTransformer();
  const readable = Readable.from(chunks);

  let output = "";
  readable.pipe(transformer).on("data", (data: Buffer | string) => {
    output += data.toString("utf-8");
  });

  return new Promise((resolve, reject) => {
    readable.on("end", () => {
      resolve(output);
    });
    readable.on("error", reject);
  });
}

describe("ContentLengthTransformer", () => {
  it("adds the Content-Length header to a JSON string", async () => {
    const message = '{"jsonrpc":"2.0","method":"initialized","params":{}}';

    const result = await transformChunks([message]);

    const expected = `Content-Length: ${Buffer.byteLength(
      message,
      "utf-8",
    ).toString()}\r\n\r\n${message}`;
    expect(result).to.equal(expected);
  });

  it("does not add the Content-Length header if one is already present", async () => {
    const message =
      'Content-Length: 1234\r\n\r\n{"jsonrpc":"2.0","method":"initialized","params":{}}';

    const result = await transformChunks([message]);

    expect(result).to.equal(message);
  });

  it("does not add the Content-Length header if one is already present (case-insensitive)", async () => {
    const message =
      'content-length: 1234\r\n\r\n{"jsonrpc":"2.0","method":"initialized","params":{}}';

    const result = await transformChunks([message]);

    expect(result).to.equal(message);
  });

  it("handles Buffer input", async () => {
    const message = '{"jsonrpc":"2.0"}';
    const buffer = Buffer.from(message, "utf-8");

    const result = await transformChunks([buffer]);

    const expected = `Content-Length: ${buffer.length.toString()}\r\n\r\n${message}`;
    expect(result).to.equal(expected);
  });

  it("handles Uint8Array input", async () => {
    const message = '{"jsonrpc":"2.0"}';
    const uint8Array = new TextEncoder().encode(message);

    const result = await transformChunks([uint8Array]);

    const expected = `Content-Length: ${uint8Array.length.toString()}\r\n\r\n${message}`;
    expect(result).to.equal(expected);
  });

  it("handles DataView input", async () => {
    const message = '{"jsonrpc":"2.0"}';
    const buffer = new TextEncoder().encode(message).buffer;
    const dataView = new DataView(buffer);

    const result = await transformChunks([dataView]);

    const expected = `Content-Length: ${dataView.byteLength.toString()}\r\n\r\n${message}`;
    expect(result).to.equal(expected);
  });

  it("handles multiple chunks", async () => {
    const message1 = '{"jsonrpc":"2.0"}';
    const message2 = '{"method":"test"}';

    const result = await transformChunks([message1, message2]);

    const message1Length = Buffer.byteLength(message1, "utf-8");
    const expected1 = `Content-Length: ${message1Length.toString()}\r\n\r\n${message1}`;
    const message2Length = Buffer.byteLength(message2, "utf-8");
    const expected2 = `Content-Length: ${message2Length.toString()}\r\n\r\n${message2}`;

    expect(result).to.equal(expected1 + expected2);
  });

  it("handles empty string input", async () => {
    const result = await transformChunks([""]);

    const expected = `Content-Length: 0\r\n\r\n`;
    expect(result).to.equal(expected);
  });
});
