import { readFileSync, closeSync, existsSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'



export let passed = 0

export let failed = 0

export function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed += 1
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed += 1
    if (process.env['VERIFY_FAIL_FAST'] === '1') process.exit(1)
  }
}


export function readSrc(relative: string): string {
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}


export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}


export function contractBody(source: string): string {
  return source.replace(/^\/\*\*[\s\S]*?\*\//, '').replace(/^\s+/, '')
}


export function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}


export function prepareIsolatedScreenDatabase(): { databasePath: string; cleanup: () => void } {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-console-screen-'))
  const databasePath = join(tempDirectory, 'verify.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  if (!existsSync(prismaCli)) {
    rmSync(tempDirectory, { recursive: true, force: true })
    throw new Error(`Missing Prisma CLI: ${prismaCli}`)
  }
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true })
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy failed: ${(err.stderr || err.stdout || err.message || 'unknown error').trim()}`)
  }
  return {
    databasePath,
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
}


export function assertSourceContractSetup(){

return {  }
}
