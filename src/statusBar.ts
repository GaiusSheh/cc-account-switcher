/**
 * Status Bar Manager
 *
 * Responsibilities:
 * - Create and manage status bar item
 * - Display current account email
 * - Handle click events (show Quick Pick)
 * - Update status bar on account changes
 */

import * as vscode from 'vscode';
import { getLoginStatus } from './accountManager';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Create and initialize status bar item
 * @param context Extension context to register disposable
 */
export function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
    // Create status bar item (left side, priority 100)
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );

    // Set click command
    statusBarItem.command = 'cc-switcher.switchAccount';

    // Set tooltip
    statusBarItem.tooltip = 'Click to switch Claude Code account';

    // Register for disposal
    context.subscriptions.push(statusBarItem);

    // Initial update (async, but we don't need to wait)
    updateStatusBar().catch(console.error);

    // Show status bar
    statusBarItem.show();

    return statusBarItem;
}

/**
 * Update status bar text with current account label
 */
export async function updateStatusBar(): Promise<void> {
    if (!statusBarItem) {
        return;
    }

    const status = await getLoginStatus();

    if (status.type === 'known') {
        statusBarItem.text = `$(account) ${status.label}`;
    } else if (status.type === 'unknown') {
        statusBarItem.text = `$(account) Unknown`;
    } else {
        statusBarItem.text = `$(account) No Account`;
    }
}

/**
 * Get the status bar item instance
 */
export function getStatusBarItem(): vscode.StatusBarItem | undefined {
    return statusBarItem;
}

/**
 * Dispose status bar item
 */
export function disposeStatusBar(): void {
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = undefined;
    }
}
