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

### Local Development

#### Install dependencies

Open the cloned repository folder:

```
git clone https://github.com/googlecolab/colab-vscode.git
cd colab-vscode
```

Run `npm ci` to install dependencies.

#### Configure your environment

Create OAuth 2.0 _Desktop_ client credentials ([instructions](https://developers.google.com/identity/protocols/oauth2)).

Make a copy of the environment template: `cp .env.template .env`

Set the values in the `.env` file:

```
COLAB_EXTENSION_ENVIRONMENT="production"
COLAB_EXTENSION_CLIENT_ID=<TODO>
COLAB_EXTENSION_CLIENT_NOT_SO_SECRET=<TODO>
```

Execute `npm run generate:config` to generate the required static config.

#### Run the extension

1. Open the repo root with VS Code.
1. Launch the extension by pressing `F5` or selecting `Run Extension` from VS Code's _Run and Debug_ view.
1. Create or open a Jupyter notebook file (`.ipynb`).
1. Test and validate your changes.

### Code Reviews

All submissions, including submissions by project members, require review. We
use [GitHub pull requests](https://docs.github.com/articles/about-pull-requests)
for this purpose.
