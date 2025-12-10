# Jupyter Server Client

This document provides an overview of the auto-generated client for communicating with the Jupyter Server API.

## `api.yaml`

This is the spec file a Colab kernel exposes. It can be queried for on any Colab server (provided you've supplied the necessary credentials) at /api/spec.yaml.

The submitted file is a pure copy of that returned from a Colab server, with a single modification: `paths:/api/contents/{path}:patch:parameters:name` was changed from `path` to `rename` to resolve the conflict with the URL `path`. Without this change, the generated client will drop the POST payload needed when calling the endpoint.

## `@openapitools/openapi-generator-cli`

OpenAPI Generator is the standard for generating client libraries. It depends on Java and expects `java` to be available on the `PATH` of the machine running the tool.

It can be ran with the following: `npm run generate:jupyterclient`.

## Special Sauce

Since this codebase uses strict TS compilation rules and the generator often includes things like unnecessary imports (instead relying on builds to shake out what they don't need), we add `// @ts-nocheck` to all files.
