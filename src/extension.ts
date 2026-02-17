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
    getActiveAccountLabel
} from './accountManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('CC Account Switcher extension is now active');

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
    const activeLabel = await getActiveAccountLabel();

    // Create Quick Pick items
    interface AccountQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const items: AccountQuickPickItem[] = accounts.map(acc => ({
        label: acc.label,
        description: acc.id === activeId ? '● Active' : '',
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

    // Set active item (highlighted/focused item)
    const activeItem = items.find(item => item.label === activeLabel);
    if (activeItem) {
        quickPick.activeItems = [activeItem];
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

            if (item.label === activeLabel) {
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
        'This will save your currently logged-in Claude Code account. Make sure you have logged in to the correct account via `claude login` before proceeding.',
        { modal: true },
        'Continue',
        'Cancel'
    );

    if (proceed !== 'Continue') {
        return; // User cancelled
    }

    // Prompt user for account label
    const label = await vscode.window.showInputBox({
        prompt: 'Enter a label for your currently logged-in account',
        placeHolder: 'e.g., "proton", "gmail", "work"',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Label cannot be empty';
            }
            // Check if label already exists
            const accounts = listAccounts();
            if (accounts.some(acc => acc.label === value.trim())) {
                return 'This label already exists';
            }
            return null;
        }
    });

    if (!label) {
        return; // User cancelled
    }

    const result = await addAccount(label.trim());

    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
}

/**
 * Handle Add New Account command
 * Guides user to switch accounts first, then saves the new account
 */
async function handleAddNewAccount(): Promise<void> {
    // Step 1: Instruct user to switch accounts
    const proceed = await vscode.window.showInformationMessage(
        'To add a new account:\n\n' +
        '1. Log out and login to the new account via `claude logout && claude login`, OR\n' +
        '2. Use VSCode\'s built-in account switcher to switch to a different Claude account\n\n' +
        'Click "Continue" after you have switched to the new account.',
        { modal: true },
        'Continue',
        'Cancel'
    );

    if (proceed !== 'Continue') {
        return; // User cancelled
    }

    // Step 2: Reuse the label input and account saving logic
    const label = await vscode.window.showInputBox({
        prompt: 'Enter a label for the new account you just switched to',
        placeHolder: 'e.g., "proton", "gmail", "work"',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Label cannot be empty';
            }
            // Check if label already exists
            const accounts = listAccounts();
            if (accounts.some(acc => acc.label === value.trim())) {
                return 'This label already exists';
            }
            return null;
        }
    });

    if (!label) {
        return; // User cancelled
    }

    const result = await addAccount(label.trim());

    if (result.success) {
        vscode.window.showInformationMessage(result.message);
        updateStatusBar();
    } else {
        vscode.window.showErrorMessage(result.message);
    }
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

    const currentLabel = await getActiveAccountLabel();

    // Create Quick Pick items
    interface RemoveQuickPickItem extends vscode.QuickPickItem {
        accountId: number;
    }

    const items: RemoveQuickPickItem[] = accounts.map(acc => ({
        label: acc.label,
        description: acc.label === currentLabel ? '(Active - cannot remove)' : '',
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

    const currentLabel = await getActiveAccountLabel();
    const accountList = accounts.map(acc => {
        const active = acc.label === currentLabel ? ' (Active)' : '';
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
