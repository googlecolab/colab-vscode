# Colab API Client

This document provides an overview of the auto-generated client for
communicating with the Colab public API.

## `*-api.json`

The OpenAPI spec files are manually downloaded from
https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version={version}&key={api_key}.

> [!NOTE]
> Colab API is _not yet_ launched publicly, so an API key with access to the API
> is currently required to view the OpenAPI spec.

- `colab-api.json` holds the specs of the Colab API (still in beta), which
  primarily interacts with Colab managed runtimes. This is downloaded from
  https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version=v1beta&key={api_key}.

- `operations-api.json` holds the specs of the
  [Operations API](https://github.com/googleapis/googleapis/blob/master/google/longrunning/operations.proto),
  which is required to interact with `CreateRuntime` [long-running operations](https://google.aip.dev/151).
  This is downloaded from
  https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version=v1&key={api_key}.

## `@openapitools/openapi-generator-cli`

We use `@openapitools/openapi-generator-cli` to generate a single OpenAPI
TypeScript client, in `generated/colab`, covering both specs. It depends on Java
and expects `java` to be available on the `PATH` of the machine running the
tool. More info can be found at https://openapi-generator.tech.

The pipeline lives in `generate.mts` and can be run with
`npm run generate:colabclient`. It has three steps:

1. **Preprocess.** Some preprocessing is required for
   `@openapitools/openapi-generator-cli` to work properly with
   `google.protobuf.Empty` returned by `DELETE` APIs. Each spec is rewritten to
   a `*-api-fixed.json` intermediate.

2. **Merge.** The two fixed specs are folded into a single `merged-api.json`
   intermediate, with `colab-api.json` as the base, so the merged document
   keeps the Colab API's `info`, and hence its `v1beta` version. The two specs
   describe the same host and their paths are already version-prefixed, so the
   only real overlap is in `components`: both define `Operation`, `Status`,
   `Error` and friends, identically. The merge only skips an overlapping member
   after proving it deep-equal, and throws otherwise. That assertion is the
   signal that the two specs have diverged and the merge is no longer safe.

3. **Generate.** `openapi-generator-cli` runs once over `merged-api.json`.

Both source spec files stay checked in and unmodified, so re-downloading either
one from the discovery endpoint is a straight overwrite. The intermediates are
gitignored.

## Special Sauce

Since this codebase uses strict TS compilation rules and the generator often
includes things like unnecessary imports (instead relying on builds to shake out
what they don't need), we add `// @ts-nocheck` to all files.
