import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const dir = mkdtempSync(path.join(tmpdir(), 'backup-ops-')); const bin = path.join(dir, 'bin'); mkdirSync(bin)
const log = path.join(dir, 'calls.log'); const envFile = path.join(dir, '.env'); const backupDir = path.join(dir, 'backups')
writeFileSync(envFile, 'DATABASE_URL="postgresql://user:secret@db/app"\nALERT_WEBHOOK_URL="https://wecom.invalid/hook"\n')
const stub = (name, body) => { const p = path.join(bin, name); writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755) }
stub('pg_dump', `echo "pg_dump:$*" >> "${log}"; [[ "\${STUB_FAIL:-}" != 1 ]] || exit 1; file=""; while [[ "$1" != "" ]]; do [[ "$1" == --file=* ]] && file="\${1#--file=}"; shift; done; printf 'dump' > "$file"`)
stub('pg_restore', `echo "pg_restore:$*" >> "${log}"; [[ "\${STUB_RESTORE_FAIL:-}" != 1 ]]`)
stub('curl', `echo "curl:$*" >> "${log}"; cat >/dev/null; [[ "\${STUB_CURL_FAIL:-}" != 1 ]]`)
stub('prisma', `echo "prisma:$* POSTGRES_URL=$POSTGRES_URL DATABASE_URL=$DATABASE_URL" >> "${log}"; exit 0`)
// 清掉运行环境里的连接串与 webhook（CI 的 job 环境就设了 DATABASE_URL）：否则「环境没有、从 .env 读」这条路径测不到
const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, API_ENV_FILE: envFile, BACKUP_DIR: backupDir, RETENTION_DAYS: '30', DATABASE_URL: '', POSTGRES_URL: '', ALERT_WEBHOOK_URL: '' }
const run = (script, args = [], extra = {}) => spawnSync('bash', [path.join(root, 'scripts', script), ...args], { env: { ...baseEnv, ...extra }, encoding: 'utf8' })
let result = run('backup-postgres.sh'); assert.equal(result.status, 0, result.stderr); const target = path.join(backupDir, `postgres_${new Date().toISOString().slice(0, 10)}.dump`); assert.ok(existsSync(target)); assert.ok(readFileSync(path.join(backupDir, 'LAST_SUCCESS'), 'utf8').includes(path.basename(target))); assert.match(readFileSync(log, 'utf8'), /pg_restore:-l/); assert.match(readFileSync(log, 'utf8'), /pg_dump:.*postgresql:\/\/user:secret@db\/app/, '环境没有连接串时应从 .env 读到并交给 pg_dump')
result = run('backup-postgres.sh', [], { STUB_FAIL: '1' }); assert.notEqual(result.status, 0); assert.ok(existsSync(target)); assert.ok(!existsSync(`${target}.partial`)); assert.equal((readFileSync(log, 'utf8').match(/curl:/g) ?? []).length, 1)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/production']); assert.notEqual(result.status, 0); assert.match(result.stderr, /must contain drill or verify/)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/backup-drill']); assert.equal(result.status, 0, result.stderr); assert.match(readFileSync(log, 'utf8'), /prisma:.*POSTGRES_URL=postgresql:\/\/u:p@db\/backup-drill DATABASE_URL=postgresql:\/\/u:p@db\/backup-drill/)
console.log('backup ops gates passed')
