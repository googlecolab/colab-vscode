# Colab API Client

This document provides an overview of the auto-generated client for
communicating with the Colab public API.

## `api-*.json`

The OpenAPI JSON files are manually downloaded from
https://colaboratory.googleapis.com/$discovery/OPENAPI3_0?version=\{version\}&key=\{api_key\}.

> [!NOTE]
> Colab API is *not yet* launched publicly, so an API key with access to the API
> is currently required to view the OpenAPI schema.

* `api-v1.json` currently holds the schema of
[Operations API](https://github.com/googleapis/googleapis/blob/master/google/longrunning/operations.proto),
which is required to interact with `CreateRuntime` [long-running operations](https://google.aip.dev/151).

* `api-v1beta.json` holds the schema of Colab API (still in beta), which
interacts with Colab managed runtimes.

## `openapi-typescript`

We use `openapi-typescript` to generate the OpenAPI TypeScript schema. More info
can be found at https://openapi-ts.dev/introduction.

It can be ran with the following: `npm run generate:colabclient`.
