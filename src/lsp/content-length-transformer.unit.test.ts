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
      write(chunk, _, callback) {
        output += chunk.toString();
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
      )}\r\n\r\n${message}`;
      expect(output).to.equal(expected);
      done();
    });
  });

  it("should handle multiple JSON objects in a single chunk", (done) => {
    const message1 = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const message2 = '{"jsonrpc":"2.0","method":"test","params":{}}';
    const stream = createTestStream(`${message1}${message2}`);

    stream.on("finish", () => {
      const expected1 = `Content-Length: ${Buffer.byteLength(
        message1,
        "utf-8",
      )}\r\n\r\n${message1}`;
      const expected2 = `Content-Length: ${Buffer.byteLength(
        message2,
        "utf-8",
      )}\r\n\r\n${message2}`;
      expect(output).to.equal(`${expected1}${expected2}`);
      done();
    });
  });

  it("should handle JSON objects split across multiple chunks", (done) => {
    const message = '{"jsonrpc":"2.0","method":"initialized","params":{}}';
    const part1 = message.substring(0, 10);
    const part2 = message.substring(10);

    const readable = new Readable({
      read() {
        this.push(part1);
        this.push(part2);
        this.push(null);
      },
    });

    const writable = new Writable({
      write(chunk, _, callback) {
        output += chunk.toString();
        callback();
      },
    });

    readable.pipe(transformer).pipe(writable);

    writable.on("finish", () => {
      const expected = `Content-Length: ${Buffer.byteLength(
        message,
        "utf-8",
      )}\r\n\r\n${message}`;
      expect(output).to.equal(expected);
      done();
    });
  });

  it("should handle nested JSON objects", (done) => {
    const message =
      '{"jsonrpc":"2.0","result":{"capabilities":{"textDocumentSync":1}}}';
    const stream = createTestStream(message);

    stream.on("finish", () => {
      const expected = `Content-Length: ${Buffer.byteLength(
        message,
        "utf-8",
      )}\r\n\r\n${message}`;
      expect(output).to.equal(expected);
      done();
    });
  });

  it("should handle empty input", (done) => {
    const stream = createTestStream("");

    stream.on("finish", () => {
      expect(output).to.equal("");
      done();
    });
  });

  it("should handle input with no JSON objects", (done) => {
    const stream = createTestStream("this is not json");

    stream.on("finish", () => {
      expect(output).to.equal("");
      done();
    });
  });

  it("should handle malformed JSON by not outputting it", (done) => {
    const stream = createTestStream('{"jsonrpc":"2.0",');

    stream.on("finish", () => {
      expect(output).to.equal("");
      done();
    });
  });
});
