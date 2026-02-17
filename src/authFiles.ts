/**
 * Authentication Files Handler
 *
 * Responsibilities:
 * - Read/write ~/.claude/.credentials.json
 * - Read/write ~/.claude/.claude.json (merge oauthAccount only)
 * - Handle CLAUDE_CONFIG_DIR environment variable
 * - Set proper file permissions (0o600 for credentials)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    id?: string;
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
 * Get path to claude.json
 */
export function getClaudeConfigPath(): string {
    return path.join(getClaudeConfigDir(), 'claude.json');
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
 * Read Claude config from .claude.json
 * @throws Error if file doesn't exist or is invalid JSON
 */
export function readClaudeConfig(): ClaudeConfig {
    const configPath = getClaudeConfigPath();
    if (!fs.existsSync(configPath)) {
        throw new Error(`Claude config file not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Invalid JSON in Claude config file: ${configPath}`);
    }
}

/**
 * Write Claude config to .claude.json
 * IMPORTANT: This merges the oauthAccount field only, preserving all other settings
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
