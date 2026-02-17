/**
 * Storage Module
 *
 * Responsibilities:
 * - Manage backup directory structure (.cc-switcher/)
 * - Account registry (accounts.json) management
 * - Credential backup/restore
 * - Config backup/restore
 */

import * as fs from 'fs';
import * as path from 'path';
import { getClaudeConfigDir, Credentials, OAuthAccount } from './authFiles';

export interface AccountInfo {
    id: number;
    label: string;  // User-provided label (e.g., "proton", "gmail", "work")
    uuid?: string;
    addedAt: string;
}

export interface AccountRegistry {
    accounts: AccountInfo[];
    activeAccountId: number | null;
    nextId: number;
}

/**
 * Get path to .cc-switcher directory
 */
export function getSwitcherDir(): string {
    return path.join(getClaudeConfigDir(), '.cc-switcher');
}

/**
 * Get path to accounts.json registry file
 */
export function getRegistryPath(): string {
    return path.join(getSwitcherDir(), 'accounts.json');
}

/**
 * Get path to credentials backup directory
 */
export function getCredentialsBackupDir(): string {
    return path.join(getSwitcherDir(), 'credentials');
}

/**
 * Get path to configs backup directory
 */
export function getConfigsBackupDir(): string {
    return path.join(getSwitcherDir(), 'configs');
}

/**
 * Get path to credential backup file for an account
 */
export function getCredentialBackupPath(accountId: number, label: string): string {
    return path.join(getCredentialsBackupDir(), `${accountId}-${label}.json`);
}

/**
 * Get path to config backup file for an account
 */
export function getConfigBackupPath(accountId: number, label: string): string {
    return path.join(getConfigsBackupDir(), `${accountId}-${label}.json`);
}

/**
 * Initialize storage directories if they don't exist
 * Creates .cc-switcher/, credentials/, configs/ with proper permissions
 */
export function initializeStorage(): void {
    const switcherDir = getSwitcherDir();
    const credDir = getCredentialsBackupDir();
    const configDir = getConfigsBackupDir();

    // Create directories with 0o700 (owner rwx only)
    if (!fs.existsSync(switcherDir)) {
        fs.mkdirSync(switcherDir, { mode: 0o700, recursive: true });
    }
    if (!fs.existsSync(credDir)) {
        fs.mkdirSync(credDir, { mode: 0o700, recursive: true });
    }
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { mode: 0o700, recursive: true });
    }
}

/**
 * Read account registry from accounts.json
 * Returns empty registry if file doesn't exist
 */
export function readRegistry(): AccountRegistry {
    const registryPath = getRegistryPath();

    if (!fs.existsSync(registryPath)) {
        return {
            accounts: [],
            activeAccountId: null,
            nextId: 1
        };
    }

    try {
        const content = fs.readFileSync(registryPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to read account registry: ${error}`);
    }
}

/**
 * Write account registry to accounts.json
 */
export function writeRegistry(registry: AccountRegistry): void {
    initializeStorage(); // Ensure directory exists

    const registryPath = getRegistryPath();
    const content = JSON.stringify(registry, null, 2);

    fs.writeFileSync(registryPath, content, { mode: 0o600 });
}

/**
 * Save credentials backup for an account
 */
export function saveCredentialsBackup(accountId: number, label: string, credentials: Credentials): void {
    initializeStorage();

    const backupPath = getCredentialBackupPath(accountId, label);
    const content = JSON.stringify(credentials, null, 2);

    fs.writeFileSync(backupPath, content, { mode: 0o600 });
}

/**
 * Save config backup for an account
 */
export function saveConfigBackup(accountId: number, label: string, oauthAccount: OAuthAccount): void {
    initializeStorage();

    const backupPath = getConfigBackupPath(accountId, label);
    const content = JSON.stringify(oauthAccount, null, 2);

    fs.writeFileSync(backupPath, content, { mode: 0o600 });
}

/**
 * Load credentials backup for an account
 * @throws Error if backup doesn't exist or is invalid
 */
export function loadCredentialsBackup(accountId: number, label: string): Credentials {
    const backupPath = getCredentialBackupPath(accountId, label);

    if (!fs.existsSync(backupPath)) {
        throw new Error(`Credentials backup not found for account: ${label}`);
    }

    try {
        const content = fs.readFileSync(backupPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to load credentials backup for ${label}: ${error}`);
    }
}

/**
 * Load config backup for an account
 * @throws Error if backup doesn't exist or is invalid
 */
export function loadConfigBackup(accountId: number, label: string): OAuthAccount {
    const backupPath = getConfigBackupPath(accountId, label);

    if (!fs.existsSync(backupPath)) {
        throw new Error(`Config backup not found for account: ${label}`);
    }

    try {
        const content = fs.readFileSync(backupPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to load config backup for ${label}: ${error}`);
    }
}

/**
 * Delete backups for an account
 */
export function deleteAccountBackups(accountId: number, label: string): void {
    const credPath = getCredentialBackupPath(accountId, label);
    const configPath = getConfigBackupPath(accountId, label);

    if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
    }
    if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
    }
}

/**
 * Find account in registry by label
 * Returns null if not found
 */
export function findAccountByLabel(label: string): AccountInfo | null {
    const registry = readRegistry();
    const account = registry.accounts.find(acc => acc.label === label);
    return account || null;
}

/**
 * Find account in registry by ID
 * Returns null if not found
 */
export function findAccountById(id: number): AccountInfo | null {
    const registry = readRegistry();
    const account = registry.accounts.find(acc => acc.id === id);
    return account || null;
}
