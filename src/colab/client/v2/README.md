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
  https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version=v1beta&labels=COLAB_INTERNAL&key={api_key}.

- `operations-api.json` holds the specs of the
  [Operations API](https://github.com/googleapis/googleapis/blob/master/google/longrunning/operations.proto),
  which is required to interact with `CreateRuntime` [long-running operations](https://google.aip.dev/151).
  This is downloaded from
  https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version=v1&key={api_key}.

## `@openapitools/openapi-generator-cli`

We use `@openapitools/openapi-generator-cli` to generate the OpenAPI TypeScript
clients. It depends on Java and expects `java` to be available on the `PATH` of
the machine running the tool. More info can be found at https://openapi-generator.tech.

Some preprocessing is required for `@openapitools/openapi-generator-cli` to work
properly with `google.protobuf.Empty` returned by `DELETE` APIs. The
preprocessing logic can be found in `generate.mts`, and can be ran with:
`npm run generate:colabclient`.

## Special Sauce

Since this codebase uses strict TS compilation rules and the generator often
includes things like unnecessary imports (instead relying on builds to shake out
what they don't need), we add `// @ts-nocheck` to all files.
