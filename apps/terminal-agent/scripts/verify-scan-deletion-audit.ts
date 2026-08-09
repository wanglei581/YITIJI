import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { sweepUnclaimedDir, UNCLAIMED_MAX_AGE_MS } from '../src/agent/scan-watcher'
import {
  getScanDeletionAudits,
  openDatabase,
  type AgentDatabase,
} from '../src/agent/db'

function backdate(filePath: string): void {
  const stale = new Date(Date.now() - UNCLAIMED_MAX_AGE_MS - 60_000)
  utimesSync(filePath, stale, stale)
}

function createStaleScan(root: string, filename: string, content: string): string {
  const dir = join(root, '_unclaimed')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, content)
  backdate(filePath)
  return filePath
}

function openLegacyDatabase(programData: string): AgentDatabase {
  const dbDir = join(programData, 'AIJobPrintAgent')
  mkdirSync(dbDir, { recursive: true })
  const legacy = new Database(join(dbDir, 'agent.db'))
  legacy.exec(`
    CREATE TABLE print_tasks (
      taskId TEXT PRIMARY KEY, status TEXT NOT NULL, completedAt TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE pending_patches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, status TEXT NOT NULL,
      errorCode TEXT, errorMessage TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT NOT NULL, createdAt TEXT NOT NULL
    );
  `)
  legacy.close()
  return openDatabase()
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'scan-deletion-audit-verify-'))
  const previousProgramData = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root

  try {
    let db = openLegacyDatabase(root)
    assert.ok(db, 'legacy SQLite must open and upgrade')
    const columns = db.prepare('PRAGMA table_info(scan_deletion_audit)').all()
      .map((row) => row['name'])
    for (const column of [
      'eventId',
      'reasonCode',
      'identifierHash',
      'createdAt',
      'deletedAt',
      'result',
      'attempts',
      'lastAttemptAt',
      'lastErrorCode',
      'pendingReport',
    ]) {
      assert.ok(columns.includes(column), `legacy DB upgrade must add ${column}`)
    }

    const successRoot = join(root, 'success-scan-folder')
    const piiFilename = '张三-身份证扫描件.pdf'
    const secretContent = 'ID-CARD-NUMBER-MUST-NEVER-ENTER-AUDIT'
    const successPath = createStaleScan(successRoot, piiFilename, secretContent)
    const successStat = statSync(successPath)
    const unsaltedIdentifier = createHash('sha256')
      .update(
        `unclaimed-scan-v1\0${resolve(successPath)}\0${successStat.size}\0${successStat.mtimeMs}`,
      )
      .digest('hex')
    sweepUnclaimedDir(successRoot, db)
    assert.equal(existsSync(successPath), false, 'audit must not block expired-file deletion')

    let audits = getScanDeletionAudits(db)
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.reasonCode, 'UNCLAIMED_TTL_EXPIRED')
    assert.equal(audits[0]?.result, 'deleted')
    assert.equal(audits[0]?.attempts, 1)
    assert.ok(audits[0]?.deletedAt)
    assert.equal(audits[0]?.pendingReport, true)
    const serializedAudit = JSON.stringify(audits)
    assert.doesNotMatch(serializedAudit, /张三|身份证扫描件|ID-CARD-NUMBER/)
    assert.match(audits[0]?.identifierHash ?? '', /^[a-f0-9]{64}$/)
    assert.match(audits[0]?.eventId ?? '', /^[a-f0-9]{64}$/)
    assert.notEqual(
      audits[0]?.identifierHash,
      unsaltedIdentifier,
      'ledger identifier must be keyed HMAC, not reproducible plain SHA-256',
    )

    const retryRoot = join(root, 'retry-scan-folder')
    const retryPath = createStaleScan(retryRoot, 'delete-failure.pdf', 'sensitive retry bytes')
    sweepUnclaimedDir(retryRoot, db, {
      unlinkFile: () => {
        const failure = new Error('simulated path-bearing delete failure') as NodeJS.ErrnoException
        failure.code = 'EACCES'
        throw failure
      },
    })
    assert.equal(existsSync(retryPath), true, 'failed deletion must leave file for retry')
    audits = getScanDeletionAudits(db)
    const failed = audits.find((row) => row.result === 'delete_failed')
    assert.ok(failed, 'delete failure must be durably observable')
    assert.equal(failed.lastErrorCode, 'EACCES')
    assert.equal(failed.attempts, 1)
    assert.doesNotMatch(JSON.stringify(failed), /simulated path-bearing|delete-failure\.pdf/)

    db.close()
    db = openDatabase()
    assert.ok(db, 'audit ledger must survive Agent restart')
    sweepUnclaimedDir(retryRoot, db)
    assert.equal(existsSync(retryPath), false, 'restart sweep must retry deletion')
    audits = getScanDeletionAudits(db)
    const retried = audits.find((row) => row.eventId === failed.eventId)
    assert.equal(retried?.result, 'deleted')
    assert.equal(retried?.attempts, 2)
    assert.ok(retried?.deletedAt)

    const crossInstallRoot = join(root, 'cross-install-scan-folder')
    const crossInstallPath = createStaleScan(
      crossInstallRoot,
      'same-file-across-installs.pdf',
      'same bytes and metadata for HMAC isolation',
    )
    const keepFile = () => {
      throw Object.assign(new Error('keep for second install'), { code: 'EACCES' })
    }
    sweepUnclaimedDir(crossInstallRoot, db, { unlinkFile: keepFile })
    const firstInstallAudit = getScanDeletionAudits(db).find(
      (row) => row.result === 'delete_failed' && row.eventId !== failed.eventId,
    )
    assert.ok(firstInstallAudit)
    db.close()

    const secondProgramData = join(root, 'second-install-program-data')
    process.env['PROGRAMDATA'] = secondProgramData
    db = openDatabase()
    assert.ok(db, 'second install DB must initialize independently')
    sweepUnclaimedDir(crossInstallRoot, db, { unlinkFile: keepFile })
    const secondInstallAudit = getScanDeletionAudits(db)[0]
    assert.ok(secondInstallAudit)
    assert.notEqual(
      secondInstallAudit.identifierHash,
      firstInstallAudit.identifierHash,
      'different install databases must produce unlinkable HMAC identifiers for the same file',
    )
    assert.notEqual(secondInstallAudit.eventId, firstInstallAudit.eventId)
    assert.equal(existsSync(crossInstallPath), true)

    const noAuditRoot = join(root, 'no-audit-scan-folder')
    const noAuditPath = createStaleScan(noAuditRoot, 'db-unavailable.pdf', 'must still delete')
    sweepUnclaimedDir(noAuditRoot, null)
    assert.equal(
      existsSync(noAuditPath),
      false,
      'audit DB unavailability must never block expiry deletion',
    )

    const brokenAuditRoot = join(root, 'broken-audit-scan-folder')
    const brokenAuditPath = createStaleScan(
      brokenAuditRoot,
      'audit-write-failure.pdf',
      'must still delete after audit write throws',
    )
    const throwingAuditDb = {
      exec() { return this },
      close() {},
      prepare() { throw Object.assign(new Error('must not enter durable logs'), { code: 'SQLITE_IOERR' }) },
    } as unknown as AgentDatabase
    sweepUnclaimedDir(brokenAuditRoot, throwingAuditDb)
    assert.equal(
      existsSync(brokenAuditPath),
      false,
      'an audit write exception must be observable but must not block expiry deletion',
    )

    db.close()
    console.log('verify-scan-deletion-audit: all assertions passed')
  } finally {
    if (previousProgramData === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previousProgramData
    rmSync(root, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
