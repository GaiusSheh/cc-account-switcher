# Claude Code Account Switcher

A VSCode extension to switch between multiple Claude Code accounts without browser re-authentication.

## Features

- Display current Claude Code account in status bar
- One-click switching between managed accounts
- Auto-reload window after switch
- Preserve all settings except authentication

## Usage

1. **Add Account**: Use command `CC Switcher: Add Current Account` to add your currently logged-in account
2. **Switch Account**: Click the status bar item showing your account email, then select target account
3. **Remove Account**: Use command `CC Switcher: Remove Account` to remove an account from registry

## Requirements

- VSCode 1.80.0 or higher
- Claude Code extension installed and logged in

## Architecture

See [DESIGN.md](DESIGN.md) for detailed architecture and design decisions.

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npm install -g @vscode/vsce
vsce package
```

## License

MIT
