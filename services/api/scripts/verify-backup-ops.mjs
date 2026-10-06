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
stub('rclone', `echo "rclone:$*" >> "${log}"; [[ "$1" != delete || "\${STUB_RCLONE_DELETE_FAIL:-}" != 1 ]]`)
stub('prisma', `echo "prisma:$* POSTGRES_URL=$POSTGRES_URL DATABASE_URL=$DATABASE_URL" >> "${log}"; exit 0`)
// 清掉运行环境里的连接串与 webhook（CI 的 job 环境就设了 DATABASE_URL）：否则「环境没有、从 .env 读」这条路径测不到
const baseEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, API_ENV_FILE: envFile, BACKUP_DIR: backupDir, RETENTION_DAYS: '30', DATABASE_URL: '', POSTGRES_URL: '', ALERT_WEBHOOK_URL: '' }
const run = (script, args = [], extra = {}) => spawnSync('bash', [path.join(root, 'scripts', script), ...args], { env: { ...baseEnv, ...extra }, encoding: 'utf8' })
let result = run('backup-postgres.sh'); assert.equal(result.status, 0, result.stderr); const target = path.join(backupDir, `postgres_${new Date().toISOString().slice(0, 10)}.dump`); assert.ok(existsSync(target)); assert.ok(readFileSync(path.join(backupDir, 'LAST_SUCCESS'), 'utf8').includes(path.basename(target))); assert.match(readFileSync(log, 'utf8'), /pg_restore:-l/); assert.match(readFileSync(log, 'utf8'), /pg_dump:.*postgresql:\/\/user:secret@db\/app/, '环境没有连接串时应从 .env 读到并交给 pg_dump')
result = run('backup-postgres.sh', [], { STUB_FAIL: '1' }); assert.notEqual(result.status, 0); assert.ok(existsSync(target)); assert.ok(!existsSync(`${target}.partial`)); assert.equal((readFileSync(log, 'utf8').match(/curl:/g) ?? []).length, 1)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/production']); assert.notEqual(result.status, 0); assert.match(result.stderr, /must contain drill or verify/)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/backup-drill']); assert.equal(result.status, 0, result.stderr); assert.match(readFileSync(log, 'utf8'), /prisma:.*POSTGRES_URL=postgresql:\/\/u:p@db\/backup-drill DATABASE_URL=postgresql:\/\/u:p@db\/backup-drill/)
// 异地上传：用同一个保留天数清理异地过期副本，只清本脚本写的文件。
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', RETENTION_DAYS: '30' }); assert.equal(result.status, 0, result.stderr)
let calls = readFileSync(log, 'utf8')
assert.match(calls, /rclone:copy .*postgres_\d{4}-\d{2}-\d{2}\.dump cos:zyd-backup\/postgres/)
assert.match(calls, /rclone:delete cos:zyd-backup\/postgres --min-age 30d --include postgres_\*\.dump/, '异地副本必须按同一保留天数清理')
assert.ok(calls.indexOf('rclone:copy') < calls.indexOf('rclone:delete'), '先上传再清理')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', RETENTION_DAYS: '7' }); assert.equal(result.status, 0, result.stderr)
assert.match(readFileSync(log, 'utf8'), /rclone:delete cos:zyd-backup\/postgres --min-age 7d /, '保留天数跟着配置走')
// 异地清理失败：今天的备份仍算成功，但要告警。
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', STUB_RCLONE_DELETE_FAIL: '1' })
assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /BACKUP_OK/); assert.match(result.stderr, /BACKUP_WARN: remote retention cleanup failed/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '异地清理失败要发告警')
// 不上传时不碰 rclone。
writeFileSync(log, '')
result = run('backup-postgres.sh'); assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(readFileSync(log, 'utf8'), /rclone:/)
// 保留天数写错：拒绝执行。
for (const bad of ['0', '-1', 'abc', '']) {
  result = run('backup-postgres.sh', [], { RETENTION_DAYS: bad })
  if (bad === '') { assert.equal(result.status, 0, '空值回落默认 30 天'); continue }
  assert.notEqual(result.status, 0, `RETENTION_DAYS=${bad} 应拒绝`); assert.match(result.stderr, /RETENTION_DAYS must be a positive integer/)
}
console.log('backup ops gates passed')
