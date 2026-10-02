/**
 * Extension entry point
 *
 * Responsibilities:
 * - Extension activation and deactivation
 * - Register commands
 * - Initialize status bar
 * - Set up command handlers
 */

import * as vscode from 'vscode';
import { createStatusBarItem, updateStatusBar, disposeStatusBar } from './statusBar';
import {
    addAccount,
    switchAccount,
    removeAccount,
    renameAccount,
    linkCurrentSession,
    listAccounts,
    getActiveAccountId,
    getLoginStatus,
    backupActiveAccount,
    getCurrentRefreshToken,
    clearActiveAccount,
    findAccountByEmail
} from './accountManager';
import { getCurrentIdentity } from './authFiles';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Write a timestamped line to the "CC Account Switcher" output panel
 */
function log(message: string): void {
    outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CC Account Switcher extension is now active');

    outputChannel = vscode.window.createOutputChannel('CC Account Switcher');
    context.subscriptions.push(outputChannel);

    // Create status bar item
    createStatusBarItem(context);

    // Register command: Switch Account
    const switchCmd = vscode.commands.registerCommand('cc-switcher.switchAccount', async () => {
        await handleSwitchAccount();
    });

    // Register command: Add Current Account
    const addCmd = vscode.commands.registerCommand('cc-switcher.addAccount', async () => {
        await handleAddAccount();
    });

    // Register command: Add New Account (with account switching guidance)
    const addNewCmd = vscode.commands.registerCommand('cc-switcher.addNewAccount', async () => {
        await handleAddNewAccount();
    });

    // Register command: Remove Account
    const removeCmd = vscode.commands.registerCommand('cc-switcher.removeAccount', async () => {
        await handleRemoveAccount();
    });

    // Register command: List Accounts
    const listCmd = vscode.commands.registerCommand('cc-switcher.listAccounts', async () => {
        await handleListAccounts();
    });

    // Register command: Rename Account
    const renameCmd = vscode.commands.registerCommand('cc-switcher.renameAccount', async () => {
        await handleRenameAccount();
    });

    // Register command: Link Current Session to Account
    const linkCmd = vscode.commands.registerCommand('cc-switcher.linkCurrentSession', async () => {
        await handleLinkSession();
    });

    // Add commands to subscriptions
    context.subscriptions.push(switchCmd, addCmd, addNewCmd, removeCmd, listCmd, renameCmd, linkCmd);
}

export function deactivate() {
    // Cleanup status bar
    disposeStatusBar();
}

/**
 * Handle Switch Account command
 * Shows Quick Pick with all accounts, switches on selection
 */
const TRASH_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('trash'),
    tooltip: 'Remove account'
};

async function handleSwitchAccount(): Promise<void> {
    const accounts = listAccounts();
    const activeId = getActiveAccountId();
    const loginStatus = getLoginStatus();

    // Create Quick Pick items
    interface AccountQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const items: AccountQuickPickItem[] = accounts.map(acc => ({
        label: acc.label,
        description: acc.id === activeId && loginStatus.type === 'known' ? '● Active' : '',
        detail: `Added: ${new Date(acc.addedAt).toLocaleString()}`,
        accountId: acc.id,
        buttons: [TRASH_BUTTON]
    }));

    // Add management options
    const managementItems: vscode.QuickPickItem[] = [
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(add) Add current account', description: 'Add Account' },
        { label: '$(new-file) Add new account...', description: 'Add New Account' },
        { label: '$(edit) Rename account...', description: 'Rename Account' },
        { label: '$(link) Link current session to account...', description: 'Link Session' }
    ];

    const allItems = [...items, ...managementItems];

    // Create Quick Pick with active item pre-selected
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = allItems;
    quickPick.placeholder = accounts.length === 0
        ? 'No accounts yet. Add one to get started.'
        : 'Select account to switch to';
    quickPick.matchOnDescription = true;

    // Only highlight active item when status is known (not when Unknown)
    if (loginStatus.type === 'known') {
        const activeItem = items.find(item => item.accountId === activeId);
        if (activeItem) {
            quickPick.activeItems = [activeItem];
        }
    }

    // Show and wait for selection
    const selected = await new Promise<typeof allItems[number] | undefined>(resolve => {
        quickPick.onDidAccept(() => {
            const selection = quickPick.selectedItems[0];
            quickPick.hide();
            resolve(selection);
        });
        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });
        quickPick.onDidTriggerItemButton(async (e) => {
            const item = e.item as AccountQuickPickItem;
            quickPick.hide();
            resolve(undefined); // Close Quick Pick before showing dialogs

            if (loginStatus.type === 'known' && item.label === loginStatus.label) {
                vscode.window.showWarningMessage(
                    `Cannot remove active account "${item.label}". Switch to another account first.`
                );
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Remove account "${item.label}"? This will delete the backup credentials.`,
                { modal: true },
                'Remove'
            );
            if (confirm === 'Remove') {
                const result = await removeAccount(item.accountId);
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    updateStatusBar();
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            }
        });
        quickPick.show();
    });

    if (!selected) {
        return; // User cancelled
    }

    // Handle management commands
    if (selected.description === 'Add Account') {
        await handleAddAccount();
        return;
    }
    if (selected.description === 'Add New Account') {
        await handleAddNewAccount();
        return;
    }
    if (selected.description === 'Remove Account') {
        await handleRemoveAccount();
        return;
    }
    if (selected.description === 'Rename Account') {
        await handleRenameAccount();
        return;
    }
    if (selected.description === 'Link Session') {
        await handleLinkSession();
        return;
    }

    // Handle account switch
    const targetItem = selected as AccountQuickPickItem;
    if (!targetItem.accountId) {
        return;
    }

    // Don't switch if already active
    if (targetItem.accountId === activeId) {
        const account = accounts.find(a => a.id === targetItem.accountId);
        vscode.window.showInformationMessage(`Already using account: ${account?.label}`);
        return;
    }

    // Perform switch
    const result = await switchAccount(targetItem.accountId);

    if (result.success) {
        vscode.window.showInformationMessage(result.message);

        // Update status bar before reload
        updateStatusBar();

        // Auto-reload window to apply changes
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}

/**
 * Handle Add Account command
 * Prompts user for confirmation, then label, then adds current logged-in account to registry
 */
async function handleAddAccount(): Promise<void> {
    // First, confirm the user is logged into the correct account
    const proceed = await vscode.window.showInformationMessage(
        'This will save your currently logged-in Claude Code account. Make sure you have logged in to the correct account via `claude auth login` before proceeding.',
        { modal: true },
        'Continue',
        'Cancel'
    );

    if (proceed !== 'Continue') {
        return; // User cancelled
    }

    // Identify the account; null means it can't be determined, so skip the duplicate check
    const { identity, source } = await getCurrentIdentity();
    log(`Add current account: identity=${identity?.email ?? 'unknown'} (source: ${source})`);
    if (identity?.email) {
        const existing = findAccountByEmail(identity.email);
        if (existing) {
            log(`Add current account: ${identity.email} already registered as "${existing.label}", aborted`);
            vscode.window.showErrorMessage(
                `${identity.email} is already registered as "${existing.label}". ` +
                'Use "Link current session to account" to refresh its saved credentials.'
            );
            return;
        }
    }

    const label = await promptForLabel(
        identity?.email
            ? `Enter a label for ${identity.email}`
            : 'Enter a label for your currently logged-in account',
        identity?.email
    );

    if (!label) {
        log('Add current account: label prompt dismissed');
        return; // User cancelled
    }

    const result = await addAccount(label, identity ?? undefined);
    log(`Add current account: ${result.message}`);

    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}

/**
 * Prompt for a new, unique account label
 * Returns the trimmed label, or undefined if cancelled
 */
async function promptForLabel(prompt: string, value?: string): Promise<string | undefined> {
    const label = await vscode.window.showInputBox({
        prompt,
        value,
        placeHolder: 'e.g., "proton", "gmail", "work"',
        // Login finishes while the user is still in the browser; without this the
        // prompt closes as soon as it appears and the account isn't saved
        ignoreFocusOut: true,
        validateInput: (input) => {
            if (!input || input.trim().length === 0) {
                return 'Label cannot be empty';
            }
            // Check if label already exists
            const accounts = listAccounts();
            if (accounts.some(acc => acc.label === input.trim())) {
                return 'This label already exists';
            }
            return null;
        }
    });
    return label?.trim() || undefined;
}

/**
 * Run `claude auth login` in a dedicated terminal and wait for it to exit
 * Returns the exit code, or undefined if the user cancelled (terminal is killed)
 */
function runLoginInTerminal(): Thenable<number | undefined> {
    const isWindows = process.platform === 'win32';
    const terminal = vscode.window.createTerminal({
        name: 'Claude Login',
        shellPath: isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh'),
        shellArgs: isWindows ? ['/c', 'claude auth login'] : ['-lc', 'claude auth login']
    });
    terminal.show();

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Waiting for Claude login in the "Claude Login" terminal...',
            cancellable: true
        },
        (_progress, cancelToken) => new Promise<number | undefined>(resolve => {
            const closeSub = vscode.window.onDidCloseTerminal(closed => {
                if (closed !== terminal) {
                    return;
                }
                closeSub.dispose();
                cancelSub.dispose();
                resolve(closed.exitStatus?.code ?? -1);
            });
            const cancelSub = cancelToken.onCancellationRequested(() => {
                closeSub.dispose();
                cancelSub.dispose();
                terminal.dispose(); // Kill the login so it can't overwrite credentials later
                resolve(undefined);
            });
        })
    );
}

/**
 * Handle Add New Account command
 * Saves the current account, runs `claude auth login`, identifies the new
 * account (claude auth status, falling back to .claude.json), then registers it
 * Every step is logged to the "CC Account Switcher" output panel
 */
async function handleAddNewAccount(): Promise<void> {
    const proceed = await vscode.window.showInformationMessage(
        'Add a new Claude Code account',
        {
            modal: true,
            detail:
                'A terminal will run `claude auth login`. Finish the sign-in in your browser with the NEW account. ' +
                'If the browser is already signed in to claude.ai with your current account, sign out there or use a private window first.\n\n' +
                'Your current account\'s latest credentials are saved first, so you can switch back to it afterwards.'
        },
        'Continue'
    );

    if (proceed !== 'Continue') {
        return; // User cancelled
    }

    const previousActiveId = getActiveAccountId();
    log(`Add new account: started (active account id: ${previousActiveId ?? 'none'})`);

    // Keep the current account's latest (possibly rotated) token before login replaces it
    backupActiveAccount();
    const previousToken = getCurrentRefreshToken();
    log('Add new account: current credentials backed up, launching `claude auth login`');

    const exitCode = await runLoginInTerminal();
    if (exitCode === undefined) {
        log('Add new account: cancelled by user, terminal killed');
        vscode.window.showInformationMessage('Add new account cancelled. Nothing was changed.');
        return;
    }

    const newToken = getCurrentRefreshToken();
    const tokenChanged = !!newToken && newToken !== previousToken;
    log(`Add new account: login exited with code ${exitCode}, credentials changed: ${tokenChanged}`);
    if (!tokenChanged) {
        vscode.window.showErrorMessage(
            `Login did not complete (exit code ${exitCode}). Credentials are unchanged; no account was added.`
        );
        return;
    }

    // From here on the live credentials belong to the freshly logged-in account
    const { identity, source } = await getCurrentIdentity();
    log(`Add new account: identity=${identity?.email ?? 'unknown'} (source: ${source})`);
    if (!identity?.email) {
        clearActiveAccount();
        updateStatusBar();
        vscode.window.showErrorMessage(
            'Login succeeded, but the account could not be identified. ' +
            'Use "Add current account" to save it manually.'
        );
        return;
    }

    const existing = findAccountByEmail(identity.email);
    if (existing) {
        // Same account signed in again: refresh its saved credentials instead of duplicating it
        const linkResult = await linkCurrentSession(existing.id, identity.email);
        log(`Add new account: ${identity.email} already registered as "${existing.label}"; ${linkResult.message}`);
        updateStatusBar();
        if (!linkResult.success) {
            vscode.window.showErrorMessage(linkResult.message);
            return;
        }
        vscode.window.showWarningMessage(
            `You signed in as ${identity.email}, which is already registered as "${existing.label}". ` +
            'Its saved credentials were refreshed. To add a different account, sign out of claude.ai in the browser and try again.'
        );
        if (existing.id !== previousActiveId) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return;
    }

    const label = await promptForLabel(`Logged in as ${identity.email}. Enter a label for this account`, identity.email);
    if (!label) {
        log('Add new account: label prompt dismissed; account not saved, active account cleared');
        clearActiveAccount();
        updateStatusBar();
        vscode.window.showWarningMessage(
            `Logged in as ${identity.email}, but it was not saved (status shows "Unknown"). ` +
            'Use "Add current account" to save it, or switch back to a saved account.'
        );
        return;
    }

    const result = await addAccount(label, identity);
    log(`Add new account: ${result.message}`);
    if (!result.success) {
        clearActiveAccount();
        updateStatusBar();
        vscode.window.showErrorMessage(result.message);
        return;
    }

    vscode.window.showInformationMessage(result.message);
    updateStatusBar();

    // Reload so the Claude Code extension in this window picks up the new credentials
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

/**
 * Handle Remove Account command
 * Shows Quick Pick to select account to remove
 */
async function handleRemoveAccount(): Promise<void> {
    const accounts = listAccounts();

    if (accounts.length === 0) {
        vscode.window.showInformationMessage('No accounts to remove.');
        return;
    }

    const loginStatus = getLoginStatus();
    const activeLabel = loginStatus.type === 'known' ? loginStatus.label : null;

    // Create Quick Pick items
    interface RemoveQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const items: RemoveQuickPickItem[] = accounts.map(acc => ({
        label: acc.label,
        description: acc.label === activeLabel ? '(Active - cannot remove)' : '',
        detail: `Added: ${new Date(acc.addedAt).toLocaleString()}`,
        accountId: acc.id
    }));

    // Show Quick Pick
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select account to remove'
    });

    if (!selected) {
        return; // User cancelled
    }

    // Confirm removal
    const confirm = await vscode.window.showWarningMessage(
        `Remove account "${selected.label}"? This will delete the backup credentials.`,
        { modal: true },
        'Remove'
    );

    if (confirm !== 'Remove') {
        return;
    }

    // Perform removal
    const result = await removeAccount(selected.accountId);

    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}

/**
 * Handle List Accounts command
 * Shows information message with all managed accounts
 */
async function handleListAccounts(): Promise<void> {
    const accounts = listAccounts();

    if (accounts.length === 0) {
        vscode.window.showInformationMessage('No accounts managed yet.');
        return;
    }

    const loginStatus = getLoginStatus();
    const activeLabel = loginStatus.type === 'known' ? loginStatus.label : null;
    const accountList = accounts.map(acc => {
        const active = acc.label === activeLabel ? ' (Active)' : '';
        return `• ${acc.label}${active}`;
    }).join('\n');

    vscode.window.showInformationMessage(
        `Managed accounts:\n${accountList}`,
        { modal: false }
    );
}

/**
 * Handle Rename Account command
 * Shows Quick Pick to select account, then InputBox for new label
 */
async function handleRenameAccount(): Promise<void> {
    const accounts = listAccounts();

    if (accounts.length === 0) {
        vscode.window.showInformationMessage('No accounts to rename.');
        return;
    }

    interface RenameQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const selected = await vscode.window.showQuickPick(
        accounts.map(acc => ({
            label: acc.label,
            detail: `Added: ${new Date(acc.addedAt).toLocaleString()}`,
            accountId: acc.id
        } as RenameQuickPickItem)),
        { placeHolder: 'Select account to rename' }
    );

    if (!selected) {
        return;
    }

    const newLabel = await vscode.window.showInputBox({
        prompt: `Enter new label for "${selected.label}"`,
        value: selected.label,
        validateInput: (value) => {
            if (!value?.trim()) { return 'Label cannot be empty'; }
            if (value.trim() === selected.label) { return 'Same as current label'; }
            if (listAccounts().some(a => a.label === value.trim())) { return 'Label already exists'; }
            return null;
        }
    });

    if (!newLabel) {
        return;
    }

    const result = renameAccount(selected.accountId, newLabel.trim());
    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}

/**
 * Handle Link Current Session command
 * Shows Quick Pick to select which registered account the current session belongs to
 */
async function handleLinkSession(): Promise<void> {
    const accounts = listAccounts();

    if (accounts.length === 0) {
        vscode.window.showInformationMessage('No accounts registered. Add an account first.');
        return;
    }

    interface LinkQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const selected = await vscode.window.showQuickPick(
        accounts.map(acc => ({
            label: acc.label,
            detail: `Added: ${new Date(acc.addedAt).toLocaleString()}`,
            accountId: acc.id
        } as LinkQuickPickItem)),
        { placeHolder: 'Which account does the current session belong to?' }
    );

    if (!selected) {
        return;
    }

    const result = await linkCurrentSession(selected.accountId);
    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}
