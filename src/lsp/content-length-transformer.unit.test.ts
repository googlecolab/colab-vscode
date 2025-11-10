/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable, Writable } from "stream";
import { expect } from "chai";
import { ContentLengthTransformer } from "./content-length-transformer";

describe("ContentLengthTransformer", () => {
  let transformer: ContentLengthTransformer;
  let output = "";

  beforeEach(() => {
    transformer = new ContentLengthTransformer();
    output = "";
  });

  function createTestStream(input: string | Buffer) {
    const readable = Readable.from(input);
    const writable = new Writable({
      write(
        chunk: Buffer | string,
        _enc: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        if (typeof chunk === "string") {
          output += chunk;
        } else {
          output += chunk.toString("utf-8");
        }
        callback();
      },
    });
    return readable.pipe(transformer).pipe(writable);
  }

  it("should do nothing if the header is already present", (done) => {
    const message =
      'Content-Length: 1234\r\n\r\n{"jsonrpc":"2.0","method":"initialized","params":{}}';
    const stream = createTestStream(message);

    stream.on("finish", () => {
      expect(output).to.equal(message);
      done();
    });
  });

  it("should add Content-Length header to a single JSON object", (done) => {
    const message = '{"jsonrpc":"2.0","method":"initialized","params":{}}';
    const stream = createTestStream(message);

    stream.on("finish", () => {
      const expected = `Content-Length: ${Buffer.byteLength(
        message,
        "utf-8",
      ).toString()}\r\n\r\n${message}`;
      expect(output).to.equal(expected);
      done();
    });
  });
});
