import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, readdirSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repoRoot = path.resolve(root, '../..')
const dir = mkdtempSync(path.join(tmpdir(), 'backup-ops-'))
const bin = path.join(dir, 'bin')
mkdirSync(bin)
const log = path.join(dir, 'calls.log')
const envFile = path.join(dir, '.env')
const backupDir = path.join(dir, 'backups')
writeFileSync(envFile, 'DATABASE_URL="postgresql://user:secret@db/app"\nALERT_WEBHOOK_URL="https://wecom.invalid/hook"\n')
const stub = (name, body) => {
  const p = path.join(bin, name)
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
}
stub('pg_dump', `echo "pg_dump:$*" >> "${log}"; [[ "\${STUB_FAIL:-}" != 1 ]] || exit 1; file=""; while [[ "$1" != "" ]]; do [[ "$1" == --file=* ]] && file="\${1#--file=}"; shift; done; printf 'dump' > "$file"`)
stub('pg_restore', `echo "pg_restore:$*" >> "${log}"; [[ "\${STUB_RESTORE_FAIL:-}" != 1 ]]`)
stub('curl', `echo "curl:$*" >> "${log}"; cat >/dev/null; [[ "\${STUB_CURL_FAIL:-}" != 1 ]]`)
stub('rclone', `echo "rclone:$*" >> "${log}"; if [[ "$1" == copy && "\${STUB_RCLONE_COPY_FAIL:-}" == 1 ]]; then exit 1; fi; if [[ "$1" == check && "\${STUB_RCLONE_CHECK_FAIL:-}" == 1 ]]; then exit 1; fi; if [[ "$1" == delete && "\${STUB_RCLONE_DELETE_FAIL:-}" == 1 ]]; then exit 1; fi`)
stub('cp', `dest=""; for arg in "$@"; do dest="$arg"; done; /bin/cp "$@"; status=$?; if [[ "$status" != 0 ]]; then exit "$status"; fi; if [[ "\${STUB_MIRROR_CORRUPT:-}" == 1 ]]; then if [[ -d "$dest" ]]; then echo corrupt >> "$dest"/postgres_*.dump; else echo corrupt >> "$dest"; fi; fi`)
stub('psql', `echo "psql:$*" >> "${log}"; sql=""; prev=""; for arg in "$@"; do if [[ "$prev" == "-c" ]]; then sql="$arg"; fi; prev="$arg"; done; case "$sql" in *"FROM pg_database"*) if [[ "\${STUB_DB_EXISTS:-}" == 1 ]]; then printf '1\\n'; fi ;; *"migration_name"*) printf '%s\\n' "$DRILL_STUB_LATEST_MIGRATION" ;; *"information_schema.tables"*) printf '4\\n' ;; *"count(*)"*) printf '2\\n' ;; *) ;; esac`)
stub('prisma', `echo "prisma:$* POSTGRES_URL=$POSTGRES_URL DATABASE_URL=$DATABASE_URL" >> "${log}"; exit 0`)
if (process.platform === 'darwin') stub('flock', `exec python3 - "$@" <<'PY'
import fcntl, sys, time
args=sys.argv[1:]
fd=int(args[-1]); deadline=time.monotonic()+float(args[args.index('-w')+1]) if '-w' in args else time.monotonic()
while True:
    try: fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB); break
    except BlockingIOError:
        if '-n' in args or time.monotonic()>=deadline: sys.exit(1)
        time.sleep(.05)
PY`)
const baseEnv = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  API_ENV_FILE: envFile,
  BACKUP_DIR: backupDir,
  RETENTION_DAYS: '30',
  DATABASE_URL: '',
  POSTGRES_URL: '',
  ALERT_WEBHOOK_URL: '',
}
const run = (script, args = [], extra = {}) => spawnSync('bash', [path.join(root, 'scripts', script), ...args], { env: { ...baseEnv, ...extra }, encoding: 'utf8' })
const day = new Date().toISOString().slice(0, 10)

let result = run('backup-postgres.sh')
assert.equal(result.status, 0, result.stderr)
assert.match(result.stderr, /BACKUP_NOTICE:/, '未开启异地备份时要有明确提示')
const target = path.join(backupDir, `postgres_${day}.dump`)
assert.ok(existsSync(target))
assert.ok(readFileSync(path.join(backupDir, 'LAST_SUCCESS'), 'utf8').includes(path.basename(target)))
assert.match(readFileSync(log, 'utf8'), /pg_restore:-l/)
assert.match(readFileSync(log, 'utf8'), /pg_dump:.*postgresql:\/\/user:secret@db\/app/, '环境没有连接串时应从 .env 读到并交给 pg_dump')
result = run('backup-postgres.sh')
assert.equal(result.status, 0, result.stderr)
assert.doesNotMatch(result.stderr, /BACKUP_NOTICE:/, '未开启提示只打印一次')
result = run('backup-postgres.sh', [], { STUB_FAIL: '1' })
assert.notEqual(result.status, 0)
assert.ok(existsSync(target))
assert.ok(!existsSync(`${target}.partial`))
assert.equal((readFileSync(log, 'utf8').match(/curl:/g) ?? []).length, 1)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/production'])
assert.notEqual(result.status, 0)
assert.match(result.stderr, /must contain drill or verify/)
result = run('restore-postgres-drill.sh', [target, 'postgresql://u:p@db/backup-drill'])
assert.equal(result.status, 0, result.stderr)
assert.match(readFileSync(log, 'utf8'), /prisma:.*POSTGRES_URL=postgresql:\/\/u:p@db\/backup-drill DATABASE_URL=postgresql:\/\/u:p@db\/backup-drill/)

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', RETENTION_DAYS: '30' })
assert.equal(result.status, 0, result.stderr)
let calls = readFileSync(log, 'utf8')
assert.match(calls, /rclone:copy .*postgres_\d{4}-\d{2}-\d{2}\.dump cos:zyd-backup\/postgres/)
assert.match(calls, /rclone:check /, '上传后必须做完整性校验')
assert.match(calls, /rclone:delete cos:zyd-backup\/postgres --min-age 30d --include postgres_\*\.dump/)
assert.ok(calls.indexOf('rclone:copy') < calls.indexOf('rclone:check'), '先上传再校验')
assert.ok(calls.indexOf('rclone:check') < calls.indexOf('rclone:delete'), '校验通过后再清理')
assert.match(result.stdout, /BACKUP_OFFSITE_OK/)

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', RETENTION_DAYS: '7', BACKUP_REMOTE_RETENTION_DAYS: '9' })
assert.equal(result.status, 0, result.stderr)
assert.match(readFileSync(log, 'utf8'), /rclone:delete cos:zyd-backup\/postgres --min-age 9d /, '异地保留天数跟着 BACKUP_REMOTE_RETENTION_DAYS')
assert.doesNotMatch(readFileSync(log, 'utf8'), /min-age 7d/, '异地保留天数不跟随本机 RETENTION_DAYS')

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', RETENTION_DAYS: '7' })
assert.equal(result.status, 0, result.stderr)
assert.match(readFileSync(log, 'utf8'), /min-age 30d/, '未单独设置时异地保留天数用自己的默认值 30')

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', STUB_RCLONE_DELETE_FAIL: '1' })
assert.equal(result.status, 0, result.stderr)
assert.match(result.stdout, /BACKUP_OK/)
assert.match(result.stderr, /BACKUP_WARN: remote retention cleanup failed/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '异地清理失败要发告警')

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', STUB_RCLONE_COPY_FAIL: '1' })
assert.notEqual(result.status, 0)
assert.match(result.stderr, /object upload failed/)
assert.doesNotMatch(result.stdout, /BACKUP_OK/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '上传失败要发告警')

writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', STUB_RCLONE_CHECK_FAIL: '1' })
assert.notEqual(result.status, 0)
assert.match(result.stderr, /object integrity check failed/)
assert.doesNotMatch(result.stdout, /BACKUP_OK/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '校验失败要发告警')
assert.doesNotMatch(readFileSync(log, 'utf8'), /rclone:delete /, '校验失败后不要接着清理')

writeFileSync(log, '')
result = run('backup-postgres.sh')
assert.equal(result.status, 0, result.stderr)
assert.doesNotMatch(readFileSync(log, 'utf8'), /rclone:/)

for (const bad of ['0', '-1', 'abc', '']) {
  result = run('backup-postgres.sh', [], { RETENTION_DAYS: bad })
  if (bad === '') {
    assert.equal(result.status, 0, '空值回落默认 30 天')
    continue
  }
  assert.notEqual(result.status, 0, `RETENTION_DAYS=${bad} 应拒绝`)
  assert.match(result.stderr, /RETENTION_DAYS must be a positive integer/)
}
result = run('backup-postgres.sh', [], { BACKUP_REMOTE_RETENTION_DAYS: '0' })
assert.equal(result.status, 0, '未开启上传时，异地保留天数写错不阻断本机备份')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_OBJECT_URI: 'cos:zyd-backup/postgres', BACKUP_REMOTE_RETENTION_DAYS: 'abc' })
assert.notEqual(result.status, 0)
assert.match(result.stderr, /BACKUP_REMOTE_RETENTION_DAYS must be a positive integer/)

const noticeDir = path.join(dir, 'notice-backups')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_DIR: noticeDir })
assert.equal(result.status, 0, result.stderr)
assert.match(result.stderr, /BACKUP_NOTICE:/)
assert.match(result.stderr, /只打印一次/)
result = run('backup-postgres.sh', [], { BACKUP_DIR: noticeDir })
assert.equal(result.status, 0, result.stderr)
assert.doesNotMatch(result.stderr, /BACKUP_NOTICE:/)

const mirror = path.join(dir, 'mirror')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_UPLOAD_BACKEND: 'local', BACKUP_MIRROR_DIR: mirror, BACKUP_REMOTE_RETENTION_DAYS: '11' })
assert.equal(result.status, 0, result.stderr)
assert.ok(existsSync(path.join(mirror, `postgres_${day}.dump`)))
assert.doesNotMatch(readFileSync(log, 'utf8'), /rclone:/, '本地目录模式不调用 rclone')
assert.match(result.stdout, /BACKUP_OFFSITE_OK: checked local/)
const corruptMirror = path.join(dir, 'mirror-corrupt')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { BACKUP_UPLOAD_ENABLED: '1', BACKUP_UPLOAD_BACKEND: 'local', BACKUP_MIRROR_DIR: corruptMirror, STUB_MIRROR_CORRUPT: '1' })
assert.notEqual(result.status, 0)
assert.match(result.stderr, /object integrity check failed/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '本地目录校验失败也要发告警')

const uploadEnv = path.join(dir, 'upload.env')
writeFileSync(uploadEnv, 'DATABASE_URL="postgresql://user:secret@db/app"\nBACKUP_UPLOAD_ENABLED=1\nBACKUP_OBJECT_URI=cos:<bucket>/postgres\nBACKUP_REMOTE_RETENTION_DAYS=12\n')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { API_ENV_FILE: uploadEnv, BACKUP_UPLOAD_ENABLED: '', BACKUP_OBJECT_URI: '', BACKUP_REMOTE_RETENTION_DAYS: '' })
assert.equal(result.status, 0, result.stderr)
assert.match(readFileSync(log, 'utf8'), /rclone:copy .* cos:<bucket>\/postgres/)
assert.match(readFileSync(log, 'utf8'), /min-age 12d/, '环境为空时从 API_ENV_FILE 读取异地配置')

const examplePath = path.join(root, 'scripts/rclone-offsite.conf.example')
const example = readFileSync(examplePath, 'utf8')
assert.match(example, /chmod 600/)
assert.match(example, /PutObject/)
assert.match(example, /GetObject/)
assert.match(example, /ListBucket/)
assert.match(example, /DeleteObject/)
assert.match(example, /版本控制/)
assert.match(example, /生命周期/)
for (const line of example.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  if (/^\[[A-Za-z0-9_-]+\]$/.test(trimmed)) continue
  const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
  assert.ok(match, `无法识别的配置行: ${trimmed}`)
  const [, key, value] = match
  if (['type', 'provider', 'env_auth', 'acl'].includes(key)) {
    assert.match(value, /^(s3|TencentCOS|false|private)$/, `${key} 只能是 rclone 结构字段`)
  } else {
    assert.match(value, /^<[^<>\n]+>$/, `${key} 必须是尖括号占位`)
  }
}
assert.doesNotMatch(example, /AKID|AKIA|[0-9]{1,3}(\.[0-9]{1,3}){3}|ap-[a-z]+|myqcloud\.com|zyidai|zyidai\.cn/)

const doc = readFileSync(path.join(repoRoot, 'docs/device/postgres-operations.md'), 'utf8')
const sectionStart = doc.indexOf('## 10. 异地备份')
assert.ok(sectionStart >= 0, '运维文档要有异地备份一节')
const nextHeading = doc.indexOf('\n## ', sectionStart + 1)
const section = nextHeading === -1 ? doc.slice(sectionStart) : doc.slice(sectionStart, nextHeading)
const envNames = [...section.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map((item) => item[1])
assert.ok(envNames.length >= 15, '环境变量清单不完整')
const scriptText = ['backup-postgres.sh', 'restore-offsite-drill.sh'].map((name) => readFileSync(path.join(root, 'scripts', name), 'utf8')).join('\n')
for (const name of envNames) {
  assert.match(scriptText, new RegExp(String.raw`\$\{${name}\b`), `${name} 在文档里列出，但脚本没有读取`)
}
assert.doesNotMatch(readFileSync(path.join(root, 'scripts/restore-offsite-drill.sh'), 'utf8'), /DRILL_STUB_LATEST_MIGRATION/)

const latestMigration = spawnSync('bash', ['-lc', `LC_ALL=C find '${path.join(root, 'prisma/postgres/migrations')}' -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; | LC_ALL=C sort | tail -n 1`], { encoding: 'utf8' })
assert.equal(latestMigration.status, 0, latestMigration.stderr)
const latestName = latestMigration.stdout.trim()
assert.ok(latestName)
const restoreMirror = path.join(dir, 'restore-mirror')
mkdirSync(restoreMirror)
writeFileSync(path.join(restoreMirror, 'postgres_2026-01-02.dump'), 'custom-dump-bytes')
const drillEnv = {
  DRILL_SOURCE: 'local',
  BACKUP_MIRROR_DIR: restoreMirror,
  DRILL_ADMIN_URL: 'postgresql://u:p@127.0.0.1/postgres',
  DRILL_WORK_DIR: path.join(dir, 'drill-work'),
  DRILL_RECORD_PATH: path.join(dir, 'drill-record.txt'),
  DRILL_STUB_LATEST_MIGRATION: latestName,
}
mkdirSync(drillEnv.DRILL_WORK_DIR)
writeFileSync(log, '')
result = run('restore-offsite-drill.sh', ['postgresql://u:p@127.0.0.1/production'], drillEnv)
assert.notEqual(result.status, 0, '非 drill 库名必须拒绝')
assert.match(result.stderr, /must contain drill/)
assert.doesNotMatch(readFileSync(log, 'utf8'), /pg_restore:|psql:/, '拒绝发生在拉取和恢复之前')
writeFileSync(log, '')
result = run('restore-offsite-drill.sh', ['postgresql://u:p@127.0.0.1/backup_verify'], drillEnv)
assert.notEqual(result.status, 0)
assert.match(result.stderr, /must contain drill/)
writeFileSync(log, '')
result = run('restore-offsite-drill.sh', ['postgresql://u:p@127.0.0.1/offsite_drill'], { ...drillEnv, STUB_DB_EXISTS: '1' })
assert.notEqual(result.status, 0)
assert.match(result.stderr, /refusing to overwrite/)
assert.doesNotMatch(readFileSync(log, 'utf8'), /pg_restore:--exit-on-error/)
writeFileSync(log, '')
result = run('restore-offsite-drill.sh', ['postgresql://u:p@127.0.0.1/offsite_drill'], { ...drillEnv, DRILL_DROP_DATABASE: '1' })
assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
const recordText = readFileSync(drillEnv.DRILL_RECORD_PATH, 'utf8')
assert.match(recordText, /文件名: postgres_2026-01-02\.dump/)
assert.match(recordText, /大小: 17/)
assert.match(recordText, /校验结果: pg_restore -l 通过/)
assert.match(recordText, /表数=4/)
assert.match(recordText, /迁移一致=是/)
assert.match(recordText, new RegExp(`库迁移=${latestName}`))
assert.match(recordText, /删除临时库: 是/)
assert.match(recordText, /结论: 通过/)
assert.ok(existsSync(path.join(drillEnv.DRILL_WORK_DIR, 'postgres_2026-01-02.dump')), '拉回到另一个目录')
const restoreLog = readFileSync(log, 'utf8')
assert.match(restoreLog, /CREATE DATABASE "offsite_drill"/)
assert.match(restoreLog, /DROP DATABASE "offsite_drill"/)
assert.doesNotMatch(restoreLog, /DROP DATABASE "postgres"/)
assert.equal(readdirSync(path.join(root, 'prisma/postgres/migrations')).includes(latestName), true)

// 发布与每日备份共用同一个导出清理实现；只在临时目录造数据。
const helper = process.env.VERIFY_PRERELEASE_HELPER || path.join(repoRoot, '.github/scripts/prune-prerelease-dumps.mjs')
const stamp = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const prereleaseRoot = path.join(dir, 'prerelease')
mkdirSync(prereleaseRoot)
const putGroup = (folder, stem, { ok = false, partial = false, storage = false } = {}) => {
  writeFileSync(path.join(folder, `${stem}.dump`), 'full database')
  mkdirSync(path.join(folder, `${stem}.runtime`, 'services/api/storage'), { recursive: true })
  if (ok) writeFileSync(path.join(folder, `${stem}.ok`), 'ok')
  if (partial) writeFileSync(path.join(folder, `${stem}.runtime.partial`), 'writing')
  if (storage) writeFileSync(path.join(folder, `${stem}.runtime`, 'services/api/storage/upload.txt'), 'user file')
}
const old = `pre-old-${stamp(40)}`
const thirty = `pre-thirty-${stamp(30)}`
const recent = `pre-recent-${stamp(2)}`
const partial = `pre-writing-${stamp(40)}`
const legacy = 'pre-legacy-no-utc'
const orphan = `pre-orphan-${stamp(40)}`
putGroup(prereleaseRoot, old, { ok: true, storage: true })
putGroup(prereleaseRoot, thirty)
putGroup(prereleaseRoot, recent)
putGroup(prereleaseRoot, partial, { partial: true })
putGroup(prereleaseRoot, legacy)
putGroup(prereleaseRoot, 'legacy-group')
writeFileSync(path.join(prereleaseRoot, `${orphan}.dump`), 'finished dump, runtime copy failed')
const oldTime = new Date(Date.now() - 40 * 86400000)
utimesSync(path.join(prereleaseRoot, `${legacy}.dump`), oldTime, oldTime)
const runPrune = (folder, args = []) => spawnSync('node', [helper, '--root', folder, ...args], {
  env: { ...baseEnv, PRERELEASE_ALERT_WEBHOOK_URL: 'https://wecom.invalid/hook' }, encoding: 'utf8',
})
writeFileSync(log, '')
const dryPrune = runPrune(prereleaseRoot, ['--dry-run'])
assert.equal(dryPrune.status, 0, dryPrune.stderr)
assert.match(runPrune(prereleaseRoot, ['--list-stems']).stdout, /legacy-group/, '组数清理仍识别旧式非 pre 组名')
assert.match(dryPrune.stdout, new RegExp(`PRERELEASE_DRY_DELETE: ${old}\\.dump`))
assert.match(dryPrune.stdout, new RegExp(`PRERELEASE_DRY_DELETE: ${thirty}\\.dump`))
assert.match(dryPrune.stdout, new RegExp(`PRERELEASE_DRY_DELETE: ${orphan}\\.dump`))
assert.match(dryPrune.stdout, new RegExp(`PRERELEASE_DRY_DELETE: ${legacy}\\.dump source=dump-mtime`))
assert.match(dryPrune.stdout, new RegExp(`${old} storage_has_files=true`))
assert.ok(!existsSync(path.join(prereleaseRoot, '.prune-last-success')) && existsSync(path.join(prereleaseRoot, `${old}.dump`)), '干跑只列不删，也不写状态')
const cleaned = runPrune(prereleaseRoot)
assert.equal(cleaned.status, 0, cleaned.stderr)
for (const stem of [old, thirty, legacy, orphan]) {
  assert.ok(!existsSync(path.join(prereleaseRoot, `${stem}.dump`)) && existsSync(path.join(prereleaseRoot, `${stem}.dump.expired`)), `${stem} 到期删除并留标记`)
}
assert.ok(existsSync(path.join(prereleaseRoot, `${old}.ok`)) && existsSync(path.join(prereleaseRoot, `${old}.runtime`)), '成功锚点和运行目录保留')
assert.ok(existsSync(path.join(prereleaseRoot, `${recent}.dump`)) && existsSync(path.join(prereleaseRoot, `${partial}.dump`)), '未到期和写入中的组不动')
assert.ok(existsSync(path.join(prereleaseRoot, 'legacy-group.dump')), '共用到期清理只触碰发布前 pre- 组')
assert.match(cleaned.stderr, /组名无法解析 UTC.*pre-legacy-no-utc/, '旧组按 dump 本身修改时间删时告警')
assert.match(readFileSync(log, 'utf8'), /curl:/, '无法解析 UTC 的告警送到现有 webhook')
assert.match(readFileSync(path.join(prereleaseRoot, '.prune-last-success'), 'utf8'), /last_success=\d{4}-\d{2}-\d{2}/)

const lockRoot = path.join(dir, 'prerelease-lock')
mkdirSync(lockRoot)
putGroup(lockRoot, old)
const lockReady = path.join(dir, 'prerelease-lock-ready')
const locked = spawn('bash', ['-c', `exec 9>"${lockRoot}/.prune.lock"; flock -n 9; echo ready > "${lockReady}"; exec sleep 5`], { env: baseEnv, stdio: 'ignore' })
try {
  const deadline = Date.now() + 2000
  while (!existsSync(lockReady) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  assert.ok(existsSync(lockReady), '夹具进程取得发布锁')
  writeFileSync(log, '')
  result = run('backup-postgres.sh', [], { DEPLOY_BACKUP_ROOT: lockRoot, PRERELEASE_PRUNE_HELPER: helper })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /BACKUP_OK/)
  assert.match(result.stdout, /PRERELEASE_SKIP: 发布锁占用/)
  assert.ok(existsSync(path.join(lockRoot, `${old}.dump`)), '发布持锁时每日清理跳过')
  assert.doesNotMatch(readFileSync(log, 'utf8'), /curl:/, '首日无状态文件不推连续失败告警')
} finally { locked.kill() }
const waitUnlock = Date.now() + 2000
while (locked.exitCode === null && Date.now() < waitUnlock) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
result = run('backup-postgres.sh', [], { DEPLOY_BACKUP_ROOT: lockRoot, PRERELEASE_PRUNE_HELPER: helper })
assert.equal(result.status, 0, result.stderr)
assert.ok(existsSync(path.join(lockRoot, `${old}.dump.expired`)), '发布结束后每日备份拿锁清理')

const skipRoot = path.join(dir, 'prerelease-skip')
mkdirSync(skipRoot)
writeFileSync(log, '')
result = runPrune(skipRoot, ['--event', 'skipped'])
assert.equal(result.status, 0, result.stderr)
assert.doesNotMatch(readFileSync(log, 'utf8'), /curl:/, '首日没状态文件不告警')
writeFileSync(path.join(skipRoot, '.prune-last-success'), `first_seen=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}\n`)
result = runPrune(skipRoot, ['--event', 'skipped'])
assert.match(result.stderr, /连续两天未清成/)
assert.match(readFileSync(log, 'utf8'), /curl:/, '连续两天没有清成推告警')

const errorRoot = path.join(dir, 'prerelease-error')
mkdirSync(errorRoot)
putGroup(errorRoot, old)
writeFileSync(path.join(errorRoot, '.prune-last-success'), 'broken\n')
writeFileSync(log, '')
result = run('backup-postgres.sh', [], { DEPLOY_BACKUP_ROOT: errorRoot, PRERELEASE_PRUNE_HELPER: helper })
assert.equal(result.status, 0, '清理错误不让每日备份失败')
assert.match(result.stderr, /PRERELEASE_WARN: 发布前导出清理失败/)
assert.match(result.stdout, /BACKUP_OK/)
assert.ok(existsSync(path.join(errorRoot, `${old}.dump`)), '清理错误前未删 dump')
assert.match(readFileSync(log, 'utf8'), /curl:/, '清理错误告警')

const sameRoot = path.join(dir, 'prerelease-same')
mkdirSync(sameRoot)
putGroup(sameRoot, old)
putGroup(sameRoot, recent)
result = run('backup-postgres.sh', [], { DEPLOY_BACKUP_ROOT: sameRoot, PRERELEASE_PRUNE_HELPER: helper })
assert.equal(result.status, 0, result.stderr)
assert.deepEqual(readdirSync(sameRoot).filter((name) => name.startsWith('pre-') && /\.(dump|dump\.expired)$/.test(name)).sort(),
  [`${old}.dump.expired`, `${recent}.dump`].sort(), '每日调用与直接调用同一夹具结论一致')

console.log('backup ops gates passed')
