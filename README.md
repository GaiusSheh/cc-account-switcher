# Claude Code Account Switcher

A VSCode extension to switch between multiple Claude Code accounts without browser re-authentication.

## Features

- Display current Claude Code account in status bar
- Distinguishes "No Account" (not logged in) from "Unknown" (logged in but not registered)
- One-click switching between managed accounts
- Auto-reload window after switch
- Rename, remove accounts
- Link current session to an existing account (useful after OAuth token rotation)

## Usage

1. **Add Account**: Click the status bar item and select `Add Current Account` to save your currently logged-in account with a label
2. **Switch Account**: Click the status bar item and select any saved account to switch
3. **Rename Account**: Click the status bar item, open `Manage Accounts`, and select `Rename` next to an account
4. **Remove Account**: Click the trash icon next to an account in the picker
5. **Link Current Session**: If the status bar shows `Unknown`, open `Manage Accounts` and select `Link Current Session` to bind your current credentials to an existing account

## Requirements

- VSCode 1.80.0 or higher
- Claude Code extension installed and logged in

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
