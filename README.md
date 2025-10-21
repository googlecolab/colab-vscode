# Google Colab VS Code Extension

Colab is a hosted Jupyter Notebook service that requires no setup to use and
provides free access to computing resources, including GPUs and TPUs. Built atop
the [Jupyter
extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter),
this extension exposes Colab servers directly in VS Code!

- 👾 [Bug
  report](https://github.com/googlecolab/colab-vscode/issues/new?template=bug_report.md)
- ✨ [Feature
  request](https://github.com/googlecolab/colab-vscode/issues/new?template=feature_request.md)
- 💬 [Discussions](https://github.com/googlecolab/colab-vscode/discussions)

## Quick Start

1. Install [VS Code](https://code.visualstudio.com).
1. Install the [Colab
   extension](https://marketplace.visualstudio.com/items?itemName=google.colab)
   (and Jupyter if not already installed).
1. Open or create a notebook file.
1. When prompted, sign in.
1. Click `Select Kernel` > `Colab` > `New Colab Server`.
1. 😎 Enjoy!

![Connecting to a new Colab server and executing a code
cell](./docs/assets/hello-world.gif)

## Commands

Activate the command palette with `Ctrl+Shift+P` or `Cmd+Shift+P` on Mac.

| Command                | Description                                |
| ---------------------- | ------------------------------------------ |
| `Colab: Remove server` | Select an assigned Colab server to remove. |

## Contributing

Contributions are welcome and appreciated! See the [contributing
guide](./docs/contributing.md) for more info.

## Data and Telemetry

The extension does not collect any client-side usage data within VS Code. See
Colab's [Terms of Service](https://research.google.com/colaboratory/tos_v5.html)
and the [Google Privacy Policy](https://policies.google.com/privacy), which
apply to usage of this extension.

## Security Disclosures

Please see our [security disclosure process](./SECURITY.md). All [security
advisories](https://github.com/googlecolab/colab-vscode/security/advisories) are
managed on GitHub.
