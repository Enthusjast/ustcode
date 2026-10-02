# USTCODE

<p align="center">The open source AI coding agent.</p>

---

## Installation

```bash
# YOLO
curl -fsSL https://ustcode.enthusjast.cc/install | bash

# Package managers
npm i -g @ustcode-ai/cli@latest  # or bun/pnpm/yarn
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

## Desktop App (BETA)

USTCode is also available as a desktop application. Download directly from the [releases page](https://github.com/Enthusjast/ustcode/releases) or [ustcode.enthusjast.cc/download](https://ustcode.enthusjast.cc/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `ustcode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `ustcode-desktop-mac-x64.dmg`     |
| Windows               | `ustcode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
Download the desktop installer from the GitHub Releases page above.
```

## Installation Directory

The install script respects the following priority order for the installation path:

1. `$USTCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.ustcode/bin` - Default fallback

```bash
# Examples
USTCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://ustcode.enthusjast.cc/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://ustcode.enthusjast.cc/install | bash
```

## Agents

USTCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://ustcode.enthusjast.cc/docs/agents).

## Documentation

For more info on how to configure USTCode, [**head over to our docs**](https://ustcode.enthusjast.cc/docs).

## Contributing

If you're interested in contributing to USTCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

## Building on USTCode

If you are working on a project that's related to USTCode and is using "ustcode" as part of its name, for example "ustcode-dashboard" or "ustcode-mobile", please add a note to your README to clarify that it is not built by the USTCode team and is not affiliated with us in any way.
