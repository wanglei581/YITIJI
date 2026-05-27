/**
 * agent/dpapi.ts — Phase 8.1C
 *
 * Secure storage for agentToken using Windows DPAPI (LocalMachine scope).
 *
 * On non-Windows (macOS/Linux dev environment): falls back to plaintext storage
 * with a warning — NEVER use this fallback in production.
 *
 * Design:
 *   - Token passed via stdin to the PowerShell process (not via command-line args)
 *     to prevent it from appearing in process listings or shell history.
 *   - LocalMachine scope: any process running as the same machine account
 *     (including SYSTEM, LocalService, NetworkService service accounts) can decrypt.
 *   - Encrypted bytes are stored as base64 in agent.token file.
 *
 * File paths:
 *   Windows: %ProgramData%\AIJobPrintAgent\agent.token
 *   macOS:   $TMPDIR/AIJobPrintAgent/agent.token  (plaintext fallback)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import { log, warn, err } from '../logger'

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDataDir(): string {
  return process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
}

function getTokenPath(): string {
  return path.join(getDataDir(), 'agent.token')
}

// ── Windows DPAPI via PowerShell (stdin-based, no inline token in args) ───────

/**
 * PowerShell script for encryption.
 * Reads the plaintext token from stdin → DPAPI Protect → base64 output.
 */
const PS_PROTECT = [
  'Add-Type -AssemblyName System.Security',
  '$token = [Console]::In.ReadLine()',
  '$bytes = [System.Text.Encoding]::UTF8.GetBytes($token)',
  '$encrypted = [System.Security.Cryptography.ProtectedData]::Protect(',
  '  $bytes, $null,',
  '  [System.Security.Cryptography.DataProtectionScope]::LocalMachine',
  ')',
  'Write-Output ([Convert]::ToBase64String($encrypted))',
].join('; ')

/**
 * PowerShell script for decryption.
 * Reads base64 ciphertext from stdin → DPAPI Unprotect → UTF-8 token output.
 */
const PS_UNPROTECT = [
  'Add-Type -AssemblyName System.Security',
  '$b64 = [Console]::In.ReadLine()',
  '$encrypted = [Convert]::FromBase64String($b64)',
  '$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(',
  '  $encrypted, $null,',
  '  [System.Security.Cryptography.DataProtectionScope]::LocalMachine',
  ')',
  'Write-Output ([System.Text.Encoding]::UTF8.GetString($decrypted))',
].join('; ')

function psEncrypt(token: string): string {
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', PS_PROTECT],
    { input: token, encoding: 'utf8', timeout: 10_000 },
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      `DPAPI encrypt failed: ${result.error?.message ?? (result.stderr as string | null)?.trim() ?? 'unknown'}`,
    )
  }
  return (result.stdout as string).trim()
}

function psDecrypt(b64: string): string {
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-Command', PS_UNPROTECT],
    { input: b64, encoding: 'utf8', timeout: 10_000 },
  )
  if (result.error || result.status !== 0) {
    throw new Error(
      `DPAPI decrypt failed: ${result.error?.message ?? (result.stderr as string | null)?.trim() ?? 'unknown'}`,
    )
  }
  return (result.stdout as string).trim()
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt and persist agentToken to disk.
 *
 * Windows: DPAPI LocalMachine scope → base64 ciphertext written to agent.token.
 * Non-Windows (dev): plaintext fallback with a log warning.
 */
export function saveAgentToken(token: string): void {
  const tokenPath = getTokenPath()
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true })

  if (process.platform !== 'win32') {
    warn('dpapi: 非 Windows 环境，agentToken 以明文存储（仅用于开发，切勿用于生产）')
    fs.writeFileSync(tokenPath, token, 'utf-8')
    return
  }

  try {
    const encrypted = psEncrypt(token)
    fs.writeFileSync(tokenPath, encrypted, 'utf-8')
    log(`dpapi: agentToken 已加密存储 → ${tokenPath}`)
  } catch (e) {
    err(`dpapi: DPAPI 加密失败，回退到明文存储 — ${e instanceof Error ? e.message : String(e)}`)
    fs.writeFileSync(tokenPath, token, 'utf-8')
  }
}

/**
 * Load and decrypt agentToken from disk.
 *
 * Returns the plaintext token string, or null if the file does not exist.
 * Throws if decryption fails (corrupted file or key unavailable on this machine).
 */
export function loadAgentToken(): string | null {
  const tokenPath = getTokenPath()
  if (!fs.existsSync(tokenPath)) {
    return null
  }

  const stored = fs.readFileSync(tokenPath, 'utf-8').trim()
  if (!stored) return null

  if (process.platform !== 'win32') {
    // Plaintext fallback for dev environments
    return stored
  }

  try {
    return psDecrypt(stored)
  } catch (e) {
    throw new Error(
      `dpapi: agentToken 解密失败 — ${e instanceof Error ? e.message : String(e)}。` +
        '请删除 agent.token 文件并清空 config.json 中的 terminalId 后重新注册。',
    )
  }
}
