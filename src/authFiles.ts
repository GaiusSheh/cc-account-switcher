/**
 * Authentication Files Handler
 *
 * Responsibilities:
 * - Read/write ~/.claude/.credentials.json
 * - Read ~/.claude.json (oauthAccount identity; never written)
 * - Query `claude auth status` for the logged-in identity
 * - Handle CLAUDE_CONFIG_DIR environment variable
 * - Set proper file permissions (0o600 for credentials)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

export interface OAuthCredentials {
    refreshToken?: string;
    accessToken?: string;
    expiresAt?: string;
    [key: string]: any;
}

export interface Credentials {
    claudeAiOauth?: OAuthCredentials;
    [key: string]: any;
}

export interface OAuthAccount {
    emailAddress?: string;
    accountUuid?: string;
    organizationUuid?: string;
    id?: string; // Legacy field name; Claude Code actually uses accountUuid
    [key: string]: any;
}

export interface ClaudeConfig {
    oauthAccount?: OAuthAccount;
    [key: string]: any;
}

/**
 * Get Claude configuration directory path
 * Respects CLAUDE_CONFIG_DIR environment variable
 */
export function getClaudeConfigDir(): string {
    const envDir = process.env.CLAUDE_CONFIG_DIR;
    if (envDir) {
        return envDir;
    }
    return path.join(os.homedir(), '.claude');
}

/**
 * Get path to .credentials.json
 */
export function getCredentialsPath(): string {
    return path.join(getClaudeConfigDir(), '.credentials.json');
}

/**
 * Get path to Claude Code's global config (.claude.json)
 * Default lives in the home directory, NOT inside ~/.claude/
 * (~/.claude/claude.json is a stale file only this extension used to write)
 * With CLAUDE_CONFIG_DIR set it lives inside that directory (per Claude Code docs; not verified locally)
 */
export function getClaudeConfigPath(): string {
    const envDir = process.env.CLAUDE_CONFIG_DIR;
    return path.join(envDir || os.homedir(), '.claude.json');
}

/**
 * Read credentials from .credentials.json
 * @throws Error if file doesn't exist or is invalid JSON
 */
export function readCredentials(): Credentials {
    const credPath = getCredentialsPath();
    if (!fs.existsSync(credPath)) {
        throw new Error(`Credentials file not found: ${credPath}`);
    }

    const content = fs.readFileSync(credPath, 'utf-8');
    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Invalid JSON in credentials file: ${credPath}`);
    }
}

/**
 * Write credentials to .credentials.json
 * Sets file permissions to 0o600 (owner read/write only)
 */
export function writeCredentials(credentials: Credentials): void {
    const credPath = getCredentialsPath();
    const content = JSON.stringify(credentials, null, 2);

    fs.writeFileSync(credPath, content, { mode: 0o600 });
}

/**
 * Read Claude config from .claude.json (read-only use)
 * Returns {} if the file is missing or unparsable — running Claude Code
 * processes rewrite this file constantly, so a read can catch it mid-write
 */
export function readClaudeConfig(): ClaudeConfig {
    const configPath = getClaudeConfigPath();
    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
        console.warn(`Warning: Could not read Claude config ${configPath}: ${error}`);
        return {};
    }
}

/**
 * Write Claude config to .claude.json
 * IMPORTANT: This merges the oauthAccount field only, preserving all other settings
 * @deprecated No longer called: writing the live .claude.json races with running
 * Claude Code processes, and Claude Code refreshes oauthAccount from the token itself
 */
export function writeClaudeConfig(oauthAccount: OAuthAccount): void {
    const configPath = getClaudeConfigPath();

    // Read existing config to preserve other settings
    let existingConfig: ClaudeConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            existingConfig = JSON.parse(content);
        } catch (error) {
            // If file is corrupted, start fresh but log warning
            console.warn(`Warning: Could not parse existing config, will overwrite: ${error}`);
        }
    }

    // Merge only the oauthAccount field
    existingConfig.oauthAccount = oauthAccount;

    const content = JSON.stringify(existingConfig, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
}

/**
 * Check if Claude Code is logged in
 * Returns true if credentials file exists and contains a refresh token
 */
export function isLoggedIn(): boolean {
    try {
        const credPath = getCredentialsPath();

        if (!fs.existsSync(credPath)) {
            return false;
        }

        const credentials = readCredentials();

        // Only check for refresh token (claude.json may be stale)
        return !!credentials.claudeAiOauth?.refreshToken;
    } catch (error) {
        return false;
    }
}

/**
 * Output of `claude auth status --json`
 */
export interface AuthStatus {
    loggedIn: boolean;
    email?: string;
    orgId?: string;
    orgName?: string;
    subscriptionType?: string;
    [key: string]: any;
}

/**
 * Ask the Claude CLI who is currently logged in
 * Returns null if the CLI is unavailable or its output cannot be parsed
 */
export function getAuthStatus(): Promise<AuthStatus | null> {
    return new Promise(resolve => {
        exec('claude auth status --json', { timeout: 20000, windowsHide: true }, (error, stdout) => {
            if (error) {
                console.warn(`Warning: claude auth status failed: ${error}`);
                resolve(null);
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (parseError) {
                console.warn(`Warning: Could not parse claude auth status output: ${stdout}`);
                resolve(null);
            }
        });
    });
}

/**
 * Identify the logged-in account
 * Prefers `claude auth status`; falls back to oauthAccount in .claude.json,
 * which `claude auth login` also updates
 */
export async function getCurrentIdentity(): Promise<{ identity: AuthStatus | null; source: string }> {
    const status = await getAuthStatus();
    if (status?.email) {
        return { identity: status, source: 'claude auth status' };
    }
    const oauthAccount = readClaudeConfig().oauthAccount;
    if (oauthAccount?.emailAddress) {
        return {
            identity: { loggedIn: true, email: oauthAccount.emailAddress, orgId: oauthAccount.organizationUuid },
            source: getClaudeConfigPath()
        };
    }
    return { identity: null, source: 'none' };
}
