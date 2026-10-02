/**
 * Account Manager
 *
 * Responsibilities:
 * - Add current account to registry
 * - Switch between accounts
 * - Remove account from registry
 * - List all managed accounts
 */

import * as fs from 'fs';
import {
    readCredentials,
    writeCredentials,
    readClaudeConfig,
    isLoggedIn,
    AuthStatus,
    OAuthAccount
} from './authFiles';
import {
    AccountInfo,
    readRegistry,
    writeRegistry,
    saveCredentialsBackup,
    saveConfigBackup,
    loadCredentialsBackup,
    loadConfigBackup,
    deleteAccountBackups,
    findAccountByLabel,
    findAccountById,
    getCredentialBackupPath,
    getConfigBackupPath
} from './storage';

export interface AddAccountResult {
    success: boolean;
    message: string;
    accountInfo?: AccountInfo;
}

export interface SwitchAccountResult {
    success: boolean;
    message: string;
}

export interface RemoveAccountResult {
    success: boolean;
    message: string;
}

/**
 * Add current logged-in account to registry with user-provided label
 * Backs up credentials and config for later switching
 * @param identity Result of `claude auth status`, if available; its email is stored with the account
 */
export async function addAccount(label: string, identity?: AuthStatus): Promise<AddAccountResult> {
    try {
        // Check if logged in
        if (!isLoggedIn()) {
            return {
                success: false,
                message: 'Not logged into Claude Code. Please login first.'
            };
        }

        // Check if label already exists
        const existing = findAccountByLabel(label);
        if (existing) {
            return {
                success: false,
                message: `Account with label "${label}" already exists.`
            };
        }

        // Read current credentials and config
        const credentials = readCredentials();
        const config = readClaudeConfig();
        const oauthAccount = config.oauthAccount;

        // Get registry and assign new ID
        const registry = readRegistry();
        const newId = registry.nextId;
        const accountInfo: AccountInfo = {
            id: newId,
            label: label,
            uuid: identity?.email && oauthAccount?.emailAddress !== identity.email
                ? undefined // claude.json describes another account; don't record its uuid
                : (oauthAccount?.accountUuid ?? oauthAccount?.id),
            email: identity?.email,
            addedAt: new Date().toISOString()
        };

        // The local claude.json can describe a different account than the fresh login;
        // when the CLI reported the real identity, don't back up a mismatched oauthAccount
        let configToSave: OAuthAccount | undefined = oauthAccount;
        if (identity?.email && oauthAccount?.emailAddress !== identity.email) {
            configToSave = { emailAddress: identity.email, organizationUuid: identity.orgId };
        }

        // Save backups
        saveCredentialsBackup(newId, label, credentials);
        if (configToSave) {
            saveConfigBackup(newId, label, configToSave);
        }

        // Update registry
        registry.accounts.push(accountInfo);
        registry.nextId = newId + 1;
        registry.activeAccountId = newId; // Set as active
        writeRegistry(registry);

        return {
            success: true,
            message: `Successfully added account: ${label}`,
            accountInfo
        };

    } catch (error) {
        return {
            success: false,
            message: `Failed to add account: ${error}`
        };
    }
}

/**
 * Switch to a different account
 * Backs up current account (if managed) and restores target account
 */
export async function switchAccount(targetAccountId: number): Promise<SwitchAccountResult> {
    try {
        const registry = readRegistry();

        // Find target account
        const targetAccount = findAccountById(targetAccountId);
        if (!targetAccount) {
            return {
                success: false,
                message: `Target account not found (ID: ${targetAccountId})`
            };
        }

        backupActiveAccount();

        // Load target account backups
        const targetCred = loadCredentialsBackup(targetAccount.id, targetAccount.label);

        // Write target account to auth files
        // Only credentials are swapped: .claude.json is not written (it races with running
        // Claude Code processes, which refresh oauthAccount from the new token themselves)
        writeCredentials(targetCred);

        // Update active account in registry
        registry.activeAccountId = targetAccountId;
        writeRegistry(registry);

        return {
            success: true,
            message: `Switched to account: ${targetAccount.label}`
        };

    } catch (error) {
        return {
            success: false,
            message: `Failed to switch account: ${error}`
        };
    }
}

/**
 * Save the live credentials into the active account's backup
 * Uses activeAccountId (reliable even after token rotation), so the latest
 * rotated refresh token is kept before the live credentials get replaced
 */
export function backupActiveAccount(): void {
    const registry = readRegistry();
    if (registry.activeAccountId === null) {
        return;
    }
    const currentAccount = findAccountById(registry.activeAccountId);
    if (!currentAccount) {
        return;
    }
    try {
        const currentCred = readCredentials();
        const currentConfig = readClaudeConfig();
        saveCredentialsBackup(currentAccount.id, currentAccount.label, currentCred);
        // Right after a switch, Claude Code may not have refreshed oauthAccount yet;
        // only save it when it matches this account's known email
        const knownEmail = getAccountEmail(currentAccount);
        const oauthAccount = currentConfig.oauthAccount;
        if (oauthAccount && (!knownEmail || oauthAccount.emailAddress?.toLowerCase() === knownEmail.toLowerCase())) {
            saveConfigBackup(currentAccount.id, currentAccount.label, oauthAccount);
        }
    } catch (error) {
        console.warn(`Warning: Could not backup current account: ${error}`);
    }
}

/**
 * Get the refresh token of the live credentials, if any
 * Used to detect that a login actually replaced the credentials
 */
export function getCurrentRefreshToken(): string | undefined {
    try {
        return readCredentials().claudeAiOauth?.refreshToken;
    } catch (error) {
        return undefined;
    }
}

/**
 * Mark no account as active
 * Used when the live credentials belong to an account that isn't registered
 */
export function clearActiveAccount(): void {
    const registry = readRegistry();
    registry.activeAccountId = null;
    writeRegistry(registry);
}

/**
 * Get the email of a registered account
 * Older entries have no stored email; fall back to their config backup
 */
export function getAccountEmail(account: AccountInfo): string | undefined {
    if (account.email) {
        return account.email;
    }
    try {
        return loadConfigBackup(account.id, account.label).emailAddress;
    } catch (error) {
        return undefined;
    }
}

/**
 * Find a registered account by email (case-insensitive)
 */
export function findAccountByEmail(email: string): AccountInfo | null {
    const target = email.toLowerCase();
    const account = readRegistry().accounts.find(acc => getAccountEmail(acc)?.toLowerCase() === target);
    return account || null;
}

/**
 * Remove an account from registry
 * Deletes backups and registry entry
 */
export async function removeAccount(accountId: number): Promise<RemoveAccountResult> {
    try {
        const registry = readRegistry();

        // Find account
        const account = findAccountById(accountId);
        if (!account) {
            return {
                success: false,
                message: `Account not found (ID: ${accountId})`
            };
        }

        // Check if it's the currently active account
        if (registry.activeAccountId === accountId) {
            return {
                success: false,
                message: `Cannot remove currently active account: ${account.label}`
            };
        }

        // Delete backups
        deleteAccountBackups(account.id, account.label);

        // Remove from registry
        registry.accounts = registry.accounts.filter(acc => acc.id !== accountId);

        // Clear activeAccountId if it was the removed account
        if (registry.activeAccountId === accountId) {
            registry.activeAccountId = null;
        }

        writeRegistry(registry);

        return {
            success: true,
            message: `Removed account: ${account.label}`
        };

    } catch (error) {
        return {
            success: false,
            message: `Failed to remove account: ${error}`
        };
    }
}

/**
 * List all managed accounts
 * Returns array of account info with active account marked
 */
export function listAccounts(): AccountInfo[] {
    const registry = readRegistry();
    return registry.accounts;
}

/**
 * Get current active account ID from registry
 * Returns null if no active account
 */
export function getActiveAccountId(): number | null {
    const registry = readRegistry();
    return registry.activeAccountId;
}


/**
 * Login status for the current session
 */
export type LoginStatus =
    | { type: 'no_account' }
    | { type: 'unknown' }
    | { type: 'known'; label: string }

/**
 * Get the login status of the current session
 * - 'no_account': not logged in (credentials file missing or empty)
 * - 'unknown': logged in but not registered in the switcher
 * - 'known': logged in and registered, with matching label
 */
export function getLoginStatus(): LoginStatus {
    if (!isLoggedIn()) {
        return { type: 'no_account' };
    }
    const activeId = getActiveAccountId();
    if (activeId !== null) {
        const account = findAccountById(activeId);
        if (account) {
            return { type: 'known', label: account.label };
        }
    }
    return { type: 'unknown' };
}

export interface RenameAccountResult {
    success: boolean;
    message: string;
}

/**
 * Rename an account in the registry
 * Also renames the backup files to match the new label
 */
export function renameAccount(accountId: number, newLabel: string): RenameAccountResult {
    try {
        const registry = readRegistry();

        // Find the account
        const account = registry.accounts.find(acc => acc.id === accountId);
        if (!account) {
            return { success: false, message: `Account not found (ID: ${accountId})` };
        }

        const oldLabel = account.label;

        // Check new label doesn't conflict with other accounts
        const conflict = registry.accounts.find(acc => acc.id !== accountId && acc.label === newLabel);
        if (conflict) {
            return { success: false, message: `Label "${newLabel}" is already used by another account.` };
        }

        // Rename backup files
        const oldCredPath = getCredentialBackupPath(accountId, oldLabel);
        const newCredPath = getCredentialBackupPath(accountId, newLabel);
        const oldConfigPath = getConfigBackupPath(accountId, oldLabel);
        const newConfigPath = getConfigBackupPath(accountId, newLabel);

        if (fs.existsSync(oldCredPath)) {
            fs.renameSync(oldCredPath, newCredPath);
        }
        if (fs.existsSync(oldConfigPath)) {
            fs.renameSync(oldConfigPath, newConfigPath);
        }

        // Update registry
        account.label = newLabel;
        writeRegistry(registry);

        return { success: true, message: `Renamed account "${oldLabel}" to "${newLabel}"` };

    } catch (error) {
        return { success: false, message: `Failed to rename account: ${error}` };
    }
}

export interface LinkSessionResult {
    success: boolean;
    message: string;
}

/**
 * Link the current session's credentials to an existing registered account
 * Overwrites the account's backup with the current credentials
 * Useful when tokens have rotated and the account shows as "Unknown"
 */
export async function linkCurrentSession(accountId: number, email?: string): Promise<LinkSessionResult> {
    try {
        if (!isLoggedIn()) {
            return { success: false, message: 'Not logged into Claude Code. Please login first.' };
        }

        const account = findAccountById(accountId);
        if (!account) {
            return { success: false, message: `Account not found (ID: ${accountId})` };
        }

        // Read current credentials and config
        const credentials = readCredentials();
        const config = readClaudeConfig();
        const oauthAccount = config.oauthAccount;

        if (!oauthAccount) {
            return { success: false, message: 'No oauthAccount found in Claude config.' };
        }

        // Overwrite backup with current credentials
        saveCredentialsBackup(account.id, account.label, credentials);
        saveConfigBackup(account.id, account.label, oauthAccount);

        // Update active account in registry (and remember the verified email)
        const registry = readRegistry();
        registry.activeAccountId = accountId;
        if (email) {
            const entry = registry.accounts.find(acc => acc.id === accountId);
            if (entry) {
                entry.email = email;
            }
        }
        writeRegistry(registry);

        return { success: true, message: `Linked current session to account: ${account.label}` };

    } catch (error) {
        return { success: false, message: `Failed to link session: ${error}` };
    }
}
