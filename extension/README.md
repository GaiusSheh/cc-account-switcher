# Claude Code Account Switcher

A VSCode extension to switch between multiple Claude Code accounts without browser re-authentication.

## Features

- Display current Claude Code account in status bar
- Distinguishes "No Account" (not logged in) from "Unknown" (logged in but not registered)
- One-click switching between managed accounts, with auto-reload after switch
- Add a new account from inside VSCode: runs `claude auth login` for you and detects the account's email
- Prevents registering the same account twice (matched by email)
- Rename, remove accounts
- Link current session to an existing account (useful after OAuth token rotation)
- Only credentials are swapped; your Claude Code settings are never modified

## Usage

Click the account item in the status bar to open the account picker.

1. **Switch Account**: Select any saved account. The window reloads to apply it
2. **Add New Account**: Select `Add new account...`. A `Claude Login` terminal runs `claude auth login`; finish the sign-in in your browser with the new account (if the browser is already signed in to claude.ai with another account, sign out there or use a private window first). The extension then detects the account's email and asks for a label
3. **Add Current Account**: Select `Add current account` to save the account you are already logged into
4. **Rename Account**: Select `Rename account...`
5. **Remove Account**: Click the trash icon next to an account in the picker (the active account can't be removed)
6. **Link Current Session**: If the status bar shows `Unknown`, select `Link current session to account...` to bind your current credentials to an existing account

Always switch accounts through this extension: it keeps each account's latest rotated token so switching back doesn't fail with 401.

Troubleshooting: the `CC Account Switcher` panel in the Output view logs each step of adding an account.

## Requirements

- VSCode 1.80.0 or higher
- Claude Code installed and logged in
- `claude` CLI on `PATH` (used for `Add new account...` and account detection)

## Development

```bash
cd extension

# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npx @vscode/vsce package --allow-missing-repository
```

## License

MIT
