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

#### Configure your environment

Make a copy of the environment template:

`cp .env.template .env`

Set the extension environment: `COLAB_EXTENSION_ENVIRONMENT="production"`

Set the OAuth 2.0 client ID and secret, which can be obtained through following the instructions [here](https://developers.google.com/identity/protocols/oauth2):

```
COLAB_EXTENSION_CLIENT_ID=<OAuth 2.0 client ID>
COLAB_EXTENSION_CLIENT_NOT_SO_SECRET=<OAuth 2.0 client secret>
```

Then, execute `npm run generate:config`, which generates the static config file needed to run the extension.

### Code Reviews

All submissions, including submissions by project members, require review. We
use [GitHub pull requests](https://docs.github.com/articles/about-pull-requests)
for this purpose.
