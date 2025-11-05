# How to Contribute

We would love to accept your patches and contributions to this project.

## Before you begin

### Sign our Contributor License Agreement

Contributions to this project must be accompanied by a
[Contributor License Agreement](https://cla.developers.google.com/about) (CLA).
You (or your employer) retain the copyright to your contribution; this simply
gives us permission to use and redistribute your contributions as part of the
project.

If you or your current employer have already signed the Google CLA (even if it
was for a different project), you probably don't need to do it again.

Visit <https://cla.developers.google.com/> to see your current agreements or to
sign a new one.

### Review our Community Guidelines

This project follows [Google's Open Source Community
Guidelines](https://opensource.google/conduct/).

## Contribution process

### Prerequisites

- [VS Code](https://code.visualstudio.com/)
- If using `nvm` (**recommended**): `nvm use` at repo root to set the correct versions of `node` and `npm`.
- If **not** using `nvm`:
  - [Node.js](https://nodejs.org/) at the version listed in [.nvmrc](https://github.com/googlecolab/colab-vscode/blob/main/.nvmrc).
  - The matching [npm](https://www.npmjs.com/) version (comes bundled with `node`).
- The following extensions:
  - [Jupyter](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
  - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
  - [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- Configure your environment:
  - Create an OAuth 2.0 _Desktop_ client credentials ([instructions](https://developers.google.com/identity/protocols/oauth2)).
  - Make a copy of the environment template: `cp .env.template .env`
  - Set the values in the `.env` file:
    ```txt
    COLAB_EXTENSION_CLIENT_ID=<TODO>
    COLAB_EXTENSION_CLIENT_NOT_SO_SECRET=<TODO>
    ```
  - Execute `npm run generate:config` to generate the required static config.

### Local Development

1. Open the repo root with VS Code.
1. `npm ci` - install dependencies.
1. `npm run generate:config` - generate the required static config. This only needs to be done when changes to `.env` are made.
1. Launch the extension by pressing `F5` or selecting `Run Extension` from VS Code's _Run and Debug_ view.
1. Create or open a Jupyter notebook file (`.ipynb`).
1. Test and validate your changes.

#### Incremental Build

Launching the extension will automatically kick off the `watch:prod` build task. This can be ran without launching during development by [running the build task](https://code.visualstudio.com/docs/debugtest/tasks).

Incremental build output can be found in the _Terminal_ VS Code panel.

TypeScript errors and warnings can be found in the _Problems_ VS Code panel, provided a _typecheck_-ing build is running (see [`package.json`](https://github.com/googlecolab/colab-vscode/blob/main/package.json)).

If you've removed files, you may need to `npm run clean`.

#### Tests

Unit tests must have the extension `.unit.test.ts`. To run them:

```sh
npm run test:unit
npm run test:unit -- --grep='your-regex-filter'
```

Unit tests can be debugged by launching _Debug Unit Tests_. The `"args"` can be modified to filter with the `grep` field as outlined above.

The unit tests rely extensively on a [Sinon](https://sinonjs.org/) stub of the `vscode` module. `vscode` is the _engine_ the Node app runs under and is not an installable npm package. While this stubbing is terse, it enables the entire unit test suite to run sub-1-second. Please peruse existing tests for reference when authoring new ones.

While there are end-to-end tests, running them requires access to accounts with _automation_ exemptions that only Googlers can use. Pull request automation (once approved by a maintainer) will run them.

### Code Reviews

All submissions, including submissions by project members, require review. We
use [GitHub pull requests](https://docs.github.com/articles/about-pull-requests)
for this purpose.
