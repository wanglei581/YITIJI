// verify:deploy-rollback — 真跑 .github/scripts/deploy-api-release.sh 的发布演练（P0-3）
//
// 不是读源码找字符串：在临时目录里搭一个「源码检出 + 运行目录 + 备份目录」，把会碰外部世界的
// 命令（pnpm、pg_dump、pg_restore、pm2、curl）换成桩，git、rsync、bash 用真的，然后执行真实
// 发布脚本，逐场景断言结果：
//   1. 就绪检查通过：运行目录换成新版本，发布指针指向目标提交，PM2 只重启一次；
//   2. 就绪检查一直失败：运行目录（含依赖、.env、发布指针）恢复到发布前，PM2 再重启回旧版，
//      发布期间用户新传的文件保留，备份全部保留，脚本以失败结束；
//   3. 迁移失败（PM2 还没重启）：运行目录恢复到发布前，不重启 PM2，脚本以失败结束；
//   4. 备份清理：每次发布的 .dump / .runtime / .migrations.log 算一组，按组保留最近 3 组，
//      迁移日志不会单算一组把上一次发布的备份挤掉。
// 另保留几条 deploy.yml 的静态检查（full 发布缺后台目录即失败、静态目录切换失败时保留备份）。
//
// 只用 node 内置模块，可在 pnpm install 之前跑（CI「Repository integrity gate」步）。
// macOS 本机跑时用 GNU coreutils（gdate/gchmod）和一个 find 替身补齐发布脚本里的 GNU 写法；
// 缺少 gdate/gchmod 时整条门禁判失败而不是跳过 ——「没验证」不能算「验证通过」。
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const deployScript = join(root, '.github/scripts/deploy-api-release.sh')
const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => { failures += 1; console.error(`  FAIL ${message}`) }
const check = (ok, message, detail = '') => (ok ? pass(message) : fail(detail ? `${message} —— ${detail}` : message))

// ── deploy.yml 静态检查（静态目录那一段没法在本机真跑：它要 nginx 与 secrets）───────────
check(workflow.includes('if [ -z "${DEPLOY_ADMIN_WEB_ROOT:-}" ] || [ -z "${DEPLOY_PARTNER_WEB_ROOT:-}" ]; then'),
  'full 发布缺后台目录配置时直接失败，不再静默跳过')
check(/\nconcurrency:\n  group: production-deploy\n  cancel-in-progress: false\n/.test(workflow), '生产发布串行：concurrency 组、不取消进行中的发布')
check(workflow.indexOf('✅ API-only 部署完成') >= 0 && workflow.indexOf('✅ API-only 部署完成') < workflow.indexOf('STATIC_BACKUP_ROOT'),
  'API-only 在静态目录备份之前退出')
// 变量名后面紧跟中文标点（如 "$HEALTH_URL）"）：非 UTF-8 语言环境下 bash 会把那个字节当成变量名的一部分，
// set -u 之下直接「unbound variable」退出。服务器经 SSH 执行时的语言环境不由我们保证，一律写成 ${VAR}。
for (const [label, text] of [['deploy-api-release.sh', readFileSync(deployScript, 'utf8')], ['deploy.yml', workflow]]) {
  const hits = text.split('\n').map((line, i) => [i + 1, line]).filter(([, line]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(line))
  check(hits.length === 0, `${label}：变量后不紧跟非 ASCII 字符（一律写成 \${VAR}）`, hits.map(([n]) => `第 ${n} 行`).join('、'))
}
const releaseText = readFileSync(deployScript, 'utf8')
check(!releaseText.includes('journalctl --vacuum'), '发布脚本不出现 journalctl --vacuum')
check(
  (releaseText.match(/rm -rf -- "\$BACKUP_ROOT\/\$stem\.dump"/g) ?? []).length === 1,
  '旧备份只在 prune_old_backups 里删除一次，发布前清理复用该函数'
)
check(
  releaseText.includes('[ "$stem" = "$current_stem" ]'),
  'prune_old_backups 仍保护当前这次发布的组'
)

// ── 真跑发布脚本 ────────────────────────────────────────────────────────────────
const isDarwin = process.platform === 'darwin'
const which = (name) => spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim()

function writeExec(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function writeFindShim(bin) {
  writeExec(join(bin, 'find'), `#!/usr/bin/env python3
import datetime, os, sys
args = sys.argv[1:]
if '-printf' not in args:
    os.execv('/usr/bin/find', ['find'] + args)
base, fmt = args[0], args[args.index('-printf') + 1]
only_dirs = '-type' in args and args[args.index('-type') + 1] == 'd'
for name in os.listdir(base):
    path = os.path.join(base, name)
    if only_dirs and not os.path.isdir(path):
        continue
    st = os.lstat(path)
    day = datetime.datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d')
    line = fmt.replace('%T@', '%.10f' % st.st_mtime).replace('%TY-%Tm-%Td', day).replace('%f', name).replace('%p', path)
    sys.stdout.write(line.replace('\\\\t', '\\t').replace('\\\\n', '\\n'))
`)
}

function makeShims(bin) {
  writeExec(join(bin, 'pnpm'), `#!/usr/bin/env bash
echo "pnpm $* @ $PWD" >> "$DRILL_CALLS"
case "$*" in
  "store prune")
    touch "$DRILL_DIR/pnpm-store-pruned" || true ;;
  *"--filter @ai-job-print/api build"*)
    mkdir -p "$DRILL_DEPLOY/services/api/dist/config"
    echo "// drill build" > "$DRILL_DEPLOY/services/api/dist/config/production-runtime-gates.js" ;;
  "install --frozen-lockfile")
    if [ "$PWD" = "$DRILL_RUNTIME" ]; then
      if [ -n "\${DRILL_RUNTIME_INSTALL_SIGNAL:-}" ]; then
        kill -s "$DRILL_RUNTIME_INSTALL_SIGNAL" "$PPID" 2>/dev/null || true
        sleep 1
        exit 1
      fi
      mkdir -p node_modules && echo new > node_modules/marker
      # 与旧标记同长度、同修改时间：确定地复现「快速比对会跳过」的条件
      touch -r "$DRILL_MARKER_REF" node_modules/marker
      # 模拟发布期间有人上传了文件：恢复运行目录时不能把它删掉
      echo during > services/api/storage/uploaded-during-release.txt
    fi ;;
  "db:pg:deploy")
    echo "Applying migration 20260928_drill"
    if [ "\${DRILL_MIGRATION_FAIL:-}" = 1 ]; then echo "migration failed" >&2; exit 1; fi ;;
esac
exit 0
`)
  writeExec(join(bin, 'pg_dump'), `#!/usr/bin/env bash
echo "pg_dump $*" >> "$DRILL_CALLS"
out=""; while [ $# -gt 0 ]; do [ "$1" = -f ] && out="$2"; shift; done
if [ "\${DRILL_PG_DUMP_FAIL:-}" = 1 ]; then
  [ -n "$out" ] && printf 'partial\\n' > "$out"
  exit 1
fi
if [ "\${DRILL_PG_DUMP_KILL:-}" = 1 ]; then
  [ -n "$out" ] && printf 'partial\\n' > "$out"
  kill -TERM "$PPID" 2>/dev/null || true
  sleep 1
  exit 1
fi
if [ -n "\${DRILL_PG_DUMP_SIGNAL:-}" ]; then
  [ -n "$out" ] && printf 'partial\\n' > "$out"
  kill -s "$DRILL_PG_DUMP_SIGNAL" "$PPID" 2>/dev/null || true
  sleep 1
  exit 1
fi
printf 'drill-dump\\n' > "$out"
`)
  writeExec(join(bin, 'pg_restore'), `#!/usr/bin/env bash
echo "pg_restore $*" >> "$DRILL_CALLS"
if [ "\${DRILL_PG_RESTORE_FAIL:-}" = 1 ]; then exit 1; fi
exit 0
`)
  writeExec(join(bin, 'pm2'), `#!/usr/bin/env bash
echo "pm2 $* COMMIT=\${COMMIT:-}" >> "$DRILL_CALLS"
if [ "\${DRILL_PM2_LOGROTATE:-}" = installed ]; then
  case "$1" in
    ls) printf '%s\\n' "\${DRILL_PM2_LS_OUT:-pm2-logrotate online}" ;;
    conf)
      if [ -n "\${DRILL_PM2_CONF_OUT:-}" ]; then
        printf '%s\\n' "$DRILL_PM2_CONF_OUT" | tr ';' '\\n'
      else
        echo "pm2-logrotate online"
      fi
      ;;
  esac
fi
exit 0
`)
  writeExec(join(bin, 'cp'), `#!/usr/bin/env bash
if [ "\${DRILL_CP_FAIL:-}" = 1 ]; then
  dest="\${!#}"
  mkdir -p "$dest"
  echo incomplete > "$dest/partial.txt"
  exit 1
fi
exec /bin/cp "$@"
`)
  writeExec(join(bin, 'rm'), `#!/usr/bin/env bash
if [ -n "\${DRILL_RM_FAIL_SUBSTR:-}" ]; then
  for arg in "$@"; do
    case "$arg" in
      *"\${DRILL_RM_FAIL_SUBSTR}"*)
        # 只拦已经存在的路径。发布脚本在 pg_dump 前会 rm 一个还不存在的 partial，那一次必须成功。
        if [ -e "$arg" ]; then echo "drill rm blocked" >&2; exit 1; fi
        ;;
    esac
  done
fi
exec /bin/rm "$@"
`)
  writeExec(join(bin, 'du'), `#!/usr/bin/env bash
if [ "\${DRILL_DU_FAIL:-}" = 1 ]; then exit 1; fi
exec /usr/bin/du "$@"
`)
  writeExec(join(bin, 'df'), `#!/usr/bin/env bash
low="\${DRILL_DF_AVAIL_MB:-999999}"
after_pnpm="\${DRILL_DF_AVAIL_AFTER_PNPM_MB:-}"
after_prune="\${DRILL_DF_AVAIL_AFTER_PRUNE_MB:-}"
avail="$low"
drill_dir="\${DRILL_DIR:-}"
if [ -n "$after_pnpm" ] && [ -n "$drill_dir" ] && [ -f "$drill_dir/pnpm-store-pruned" ]; then
  avail="$after_pnpm"
fi
bk="\${DEPLOY_BACKUP_ROOT:-}"
if [ -n "$after_prune" ] && [ -n "$drill_dir" ] && [ -n "$bk" ] && [ -d "$bk" ]; then
  base_file="$drill_dir/df-backup-baseline"
  count="$(/usr/bin/find "$bk" -maxdepth 1 -name '*.dump' 2>/dev/null | /usr/bin/wc -l | tr -d ' ')"
  if [ ! -f "$base_file" ]; then
    printf '%s\\n' "$count" > "$base_file"
  fi
  base="$(cat "$base_file")"
  if [ "$count" -lt "$base" ]; then
    avail="$after_prune"
  fi
fi
printf '%s\\n' "Filesystem 1024-blocks Used Available Capacity Mounted on"
printf '%s\\n' "drill 100000000 1000 \${avail} 1% /"
`)
  // 「哪个版本在跑」用运行目录里的 VERSION 表示：PM2 是桩，重启后读到的就是运行目录当前内容。
  writeExec(join(bin, 'curl'), `#!/usr/bin/env bash
version="$(cat "$DRILL_RUNTIME/VERSION" 2>/dev/null)"
case "$DRILL_HEALTH" in
  always) ;;
  old-only) [ "$version" = old ] || exit 22 ;;
  *) exit 22 ;;
esac
printf '{"success":true,"data":{"status":"ready"}}'
`)
  if (isDarwin) {
    for (const [name, gnu] of [['chmod', 'gchmod'], ['chown', 'gchown']]) {
      const path = which(gnu)
      if (!path) throw new Error(`本机缺少 ${gnu}（brew install coreutils），无法演练发布脚本里的 GNU 写法`)
      writeExec(join(bin, name), `#!/usr/bin/env bash\nexec "${path}" "$@"\n`)
    }
    // 发布脚本只用到 find <dir> -maxdepth 1 -mindepth 1 [-type d] -printf <fmt>
    writeFindShim(bin)
  }
  const dateBin = isDarwin ? which('gdate') : '/bin/date'
  if (!dateBin) throw new Error('本机缺少 gdate（brew install coreutils），无法演练发布脚本里的 GNU 写法')
  writeExec(join(bin, 'date'), `#!/usr/bin/env bash
if [ -n "\${DRILL_DATE_SIGNAL:-}" ] && [ ! -f "\${DRILL_DIR:-}/date-signaled" ]; then
  want="\${DRILL_DATE_SIGNAL_ON:-}"
  if [ -z "$want" ] || [ "$*" = "$want" ]; then
    touch "\${DRILL_DIR:-}/date-signaled"
    kill -s "$DRILL_DATE_SIGNAL" "$PPID" 2>/dev/null || true
  fi
fi
exec "${dateBin}" "$@"
`)
}

function makeSandbox({ oldGroups = 0, pointerUnwritable = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-drill-'))
  const bin = join(dir, 'bin')
  const checkout = join(dir, 'checkout')
  const runtime = join(dir, 'runtime')
  const backups = join(dir, 'backups')
  mkdirSync(bin)
  makeShims(bin)

  mkdirSync(join(checkout, 'services/api/src/config'), { recursive: true })
  mkdirSync(join(checkout, 'services/api/scripts'), { recursive: true })
  // 新旧内容长度不同：rsync 按「大小 + 修改时间」快速比对，同秒创建的同长文件会被当成没变
  writeFileSync(join(checkout, 'VERSION'), 'new-release\n')
  writeFileSync(join(checkout, 'services/api/src/config/production-runtime-gates.ts'), 'PRINT_REQUIRE_PII_SCAN\nPRINT_REQUIRE_PRINTER_ONLINE\n')
  writeFileSync(join(checkout, 'services/api/scripts/preflight-production-gates.mjs'), 'process.exit(0)\n')
  // 3d 法务文档预检的替身：记下调用参数；DRILL_LEGAL_PREFLIGHT=missing 时按「缺隐私政策」失败
  writeFileSync(join(checkout, 'services/api/scripts/preflight-legal-docs.mjs'), [
    "import { appendFileSync } from 'node:fs'",
    "appendFileSync(process.env.DRILL_CALLS, `legal-preflight ${process.argv.slice(2).join(' ')}\\n`)",
    "if (process.env.DRILL_LEGAL_PREFLIGHT === 'missing') { console.log('缺  隐私政策：没有已激活的版本'); process.exit(1) }",
    "console.log('LEGAL DOCS PREFLIGHT OK: 3 docs')",
    '',
  ].join('\n'))
  if (pointerUnwritable) {
    // 让「写发布指针」这一步失败：同名目录会被 rsync 带进运行目录，cat > 目录必然失败
    mkdirSync(join(checkout, 'DEPLOY_SOURCE.txt'))
    writeFileSync(join(checkout, 'DEPLOY_SOURCE.txt/keep'), 'x\n')
  }
  const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('-c', 'user.email=drill@example.invalid', '-c', 'user.name=drill', 'add', '.')
  git('-c', 'user.email=drill@example.invalid', '-c', 'user.name=drill', 'commit', '-q', '-m', 'drill')
  const sha = git('rev-parse', 'HEAD')

  mkdirSync(join(runtime, 'services/api/storage'), { recursive: true })
  mkdirSync(join(runtime, 'node_modules'))
  writeFileSync(join(runtime, 'VERSION'), 'old\n')
  writeFileSync(join(runtime, 'node_modules/marker'), 'old\n')
  const markerTime = new Date('2026-01-01T00:00:00Z')
  utimesSync(join(runtime, 'node_modules/marker'), markerTime, markerTime)
  writeFileSync(join(dir, 'marker-ref'), 'ref\n')
  utimesSync(join(dir, 'marker-ref'), markerTime, markerTime)
  writeFileSync(join(runtime, 'DEPLOY_SOURCE.txt'), 'source=origin/main@previous-release\n')
  writeFileSync(join(runtime, 'services/api/.env'), 'DATABASE_URL="postgres://drill@127.0.0.1/drill"\n')
  writeFileSync(join(runtime, 'services/api/storage/uploaded-before.txt'), 'before\n')
  // 旧运行目录的依赖标记与新装的同为 4 字节：若恢复还按「大小 + 修改时间」快速比对，
  // 同一秒内写出的两份会被当成没变而跳过（CI 机器快时必然撞上）。恢复必须逐个覆盖。

  mkdirSync(backups)
  const now = Date.now() / 1000
  for (let i = 0; i < oldGroups; i += 1) {
    const stem = join(backups, `pre-old${i}-2026090${i}T000000Z`)
    writeFileSync(`${stem}.dump`, 'old dump\n')
    mkdirSync(`${stem}.runtime`)
    writeFileSync(`${stem}.migrations.log`, 'old migrations\n')
    // 越小的 i 越旧；迁移日志比同组 dump 晚写一点，正是它单算一组时会挤掉别人的情形
    const t = now - 86400 * (oldGroups - i)
    utimesSync(`${stem}.dump`, t, t)
    utimesSync(`${stem}.runtime`, t, t)
    utimesSync(`${stem}.migrations.log`, t + 60, t + 60)
  }
  return { dir, bin, checkout, runtime, backups, sha, calls: join(dir, 'calls.log'), markerRef: join(dir, 'marker-ref') }
}

function runDeploy(box, extraEnv, options = {}) {
  const env = {
    ...process.env,
    PATH: `${box.bin}:${process.env.PATH}`,
    API_RELEASE_ENABLED: 'true',
    TARGET_SHA: box.sha,
    CI_RUN: 'drill',
    DEPLOY_PATH: box.checkout,
    DEPLOY_SCOPE: 'api-only',
    CONTROL_PLANE_DEPLOY_HELPER_SHA256: 'drill',
    PRINT_REQUIRE_PII_SCAN: 'true',
    DEPLOY_API_DIR: box.runtime,
    DEPLOY_PM2_NAME: 'drill-api',
    DEPLOY_BACKUP_ROOT: box.backups,
    DEPLOY_HEALTH_URL: 'http://drill.invalid/api/v1/health/ready',
    DEPLOY_HEALTH_ATTEMPTS: '2',
    DEPLOY_HEALTH_DELAY_SECONDS: '0',
    DEPLOY_MIN_FREE_MARGIN_MB: '0',
    DEPLOY_BACKUP_KEEP: '3',
    DRILL_DIR: box.dir,
    DRILL_CALLS: box.calls,
    DRILL_DEPLOY: box.checkout,
    DRILL_RUNTIME: box.runtime,
    DRILL_MARKER_REF: box.markerRef,
    // 固定用 C 语言环境跑：服务器经 SSH 执行时语言环境不由我们保证，脚本必须在最差情况下也正确
    LC_ALL: 'C',
    LANG: 'C',
    ...extraEnv,
  }
  if (!Object.prototype.hasOwnProperty.call(extraEnv, 'BASH_ENV')) delete env.BASH_ENV
  const result = spawnSync('bash', [deployScript], {
    env,
    encoding: 'utf8',
    timeout: options.timeout,
    killSignal: options.killSignal || 'SIGTERM',
  })
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8') : ''
  return {
    code: result.status,
    signal: result.signal,
    out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    calls,
    pm2Restarts: (calls.match(/^pm2 restart /gm) ?? []).length,
  }
}

function readSignalLogs(backups) {
  if (!existsSync(backups)) return ''
  return readdirSync(backups)
    .filter((name) => name.startsWith('release-signal-') && name.endsWith('.log'))
    .map((name) => readFileSync(join(backups, name), 'utf8'))
    .join('\n')
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '(缺失)')
const groupsOf = (backups) => {
  const stems = new Set(readdirSync(backups).map((name) => name.replace(/\.(dump\.partial|runtime\.partial|migrations\.log|dump|runtime|ok)$/, '')))
  return [...stems].map((stem) => ({
    stem,
    complete: ['dump', 'runtime', 'migrations.log'].every((ext) => existsSync(join(backups, `${stem}.${ext}`))),
  }))
}

const boxes = []
try {
  // 1. 就绪检查通过
  {
    const box = makeSandbox(); boxes.push(box)
    // 跳过变量写成 first-install 以外的值不算跳过：预检照常执行
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DEPLOY_SKIP_LEGAL_DOCS_PREFLIGHT: 'true' })
    check(r.code === 0, '场景 1：就绪检查通过时发布成功', `退出码 ${r.code}\n${r.out.slice(-800)}`)
    check(r.calls.includes('legal-preflight --base-url http://drill.invalid/api/v1\n'),
      '场景 1：3d 法务文档预检照常执行，地址由就绪检查地址推出（跳过变量不是 first-install 不算跳过）', r.calls)
    check(read(join(box.runtime, 'VERSION')) === 'new-release' && read(join(box.runtime, 'node_modules/marker')) === 'new',
      '场景 1：运行目录换成新版本（代码与依赖）')
    check(read(join(box.runtime, 'DEPLOY_SOURCE.txt')).includes(`source=origin/main@${box.sha}`), '场景 1：发布指针指向目标提交')
    check(r.pm2Restarts === 1, '场景 1：PM2 只重启一次', `实际 ${r.pm2Restarts} 次`)
    const names = readdirSync(box.backups)
    const dumps = names.filter((name) => name.includes(box.sha) && name.endsWith('.dump'))
    check(dumps.length === 1 && read(join(box.backups, dumps[0])) === 'drill-dump' && !names.some((name) => name.includes('.partial')),
      '场景 1：成功后只有正式 .dump，没有 .partial', names.join(', '))
    check(/DISK_AVAIL_MB_BEFORE=\d+ DISK_AVAIL_MB_AFTER=\d+/.test(r.out) && r.out.includes('DISK_SNAPSHOT_BEFORE') && r.out.includes('DISK_SNAPSHOT_AFTER') && r.out.includes('ROOT_AVAIL_MB=') && r.out.includes('BACKUP_USED_MB='),
      '场景 1：开头和摘要都打印根分区、备份目录可用空间与备份目录占用', r.out.slice(-500))
    check(r.out.includes('FLOOR_MB=10240'), '场景 1：空间下限默认 10240MB', r.out.match(/FLOOR_MB=\d+/)?.[0] ?? '')
    check(r.out.includes('::warning::pm2-logrotate 未安装') && r.out.includes('services/api/scripts/pm2-logrotate-setup.sh') && !r.calls.includes('pm2 install'),
      '场景 1：没装 pm2-logrotate 时只告警并指出安装脚本，不安装', r.out.slice(-400))
  }
  // 2. 就绪检查一直失败 → 恢复并重启回旧版
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'old-only' })
    check(r.code !== 0, '场景 2：就绪失败时脚本以失败结束', `退出码 ${r.code}`)
    check(read(join(box.runtime, 'VERSION')) === 'old' && read(join(box.runtime, 'node_modules/marker')) === 'old',
      '场景 2：运行目录的代码与依赖恢复到发布前', `VERSION=${read(join(box.runtime, 'VERSION'))} marker=${read(join(box.runtime, 'node_modules/marker'))}`)
    check(read(join(box.runtime, 'DEPLOY_SOURCE.txt')) === 'source=origin/main@previous-release', '场景 2：发布指针保持上一版')
    check(!read(join(box.runtime, 'services/api/.env')).includes('PRINT_REQUIRE_PRINTER_ONLINE'), '场景 2：.env 恢复到发布前（3b 追加的键被撤回）')
    check(existsSync(join(box.runtime, 'services/api/storage/uploaded-during-release.txt')) && existsSync(join(box.runtime, 'services/api/storage/uploaded-before.txt')),
      '场景 2：恢复不碰用户上传目录（发布期间新传的文件还在）')
    check(r.pm2Restarts === 2, '场景 2：PM2 重启新版一次、回退后再重启旧版一次', `实际 ${r.pm2Restarts} 次`)
    check(r.out.includes('回退后的就绪检查通过'), '场景 2：回退后再做就绪检查并报告结果')
    check(groupsOf(box.backups).every((group) => group.complete), '场景 2：失败时本次备份完整保留（.dump / .runtime / .migrations.log）')
  }
  // 3. 迁移失败（PM2 还没重启）→ 恢复运行目录，不重启
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_MIGRATION_FAIL: '1' })
    check(r.code !== 0, '场景 3：迁移失败时脚本以失败结束', `退出码 ${r.code}`)
    check(read(join(box.runtime, 'VERSION')) === 'old' && read(join(box.runtime, 'node_modules/marker')) === 'old',
      '场景 3：运行目录恢复到发布前（与仍在运行的旧进程一致）')
    check(r.pm2Restarts === 0, '场景 3：PM2 还没重启过，恢复后也不重启', `实际 ${r.pm2Restarts} 次`)
    check(r.out.includes('线上进程尚未重启'), '场景 3：说明线上进程仍是发布前版本')
  }
  // 5. 就绪之后的收尾失败（写发布指针失败）：发布已成功，只告警，绝不能把健康的新版本回退掉
  {
    const box = makeSandbox({ pointerUnwritable: true }); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always' })
    check(r.code === 0 && read(join(box.runtime, 'VERSION')) === 'new-release' && r.pm2Restarts === 1,
      '场景 5：就绪后写发布指针失败只告警，不回退、不重启', `退出码 ${r.code} VERSION=${read(join(box.runtime, 'VERSION'))} PM2 ${r.pm2Restarts} 次`)
    check(r.out.includes('DEPLOY_SOURCE.txt 写入失败'), '场景 5：告警写明发布指针没写上，需要人工补写')
  }
  // 6. 法务文档预检失败（缺隐私政策）→ 在备份之前中止，线上一样不动
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_LEGAL_PREFLIGHT: 'missing' })
    check(r.code !== 0 && r.out.includes('法务文档预检失败'), '场景 6：缺法务文档时发布以失败结束并说明原因', `退出码 ${r.code}\n${r.out.slice(-600)}`)
    check(!existsSync(box.backups) || readdirSync(box.backups).length === 0, '场景 6：没有做任何备份（中止在 pg_dump 之前）', readdirSync(box.backups).join(', '))
    check(!r.calls.includes('db:pg:deploy') && r.pm2Restarts === 0, '场景 6：没有迁移、没有重启 PM2')
    check(read(join(box.runtime, 'VERSION')) === 'old' && read(join(box.runtime, 'DEPLOY_SOURCE.txt')) === 'source=origin/main@previous-release',
      '场景 6：运行目录与发布指针都保持发布前')
  }
  // 7. 新服务器首装：显式 first-install 跳过法务预检，日志里必须有告警
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_LEGAL_PREFLIGHT: 'missing', DEPLOY_SKIP_LEGAL_DOCS_PREFLIGHT: 'first-install' })
    check(r.code === 0 && !r.calls.includes('legal-preflight'), '场景 7：first-install 时不调用法务预检、发布照常完成', `退出码 ${r.code}`)
    check(r.out.includes('::warning::已跳过法务文档预检'), '场景 7：跳过时日志里有醒目告警')
  }
  // 4. 备份清理按组保留
  {
    const box = makeSandbox({ oldGroups: 4 }); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always' })
    const groups = groupsOf(box.backups)
    const kept = groups.map((group) => group.stem).sort()
    check(r.code === 0 && groups.length === 3 && groups.every((group) => group.complete),
      '场景 4：按组保留最近 3 组，每组三件齐全', `剩下 ${JSON.stringify(groups)}`)
    check(kept.some((stem) => stem.includes(box.sha)) && kept.some((stem) => stem.includes('old3')) && kept.some((stem) => stem.includes('old2')),
      '场景 4：保留的是本次与最近两次，迁移日志没有单算一组挤掉上一次的备份', `保留 ${kept.join(', ')}`)
  }
  // 磁盘 a：空间不够 → 先清理 → 够了继续
  {
    const box = makeSandbox({ oldGroups: 5 }); boxes.push(box)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_DF_AVAIL_MB: '100',
      DRILL_DF_AVAIL_AFTER_PNPM_MB: '4000',
      DRILL_DF_AVAIL_AFTER_PRUNE_MB: '20000',
    })
    check(r.code === 0, '磁盘 a：清理后空间够了，发布继续', `退出码 ${r.code}\n${r.out.slice(-800)}`)
    check(r.calls.includes('pnpm store prune') && r.out.includes('pnpm store prune 前可用 100MB') && r.out.includes('pnpm store prune 后可用 4000MB'),
      '磁盘 a：pnpm store prune 打印释放前后的可用 MB', r.out)
    check(r.out.includes('旧备份清理前可用 4000MB') && r.out.includes('旧备份清理后可用 20000MB') && r.out.includes('DEPLOY_BACKUP_KEEP=3'),
      '磁盘 a：复用 prune_old_backups，并打印清理前后的可用 MB')
    check(r.out.includes('DISK_AVAIL_MB_BEFORE=100 DISK_AVAIL_MB_AFTER=20000'),
      '磁盘 a：摘要里的前后可用 MB 是清理前与发布结束时的数', r.out.match(/DISK_AVAIL_MB_BEFORE=\d+ DISK_AVAIL_MB_AFTER=\d+/)?.[0] ?? '')
  }
  // 磁盘 b：清理后仍不够 → 中止，不写备份
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '100' })
    check(r.code !== 0 && !r.calls.includes('pg_dump') && !r.calls.includes('install --frozen-lockfile'),
      '磁盘 b：清理后仍不够就中止，且没有构建、没有 pg_dump', `退出码 ${r.code}\n${r.calls}`)
    check(readdirSync(box.backups).length === 0 && !r.out.includes('.partial'),
      '磁盘 b：未写任何备份', readdirSync(box.backups).join(', '))
    check(r.out.includes('Server Cleanup (backups / pnpm store / journal)') && r.out.includes('dry_run=true') && r.out.includes('REQUIRED_MB=') && r.out.includes('FLOOR_MB=10240'),
      '磁盘 b：报错同时打出公式门槛、10GB 下限，并指向 Server Cleanup 的 dry-run', r.out.slice(-700))
    check(read(join(box.runtime, 'VERSION')) === 'old', '磁盘 b：运行目录保持发布前')
  }
  // 磁盘 c：API 目录很小，但可用低于 10GB 下限也中止
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '9000' })
    const req = Number(r.out.match(/REQUIRED_MB=(\d+)/)?.[1])
    const floor = Number(r.out.match(/FLOOR_MB=(\d+)/)?.[1])
    const avail = Number(r.out.match(/可用 (\d+)MB/)?.[1])
    check(r.code !== 0 && !r.calls.includes('pg_dump') && floor === 10240 && req < avail && avail < floor,
      '磁盘 c：可用高于公式所需、低于 10GB 下限时仍中止', `退出码 ${r.code} avail=${avail} required=${req} floor=${floor}\n${r.out.slice(-500)}`)
  }
  // 磁盘 d：关掉发布前清理就直接中止，旧备份不动
  {
    const box = makeSandbox({ oldGroups: 4 }); boxes.push(box)
    const before = readdirSync(box.backups).sort()
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_DF_AVAIL_MB: '100',
      DEPLOY_PRE_GATE_SAFE_CLEANUP: 'false',
    })
    check(r.code !== 0 && r.out.includes('DEPLOY_PRE_GATE_SAFE_CLEANUP=false') && !r.calls.includes('pnpm store prune') && !r.calls.includes('pg_dump'),
      '磁盘 d：DEPLOY_PRE_GATE_SAFE_CLEANUP=false 时不清理、直接中止', `退出码 ${r.code}\n${r.calls}`)
    check(readdirSync(box.backups).sort().join() === before.join(),
      '磁盘 d：旧备份一组都没删', readdirSync(box.backups).join(', '))
  }
  // 磁盘 f：pg_dump / pg_restore 失败不留 .partial；cp 失败不留 .runtime.partial
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PG_DUMP_FAIL: '1' })
    const names = readdirSync(box.backups)
    check(r.code !== 0 && r.out.includes('pg_dump 失败，已删除不完整备份') && !names.some((name) => name.includes('.partial') || name.endsWith('.dump')),
      '磁盘 f：pg_dump 失败不留 .partial，也没有正式 .dump', `退出码 ${r.code} ${names.join(', ')}\n${r.out.slice(-400)}`)
  }
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PG_RESTORE_FAIL: '1' })
    const names = readdirSync(box.backups)
    check(r.code !== 0 && r.out.includes('备份可读校验失败，已删除不完整备份') && !names.some((name) => name.includes('.partial') || name.endsWith('.dump')),
      '磁盘 f：pg_restore -l 失败不留 .partial', `退出码 ${r.code} ${names.join(', ')}`)
  }
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PG_DUMP_KILL: '1' }, { timeout: 8000 })
    const names = readdirSync(box.backups)
    check(r.code !== 0 && !names.some((name) => name.includes('.partial') || (name.includes(box.sha) && name.endsWith('.dump'))),
      '磁盘 f：pg_dump 过程中被中断不留 .partial', `退出码 ${r.code} signal=${r.code} ${names.join(', ')}\n${r.out.slice(-400)}`)
  }
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_CP_FAIL: '1' })
    const names = readdirSync(box.backups)
    const dump = names.filter((name) => name.includes(box.sha) && name.endsWith('.dump'))
    check(r.code !== 0 && r.out.includes('运行目录备份失败，已删除不完整备份') && dump.length === 1 && !names.some((name) => name.includes('.partial')) && !r.out.includes('开始把运行目录恢复'),
      '磁盘 f：运行目录拷贝失败删掉 .runtime.partial，且回退陷阱尚未生效', `退出码 ${r.code} ${names.join(', ')}\n${r.out.slice(-500)}`)
    check(read(join(box.runtime, 'VERSION')) === 'old' && r.pm2Restarts === 0, '磁盘 f：拷贝失败时运行目录未改、PM2 未重启')
  }
  // pm2-logrotate 已安装：只报告，不告警、不安装
  {
    const box = makeSandbox(); boxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PM2_LOGROTATE: 'installed' })
    check(r.code === 0 && r.out.includes('PM2_LOGROTATE=installed') && !r.out.includes('::warning::pm2-logrotate 未安装') && !r.calls.includes('pm2 install'),
      '摘要：pm2-logrotate 已安装时只读确认，不告警也不安装', r.out.slice(-400))
  }
} catch (error) {
  fail(`演练无法运行：${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const box of boxes) rmSync(box.dir, { recursive: true, force: true })
}

// ── deploy.yml 三端静态目录：按标记抽出这段脚本，替换 secrets 与服务器路径，在沙箱里真跑 ─────────
function staticBlock(paths) {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line.includes('echo "=== 备份并准备三端静态目录 ==="'))
  let end = lines.findIndex((line, index) => index > start && line.includes('xargs -r rm -rf --'))
  if (start < 0 || end < 0) throw new Error('deploy.yml 里找不到静态目录那一段的起止标记')
  const block = lines.slice(start, end + 1)
  const indent = block[0].match(/^\s*/)[0].length
  return block.map((line) => line.slice(Math.min(indent, line.match(/^\s*/)[0].length))).join('\n')
    .replace(/\$\{\{ secrets\.DEPLOY_WEB_ROOT \}\}/g, paths.kiosk)
    .replace('STATIC_BACKUP_ROOT="/srv/ai-job-print-static-backups"', `STATIC_BACKUP_ROOT="${paths.backups}"`)
}

function staticSandbox({ oldBackups = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'static-drill-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  makeShims(bin)
  // cp 替身：切换某一端时（目标是这端的线上目录）失败一次，之后放行（恢复要能拷回去）
  writeExec(join(bin, 'cp'), `#!/usr/bin/env bash
last="\${!#}"
if [ -n "\${DRILL_CP_FAIL_TO:-}" ] && [ "\${last%/}" = "\${DRILL_CP_FAIL_TO%/}" ] && [ ! -f "$DRILL_DIR/cp-failed-once" ]; then
  touch "$DRILL_DIR/cp-failed-once"; echo "drill: cp 注入失败" >&2; exit 1
fi
exec /bin/cp "$@"
`)
  writeExec(join(bin, 'nginx'), '#!/usr/bin/env bash\n[ "${DRILL_NGINX_FAIL:-}" = 1 ] && exit 1\nexit 0\n')
  writeExec(join(bin, 'systemctl'), '#!/usr/bin/env bash\n[ "${DRILL_NGINX_FAIL:-}" = 1 ] && exit 1\nexit 0\n')
  const checkout = join(dir, 'checkout')
  const live = { kiosk: join(dir, 'www/kiosk'), admin: join(dir, 'www/admin'), partner: join(dir, 'www/partner') }
  for (const app of ['kiosk', 'admin', 'partner']) {
    mkdirSync(join(checkout, 'apps', app, 'dist'), { recursive: true })
    writeFileSync(join(checkout, 'apps', app, 'dist', 'index.html'), `new-${app}-release\n`)
    mkdirSync(live[app], { recursive: true })
    writeFileSync(join(live[app], 'index.html'), `old-${app}\n`)
  }
  const backups = join(dir, 'static-backups')
  mkdirSync(backups)
  for (let i = 0; i < oldBackups; i += 1) {
    const d = join(backups, `2026090${i}T000000Z-old${i}`)
    mkdirSync(d)
    const t = new Date(Date.UTC(2026, 8, 1 + i))
    utimesSync(d, t, t)
  }
  const script = join(dir, 'static.sh')
  writeFileSync(script, `set -euo pipefail\ncd "${checkout}"\n${staticBlock({ kiosk: live.kiosk, backups })}\necho STATIC_OK\n`)
  return { dir, bin, live, backups, script }
}

function runStatic(box, extraEnv) {
  const env = {
    ...process.env,
    PATH: `${box.bin}:${process.env.PATH}`,
    LC_ALL: 'C',
    LANG: 'C',
    EXPECTED_SHA: 'drillsha',
    RUNNER_TEMP: join(box.dir, 'runner-temp'),
    DEPLOY_ADMIN_WEB_ROOT: box.live.admin,
    DEPLOY_PARTNER_WEB_ROOT: box.live.partner,
    DRILL_DIR: box.dir,
    ...extraEnv,
  }
  mkdirSync(env.RUNNER_TEMP, { recursive: true })
  const result = spawnSync('bash', [box.script], { env, encoding: 'utf8' })
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` }
}

const staticBoxes = []
try {
  const content = (box) => ['kiosk', 'admin', 'partner'].map((app) => read(join(box.live[app], 'index.html'))).join(' ')
  {
    const box = staticSandbox({ oldBackups: 4 }); staticBoxes.push(box)
    const r = runStatic(box, {})
    check(r.code === 0 && content(box) === 'new-kiosk-release new-admin-release new-partner-release', '静态 1：切换成功，三端都是新版本', `退出码 ${r.code} 内容 ${content(box)}\n${r.out.slice(-600)}`)
    check(readdirSync(box.backups).length === 3, '静态 1：成功后旧备份按组清理到 3 组', `剩 ${readdirSync(box.backups).length} 组`)
  }
  {
    const box = staticSandbox({ oldBackups: 4 }); staticBoxes.push(box)
    const r = runStatic(box, { DRILL_CP_FAIL_TO: box.live.admin })
    check(r.code !== 0, '静态 2：admin 切换中途失败时以失败结束', `退出码 ${r.code}`)
    check(content(box) === 'old-kiosk old-admin old-partner', '静态 2：已切换的 kiosk 与切到一半的 admin 都恢复成旧版本（函数内失败也要触发恢复）', `实际 ${content(box)}\n${r.out.slice(-600)}`)
    check(readdirSync(box.backups).length === 5, '静态 2：失败时本次备份保留、旧备份不清理', `剩 ${readdirSync(box.backups).length} 组`)
  }
  {
    const box = staticSandbox({ oldBackups: 4 }); staticBoxes.push(box)
    const r = runStatic(box, { DRILL_NGINX_FAIL: '1' })
    check(r.code !== 0 && content(box) === 'old-kiosk old-admin old-partner', '静态 3：nginx 重载失败时三端都恢复成旧版本', `退出码 ${r.code} 内容 ${content(box)}`)
    check(readdirSync(box.backups).length === 5, '静态 3：重载失败时不清理任何备份', `剩 ${readdirSync(box.backups).length} 组`)
  }
} catch (error) {
  fail(`静态目录演练无法运行：${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const box of staticBoxes) rmSync(box.dir, { recursive: true, force: true })
}

// ── 从 workflow 抽出真实片段再跑：分组、构建前闸门、预检输出都随源码变红 ─────────
function extractBetween(text, startMarker, endMarker) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.includes(startMarker))
  const end = lines.findIndex((line, index) => index > start && line.includes(endMarker))
  if (start < 0 || end < 0) throw new Error(`找不到片段：${startMarker} → ${endMarker}`)
  const block = lines.slice(start, end)
  const indent = (block[0].match(/^\s*/) ?? [''])[0].length
  return block.map((line) => line.slice(Math.min(indent, (line.match(/^\s*/) ?? [''])[0].length))).join('\n')
}

function runFragment(body, env) {
  const dir = mkdtempSync(join(tmpdir(), 'fragment-drill-'))
  const script = join(dir, 'fragment.sh')
  writeFileSync(script, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`)
  chmodSync(script, 0o755)
  const result = spawnSync('bash', [script], {
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', ...env },
    encoding: 'utf8',
  })
  return {
    dir,
    code: result.status ?? 1,
    status: result.status,
    signal: result.signal,
    out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

const cleanupWorkflow = readFileSync(join(root, '.github/workflows/server-cleanup.yml'), 'utf8')
const precheckWorkflow = readFileSync(join(root, '.github/workflows/deploy-precheck.yml'), 'utf8')
const fragmentDirs = []
try {
  const fullBuildAt = workflow.indexOf('=== full 发布构建前磁盘检查 ===')
  const pnpmInstallAt = workflow.indexOf('pnpm install --frozen-lockfile')
  const kioskBuildAt = workflow.indexOf('pnpm build:kiosk:production')
  check(fullBuildAt > 0 && fullBuildAt < pnpmInstallAt && pnpmInstallAt < kioskBuildAt,
    '磁盘 h：full 发布的构建前空间检查在 pnpm install 与三端构建之前')

  const buildDisk = extractBetween(workflow, '=== full 发布构建前磁盘检查 ===', '=== 安装依赖 ===')
  check(buildDisk.includes('pnpm store prune') && !buildDisk.includes('journalctl'),
    '磁盘 h：构建前检查不够时可以 pnpm store prune，不碰 journal')
  const dfBin = mkdtempSync(join(tmpdir(), 'df-shim-'))
  fragmentDirs.push(dfBin)
  writeExec(join(dfBin, 'df'), `#!/usr/bin/env bash
avail="\${DRILL_DF_AVAIL_MB:-0}"
printf '%s\\n' "Filesystem 1024-blocks Used Available Capacity Mounted on"
printf '%s\\n' "drill 100000000 1000 \${avail} 1% /"
`)
  const lowDisk = runFragment(buildDisk, { PATH: `${dfBin}:/usr/bin:/bin`, DRILL_DF_AVAIL_MB: '100' })
  fragmentDirs.push(lowDisk.dir)
  check(lowDisk.code !== 0 && lowDisk.out.includes('构建前磁盘空间不足') && lowDisk.out.includes('未安装依赖') && lowDisk.out.includes('pnpm 不可用，跳过 store prune') && lowDisk.out.includes('dry_run=false、keep=3、prune_pnpm=true、vacuum_journal=false'),
    '磁盘 h：可用低于 10GB 时先跳过不可用的 pnpm，仍不够就在安装依赖之前失败', `退出码 ${lowDisk.code}\n${lowDisk.out}`)
  const okDisk = runFragment(buildDisk, { PATH: `${dfBin}:/usr/bin:/bin`, DRILL_DF_AVAIL_MB: '50000' })
  fragmentDirs.push(okDisk.dir)
  check(okDisk.code === 0 && okDisk.out.includes('构建前磁盘空间够用') && okDisk.out.includes('FULL_BUILD_DISK_AVAIL_MB=50000'),
    '磁盘 h：可用不低于下限时只打印结果并继续', `退出码 ${okDisk.code}\n${okDisk.out}`)

  const groupDir = mkdtempSync(join(tmpdir(), 'cleanup-groups-'))
  fragmentDirs.push(groupDir)
  const backupDir = join(groupDir, 'bk')
  mkdirSync(backupDir)
  const findBin = join(groupDir, 'bin')
  mkdirSync(findBin)
  writeFindShim(findBin)
  const touchGroup = (stem, when) => {
    writeFileSync(join(backupDir, `${stem}.dump`), 'dump\n')
    mkdirSync(join(backupDir, `${stem}.runtime`))
    writeFileSync(join(backupDir, `${stem}.migrations.log`), 'migrations\n')
    const stamp = new Date(when)
    for (const name of [`${stem}.dump`, `${stem}.runtime`, `${stem}.migrations.log`]) {
      utimesSync(join(backupDir, name), stamp, stamp)
    }
  }
  touchGroup('pre-old', '2026-01-02T00:00:00Z')
  touchGroup('pre-new', '2026-03-04T00:00:00Z')
  const stemBlock = extractBetween(cleanupWorkflow, 'STEMS="$(find "$BK"', 'TOTAL="$(echo "$STEMS"')
  const grouped = runFragment(`${stemBlock}\nprintf '%s\\n' "$STEMS"\n`, {
    PATH: `${findBin}:/usr/bin:/bin`,
    BK: backupDir,
  })
  fragmentDirs.push(grouped.dir)
  const stems = grouped.out.trim().split('\n').filter(Boolean)
  check(grouped.code === 0 && stems.length === 2 && stems[0] === 'pre-new' && stems[1] === 'pre-old' && stems.every((stem) => !stem.includes('migrations')),
    '磁盘 g：.migrations.log 归进同一 stem，不单占一组', `退出码 ${grouped.code} stems=${stems.join(',')}\n${grouped.out}`)

  const sizeLine = cleanupWorkflow.split('\n').map((line) => line.trim()).find((line) => line.startsWith('SZ="$(du -sm'))
  if (!sizeLine) throw new Error('server-cleanup.yml 里找不到备份组大小统计')
  const duBin = join(groupDir, 'du-bin')
  mkdirSync(duBin)
  const duLog = join(groupDir, 'du.log')
  writeExec(join(duBin, 'du'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${duLog}"
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    *) printf '%s\\n' "1 $arg" ;;
  esac
done
`)
  const sized = runFragment(`stem=pre-old\n${sizeLine}\nprintf '%s\\n' "$SZ"\n`, {
    PATH: `${duBin}:/usr/bin:/bin`,
    BK: backupDir,
  })
  fragmentDirs.push(sized.dir)
  const duArgs = existsSync(duLog) ? readFileSync(duLog, 'utf8') : ''
  check(sized.code === 0 && duArgs.includes(`${backupDir}/pre-old.migrations.log`) && /^\d+$/.test(sized.out.trim()),
    '磁盘 g：大小统计把 .migrations.log 算进这一组', `退出码 ${sized.code} du=${duArgs.trim()} SZ=${sized.out.trim()}`)

  const rmLine = cleanupWorkflow.split('\n').map((line) => line.trim()).find((line) => line.startsWith('rm -rf -- "$BK"'))
  if (!rmLine) throw new Error('server-cleanup.yml 里找不到备份组删除')
  const removed = runFragment(`stem=pre-old\n${rmLine}\n`, { BK: backupDir, PATH: '/usr/bin:/bin' })
  fragmentDirs.push(removed.dir)
  check(removed.code === 0 && !existsSync(join(backupDir, 'pre-old.migrations.log')) && !existsSync(join(backupDir, 'pre-old.dump')) && existsSync(join(backupDir, 'pre-new.migrations.log')),
    '磁盘 g：删除一组时连 .migrations.log 一起删，另一组保留', `退出码 ${removed.code} 剩下 ${readdirSync(backupDir).join(',')}`)

  check(precheckWorkflow.includes('STATIC_BACKUP_ROOT="/srv/ai-job-print-static-backups"') && workflow.includes('STATIC_BACKUP_ROOT="/srv/ai-job-print-static-backups"'),
    '预检：静态备份根目录与 deploy.yml 的默认值相同')
  const precheckBlock = extractBetween(precheckWorkflow, '=== 11. 静态发布备份与残留 bundle（只读）===', '=== 完成：以上均为只读探测')
    .replace('STATIC_BACKUP_ROOT="/srv/ai-job-print-static-backups"', `STATIC_BACKUP_ROOT="${join(groupDir, 'static-backups')}"`)
    .replaceAll('/tmp/release.bundle', join(groupDir, 'release.bundle'))
  const staticRoot = join(groupDir, 'static-backups')
  mkdirSync(staticRoot)
  mkdirSync(join(staticRoot, '20260102T000000Z-old'))
  mkdirSync(join(staticRoot, '20260304T000000Z-new'))
  writeFileSync(join(staticRoot, '20260102T000000Z-old', 'blob'), Buffer.alloc(2 * 1024 * 1024, 1))
  utimesSync(join(staticRoot, '20260102T000000Z-old'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))
  utimesSync(join(staticRoot, '20260304T000000Z-new'), new Date('2026-03-04T00:00:00Z'), new Date('2026-03-04T00:00:00Z'))
  const bundlePath = join(groupDir, 'release.bundle')
  writeFileSync(bundlePath, Buffer.alloc(2 * 1024 * 1024, 2))
  const precheckHit = runFragment(precheckBlock, { PATH: `${findBin}:/usr/bin:/bin` })
  fragmentDirs.push(precheckHit.dir)
  const metric = (key) => precheckHit.out.match(new RegExp(`${key}=([^\\s]+)`))?.[1] ?? ''
  check(precheckHit.code === 0 && Number(metric('STATIC_BACKUP_GROUP_COUNT')) === 2 && metric('STATIC_BACKUP_OLDEST_DATE') === '2026-01-02' && Number(metric('STATIC_BACKUP_SIZE_MB')) >= 1,
    '预检：静态备份报出大小、组数和最老一组的日期', `退出码 ${precheckHit.code}\n${precheckHit.out}`)
  check(metric('RELEASE_BUNDLE_PRESENT') === 'yes' && Number(metric('RELEASE_BUNDLE_SIZE_MB')) >= 1,
    '预检：/tmp/release.bundle 存在时报出大小', precheckHit.out)
  rmSync(bundlePath)
  const precheckMiss = runFragment(precheckBlock, { PATH: `${findBin}:/usr/bin:/bin` })
  fragmentDirs.push(precheckMiss.dir)
  const missingBundle = (key) => precheckMiss.out.match(new RegExp(`${key}=([^\\s]+)`))?.[1] ?? ''
  check(precheckMiss.code === 0 && missingBundle('RELEASE_BUNDLE_PRESENT') === 'no' && missingBundle('RELEASE_BUNDLE_SIZE_MB') === '0',
    '预检：/tmp/release.bundle 不存在时报 no 且大小为 0', precheckMiss.out)
} catch (error) {
  fail(`磁盘分组、构建前检查或预检演练无法运行：${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const dir of fragmentDirs) rmSync(dir, { recursive: true, force: true })
}

// ── 复核 #1118：信号覆盖整个发布、数字校验、partial 不占名额、.ok 锚点、构建前 10GB、失败也删 bundle ──
check(!/trap - (HUP|INT|TERM|PIPE)/.test(releaseText) && !releaseText.includes('trap - INT TERM'),
  '发布脚本中途不执行 trap - 清掉 HUP/INT/TERM/PIPE')
check(
  releaseText.includes("trap 'on_release_signal HUP' HUP") &&
    releaseText.includes("trap 'on_release_signal INT' INT") &&
    releaseText.includes("trap 'on_release_signal TERM' TERM") &&
    releaseText.includes("trap 'on_release_signal PIPE' PIPE"),
  'HUP、INT、TERM、PIPE 挂在同一个 on_release_signal 上',
)
check(
  releaseText.indexOf("trap 'on_release_signal PIPE' PIPE") >= 0 &&
    releaseText.indexOf("trap 'on_release_signal PIPE' PIPE") < releaseText.indexOf('echo "=== 0. 校验源码位于目标提交 ==="'),
  '信号陷阱在步骤 0 之前注册',
)
check(releaseText.includes('release_signal_phase=pre'), '信号有 pre 阶段，收到信号时只退出')
{
  const restoreAt = releaseText.indexOf('restore_runtime_and_exit() {')
  const restoreBody = releaseText.slice(restoreAt, releaseText.indexOf('release_signal_phase=restore'))
  check(restoreBody.includes("trap '' HUP INT TERM PIPE") && restoreBody.includes('set +e'),
    '回退一开始就忽略 HUP/INT/TERM/PIPE，并关掉 errexit')
  const readyAt = releaseText.indexOf('API readiness OK')
  const ignoreAt = releaseText.indexOf("trap '' HUP INT TERM PIPE", readyAt)
  const sourceAt = releaseText.indexOf('cat > "$RUNTIME_ROOT/DEPLOY_SOURCE.txt"', readyAt)
  const okWriteAt = releaseText.indexOf("printf 'ok\\n' > \"$BACKUP_PREFIX.ok\"", readyAt)
  check(readyAt >= 0 && ignoreAt > readyAt && sourceAt > ignoreAt && okWriteAt > sourceAt,
    'committed 先屏蔽信号，再写 DEPLOY_SOURCE.txt，再写 .ok')
}
check(releaseText.includes('最近一次成功发布前的快照（回退锚点）') && !releaseText.includes('当成最近一次成功发布。'),
  '发布脚本把 .ok 称为最近一次成功发布前的快照（回退锚点）')
check(/\nconcurrency:\n  group: production-deploy\n  cancel-in-progress: false\n/.test(cleanupWorkflow),
  'server-cleanup 与生产发布同一并发组，不取消进行中的任务')
check(releaseText.includes('trap cleanup_env_tmp EXIT'), '清 .env 临时文件的 EXIT trap 仍在')
check(releaseText.includes('release_signal_phase=restore') && releaseText.includes('release_signal_phase=committed'),
  '回退陷阱生效与健康检查通过后各有一个阶段标记')
check(!releaseText.split('\n').some((line) => !line.trim().startsWith('#') && line.includes('pm2 ls |')),
  'pm2 ls 先存进变量，不进管道')
{
  const buildDefaultAt = workflow.indexOf('DEPLOY_MIN_FREE_FLOOR_MB:-10240')
  const installAfterBuild = workflow.indexOf('pnpm install --frozen-lockfile', Math.max(buildDefaultAt, 0))
  check(buildDefaultAt > 0 && installAfterBuild > buildDefaultAt && !workflow.includes('DEPLOY_MIN_FREE_BUILD_MB'),
    '构建前门槛与发布脚本相同，默认 10240，并且写在 pnpm install 之前')
}

const reviewBoxes = []
const reviewDirs = []
try {
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_RUNTIME_INSTALL_SIGNAL: 'TERM' }, { timeout: 20000, killSignal: 'SIGKILL' })
    const names = readdirSync(box.backups)
    const log = readSignalLogs(box.backups)
    check(r.code === 143, '信号 1：回退陷阱生效后收到 TERM，退出码 143', `退出码 ${r.code} signal=${r.signal}\n${log.slice(-700)}`)
    check(read(join(box.runtime, 'VERSION')) === 'old' && read(join(box.runtime, 'node_modules/marker')) === 'old',
      '信号 1：运行目录回到发布前', `VERSION=${read(join(box.runtime, 'VERSION'))} marker=${read(join(box.runtime, 'node_modules/marker'))}`)
    check(log.includes('开始把运行目录恢复') && log.includes('线上进程尚未重启'),
      '信号 1：走 restore_runtime_and_exit，且 PM2 还没重启过', log.slice(-500))
    check(r.pm2Restarts === 0 && !names.some((name) => name.endsWith('.ok')),
      '信号 1：没有重启 PM2，也没有写成一次成功发布', `PM2 ${r.pm2Restarts} ${names.join(',')}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PG_DUMP_SIGNAL: 'HUP' }, { timeout: 20000, killSignal: 'SIGKILL' })
    const names = readdirSync(box.backups)
    const log = readSignalLogs(box.backups)
    check(r.code === 129, '信号 2：备份阶段收到 HUP，退出码 129', `退出码 ${r.code} signal=${r.signal}\n${log.slice(-500)}`)
    check(!names.some((name) => name.includes('.partial') || name.endsWith('.dump') || name.endsWith('.ok')),
      '信号 2：partial 已删，没有正式 dump，也没有成功标记', names.join(','))
    check(log.includes('备份被中断，已删除不完整文件') && read(join(box.runtime, 'VERSION')) === 'old' && !log.includes('开始把运行目录恢复'),
      '信号 2：只删不完整文件，运行目录还没进入回退阶段', log.slice(-400))
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DEPLOY_MIN_FREE_FLOOR_MB: '08',
      DEPLOY_MIN_FREE_MARGIN_MB: '09',
      DEPLOY_BACKUP_KEEP: '08',
    })
    const names = readdirSync(box.backups)
    check(r.code === 0 && r.out.includes('FLOOR_MB=8 ') && r.out.includes('+ 9 安全边界') && r.out.includes('DEPLOY_BACKUP_KEEP=8'),
      '数字 1：08 与 09 按十进制使用，保留数 8', `退出码 ${r.code}\n${r.out.match(/FLOOR_MB=\d+.*GATE_MB=\d+/)?.[0] ?? r.out.slice(-400)}`)
    check(names.some((name) => name.endsWith('.ok') && name.includes(box.sha)),
      '数字 1：这次成功发布写了 .ok', names.filter((name) => name.endsWith('.ok')).join(','))
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DEPLOY_MIN_FREE_FLOOR_MB: '12345678' })
    check(r.code === 0 && r.out.includes('FLOOR_MB=10240') && r.out.includes('DEPLOY_MIN_FREE_FLOOR_MB=12345678 不是 1 到 7 位数字'),
      '数字 2：8 位下限被拒绝，回到 10240，空间够时发布继续', `退出码 ${r.code}\n${r.out.match(/FLOOR_MB=\d+/)?.[0] ?? ''} ${r.out.includes('::warning::')}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const huge = '12345678901234567890'
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '100', DEPLOY_MIN_FREE_FLOOR_MB: huge })
    check(r.code !== 0 && !r.calls.includes('pg_dump') && r.out.includes('FLOOR_MB=10240') && r.out.includes('不是 1 到 7 位数字'),
      '数字 3：20 位下限被拒绝；按默认 10240 判定空间不足并中止', `退出码 ${r.code}\n${r.out.slice(-500)}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const huge = '12345678901234567890'
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DEPLOY_MIN_FREE_MARGIN_MB: huge })
    check(r.code === 0 && r.out.includes('+ 1024 安全边界') && r.out.includes('DEPLOY_MIN_FREE_MARGIN_MB=12345678901234567890 不是 1 到 7 位数字'),
      '数字 4：超长安全边界回到 1024', `退出码 ${r.code}`)
  }
  for (const [keep, warning] of [['0', '不是 1 到 7 位数字'], ['999999', '超出 1-20']]) {
    const box = makeSandbox({ oldGroups: 4 }); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DEPLOY_BACKUP_KEEP: keep })
    const groups = groupsOf(box.backups)
    check(r.code === 0 && groups.length === 3 && r.out.includes('DEPLOY_BACKUP_KEEP=3') && r.out.includes(warning),
      `数字 5：DEPLOY_BACKUP_KEEP=${keep} 回到 3，成功后仍留 3 组`, `退出码 ${r.code} 组数 ${groups.length}\n${r.out.match(/DEPLOY_BACKUP_KEEP=\d+/)?.[0] ?? ''} warning=${r.out.includes(warning)}`)
  }
  {
    const box = makeSandbox({ oldGroups: 1 }); reviewBoxes.push(box)
    const partial = join(box.backups, 'pre-part-20260929T000000Z.dump.partial')
    writeFileSync(partial, 'partial only\n')
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '100', DEPLOY_BACKUP_KEEP: '1' })
    const names = readdirSync(box.backups)
    check(r.code !== 0 && !r.calls.includes('pg_dump'),
      '锚点 1：只有 partial 时发布仍因空间不足停在备份前', `退出码 ${r.code}`)
    check(!names.some((name) => name.includes('.partial')) && names.some((name) => name === 'pre-old0-20260900T000000Z.dump') && existsSync(join(box.backups, 'pre-old0-20260900T000000Z.runtime')),
      '锚点 1：partial 组被删，不占保留名额，完整组还在', names.join(','))
  }
  {
    const box = makeSandbox({ oldGroups: 2 }); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '100', DEPLOY_BACKUP_KEEP: '1' })
    const names = readdirSync(box.backups)
    const dumps = names.filter((name) => name.endsWith('.dump'))
    check(r.code !== 0 && dumps.length === 1 && dumps[0].includes('old1') && !names.some((name) => name.includes('old0')),
      '锚点 2：没有任何 .ok 时按时间留最新 1 组，不会删到 0 组', names.join(','))
  }
  {
    const box = makeSandbox({ oldGroups: 3 }); reviewBoxes.push(box)
    const oldest = join(box.backups, 'pre-old0-20260900T000000Z')
    writeFileSync(`${oldest}.ok`, 'ok\n')
    const dumpStat = statSync(`${oldest}.dump`)
    utimesSync(`${oldest}.ok`, dumpStat.atime, dumpStat.mtime)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DF_AVAIL_MB: '100', DEPLOY_BACKUP_KEEP: '1' })
    const names = readdirSync(box.backups)
    check(r.code !== 0 && !r.calls.includes('pg_dump'),
      '锚点 3：keep=1 且空间不足时停在备份前', `退出码 ${r.code}`)
    check(names.some((name) => name.includes('old2') && name.endsWith('.dump')) && names.some((name) => name.includes('old0') && name.endsWith('.dump')) && !names.some((name) => name.includes('old1')),
      '锚点 3：最新完整组与带 .ok 的最旧完整组都留着，中间那组删掉', names.join(','))
    check(existsSync(`${oldest}.ok`), '锚点 3：留下的成功标记还在')
  }
  {
    const box = makeSandbox({ oldGroups: 4 }); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_RM_FAIL_SUBSTR: 'pre-old0-' })
    const names = readdirSync(box.backups)
    check(r.code === 0 && read(join(box.runtime, 'VERSION')) === 'new-release',
      '清理 1：删不掉旧组时发布仍然成功', `退出码 ${r.code} VERSION=${read(join(box.runtime, 'VERSION'))}`)
    check(r.out.includes('::warning::以下备份组没有删掉:') && r.out.includes('pre-old0-') && !r.out.includes('清理完成'),
      '清理 1：警告列出没删掉的组，不打印清理完成', r.out.match(/以下备份组没有删掉:[^\n]*/)?.[0] ?? r.out.slice(-400))
    check(names.some((name) => name.includes('pre-old0-') && name.endsWith('.dump')),
      '清理 1：没删掉的那组还在', names.join(','))
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_DU_FAIL: '1' })
    check(r.code === 0 && r.out.includes('api_dir=3072') && r.out.includes('::warning::无法统计 API 目录大小，按 3072MB 估算'),
      '估算：API 目录 du 失败时按 3072MB，不按 1500', `退出码 ${r.code}\n${r.out.match(/api_dir=\d+/)?.[0] ?? ''}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_PM2_LOGROTATE: 'installed',
      DRILL_PM2_CONF_OUT: 'max_size: 50M;retain: 180;compress: true',
    })
    check(r.code === 0 && r.out.includes('PM2_LOGROTATE_MAX_SIZE=50M') && r.out.includes('PM2_LOGROTATE_RETAIN=180') && r.out.includes('PM2_LOGROTATE_COMPRESS=true'),
      '摘要：pm2-logrotate 只读打出 max_size、retain、compress', r.out.match(/PM2_LOGROTATE_MAX_SIZE=\S+[\s\S]{0,80}/)?.[0] ?? r.out.slice(-300))
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, { DRILL_HEALTH: 'always', DRILL_PM2_LOGROTATE: 'installed', DRILL_PM2_CONF_OUT: 'unrelated: 1' })
    check(r.code === 0 && r.out.includes('PM2_LOGROTATE_MAX_SIZE=unknown') && r.out.includes('PM2_LOGROTATE_RETAIN=unknown') && r.out.includes('PM2_LOGROTATE_COMPRESS=unknown'),
      '摘要：读不到轮转配置时三个字段都是 unknown', r.out.match(/PM2_LOGROTATE_MAX_SIZE=\S+/)?.[0] ?? '')
  }

  {
    const decimalFn = extractBetween(releaseText, 'normalize_decimal_setting() {', 'normalize_backup_keep() {')
    const probeDecimal = (raw) => {
      const result = runFragment(`${decimalFn}\nvalue="$(normalize_decimal_setting PROBE "$RAW" 10240)"\nprintf 'VALUE=%s\\n' "$value"\n`, { RAW: raw })
      reviewDirs.push(result.dir)
      return result
    }
    const badInputs = ['', '0', '0000000', ' 12', '-1', '１０２４０', '١٢٣']
    const bad = badInputs.map((raw) => {
      const result = probeDecimal(raw)
      const ok = result.code === 0 && result.out.includes('VALUE=10240') && result.out.includes('不是 1 到 7 位数字')
      return ok ? '' : `raw=${JSON.stringify(raw)} code=${result.code} ${result.out.trim()}`
    }).filter(Boolean)
    check(bad.length === 0, '数字 6：空串、全零、空白、负号、全角数字、非 ASCII 数字都回到默认并警告', bad.join(' | '))
    const decimal08 = probeDecimal('08')
    check(decimal08.code === 0 && decimal08.out.includes('VALUE=8') && !decimal08.out.includes('不是 1 到 7 位数字'),
      '数字 6：08 仍按十进制 8，不报警', `退出码 ${decimal08.code}\n${decimal08.out}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, {
      DRILL_DATE_SIGNAL: 'TERM',
      DRILL_DATE_SIGNAL_ON: '-u +%Y%m%dT%H%M%SZ',
    }, { timeout: 20000, killSignal: 'SIGKILL' })
    const names = readdirSync(box.backups)
    const logs = names.filter((name) => name.startsWith('release-signal-') && name.endsWith('.log'))
    const log = readSignalLogs(box.backups)
    check(r.code === 143 && r.signal === null && logs.length === 1 && !log.includes('开始把运行目录恢复'),
      '信号 3：pre 阶段收到 TERM 只退出 143，不回退', `退出码 ${r.code} signal=${r.signal} logs=${logs.join(',')} \n${log}`)
    check(!names.some((name) => name.endsWith('.dump') || name.includes('.partial') || name.endsWith('.ok')) && read(join(box.runtime, 'VERSION')) === 'old',
      '信号 3：pre 阶段没有备份，运行目录不动', names.join(','))
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const bashEnv = join(box.dir, 'pipe-debug.bash')
    writeFileSync(bashEnv, [
      'armed=0',
      'trap \'',
      '  case "$BASH_COMMAND" in',
      '    *"=== 7."*)',
      '      if [ "$armed" = 0 ]; then',
      '        armed=1',
      '        fifo="$DRILL_DIR/closed-pipe"',
      '        rm -f "$fifo"',
      '        mkfifo "$fifo"',
      '        ( exec 8<"$fifo" ) &',
      '        exec 7>"$fifo"',
      '        sleep 0.3',
      '        exec 1>&7 2>&7',
      '      fi',
      '      ;;',
      '  esac',
      '\' DEBUG',
      '',
    ].join('\n'))
    const r = runDeploy(box, { DRILL_HEALTH: 'always', BASH_ENV: bashEnv }, { timeout: 30000, killSignal: 'SIGKILL' })
    const log = readSignalLogs(box.backups)
    const logs = readdirSync(box.backups).filter((name) => name.startsWith('release-signal-') && name.endsWith('.log'))
    check(r.code === 141 && r.signal === null && logs.length >= 1 && log.includes('开始把运行目录恢复'),
      '信号 4：回退阶段写入已关闭的管道时按 SIGPIPE 回退，并留下信号日志', `退出码 ${r.code} signal=${r.signal} logs=${logs.join(',')}\n${log.slice(-500)}\n${r.out.slice(-400)}`)
    check(read(join(box.runtime, 'VERSION')) === 'old' && read(join(box.runtime, 'node_modules/marker')) === 'old',
      '信号 4：运行目录回到发布前', `VERSION=${read(join(box.runtime, 'VERSION'))} marker=${read(join(box.runtime, 'node_modules/marker'))}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_DATE_SIGNAL: 'TERM',
      DRILL_DATE_SIGNAL_ON: '-Is',
    }, { timeout: 20000, killSignal: 'SIGKILL' })
    const names = readdirSync(box.backups)
    const okName = names.find((name) => name.endsWith('.ok') && name.includes(box.sha))
    const source = read(join(box.runtime, 'DEPLOY_SOURCE.txt'))
    check(r.code === 0 && r.signal === null && source.includes(`source=origin/main@${box.sha}`) && source.includes('deployed_at=') && okName && read(join(box.backups, okName)) === 'ok',
      '信号 5：committed 阶段收到 TERM 仍写完 DEPLOY_SOURCE.txt 和 .ok', `退出码 ${r.code} signal=${r.signal} source=${source} ok=${okName ?? '(无)'}\n${r.out.slice(-400)}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_PG_DUMP_SIGNAL: 'HUP',
      DRILL_RM_FAIL_SUBSTR: '.partial',
    }, { timeout: 20000, killSignal: 'SIGKILL' })
    check(r.code === 129 && r.signal === null,
      '信号 6：备份阶段清理失败仍以 129 退出，不被 set -e 打断', `退出码 ${r.code} signal=${r.signal}\n${readSignalLogs(box.backups).slice(-400)}\n${r.out.slice(-300)}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    if (!existsSync('/usr/bin/rsync')) throw new Error('本机缺少 /usr/bin/rsync，无法演练回退重入')
    writeExec(join(box.bin, 'rsync'), `#!/usr/bin/env bash
# rsync 会再拉起自己的 --server。那一次的父进程是 rsync 客户端，不能再发信号，也不能睡觉。
case "$*" in
  *"--server"*) exec /usr/bin/rsync "$@" ;;
esac
if [ -n "\${DRILL_RSYNC_SIGNAL:-}" ]; then
  case "$*" in
    *"--ignore-times"*)
      kill -s "$DRILL_RSYNC_SIGNAL" "$PPID" 2>/dev/null || true
      sleep 0.5
      ;;
  esac
fi
exec /usr/bin/rsync "$@"
`)
    const r = runDeploy(box, {
      DRILL_HEALTH: 'always',
      DRILL_MIGRATION_FAIL: '1',
      DRILL_RSYNC_SIGNAL: 'TERM',
    }, { timeout: 20000, killSignal: 'SIGKILL' })
    const mentions = `${r.out}\n${readSignalLogs(box.backups)}`.split('开始把运行目录恢复').length - 1
    check(r.code !== 0 && r.signal === null && mentions === 1 && read(join(box.runtime, 'VERSION')) === 'old',
      '信号 7：回退途中再来 TERM 不重入，运行目录仍恢复', `退出码 ${r.code} signal=${r.signal} 次数=${mentions} VERSION=${read(join(box.runtime, 'VERSION'))}\n${r.out.slice(-400)}`)
  }
  {
    const box = makeSandbox(); reviewBoxes.push(box)
    for (const name of ['README.txt', 'notes.tar.gz', 'pre-extra.dump.bak']) {
      writeFileSync(join(box.backups, name), 'unrelated\n')
    }
    const r = runDeploy(box, { DRILL_HEALTH: 'always' })
    const names = readdirSync(box.backups)
    check(r.code === 0 && r.out.includes('备份共 1 组') && ['README.txt', 'notes.tar.gz', 'pre-extra.dump.bak'].every((name) => names.includes(name)),
      '分组：发布清理只数备份后缀，无关文件不计组也不删', `退出码 ${r.code} ${r.out.match(/备份共 \d+ 组/)?.[0] ?? ''} 剩下 ${names.join(',')}`)
  }

  const buildDisk = extractBetween(workflow, '=== full 发布构建前磁盘检查 ===', '=== 安装依赖 ===')
  const buildDf = mkdtempSync(join(tmpdir(), 'build-df-'))
  reviewDirs.push(buildDf)
  const buildPruned = join(buildDf, 'pruned')
  writeExec(join(buildDf, 'df'), `#!/usr/bin/env bash
target="\${!#}"
case "\$target" in
  *backups*)
    fs="\${DRILL_DF_BACKUP_FS:-deployfs}"
    avail="\${DRILL_DF_BACKUP_AVAIL_MB:-\${DRILL_DF_AVAIL_MB:-0}}"
    ;;
  *)
    fs="\${DRILL_DF_DEPLOY_FS:-deployfs}"
    avail="\${DRILL_DF_AVAIL_MB:-0}"
    ;;
esac
if [ -n "\${DRILL_BUILD_PRUNED:-}" ] && [ -f "$DRILL_BUILD_PRUNED" ] && [ -n "\${DRILL_DF_AVAIL_AFTER_PRUNE_MB:-}" ]; then
  avail="$DRILL_DF_AVAIL_AFTER_PRUNE_MB"
fi
printf '%s\\n' "Filesystem 1024-blocks Used Available Capacity Mounted on"
printf '%s\\n' "\$fs 100000000 1000 \$avail 1% /"
`)
  writeExec(join(buildDf, 'pnpm'), `#!/usr/bin/env bash
if [ "$1" = store ] && [ "$2" = prune ]; then
  touch "$DRILL_BUILD_PRUNED"
  exit 0
fi
echo "unexpected pnpm $*" >&2
exit 1
`)
  const runBuild = (env) => {
    rmSync(buildPruned, { force: true })
    const result = runFragment(buildDisk, {
      PATH: `${buildDf}:/usr/bin:/bin`,
      DRILL_BUILD_PRUNED: buildPruned,
      ...env,
    })
    reviewDirs.push(result.dir)
    const pruned = existsSync(buildPruned)
    rmSync(buildPruned, { force: true })
    return { ...result, pruned }
  }
  const pass20000 = runBuild({ DRILL_DF_AVAIL_MB: '20000' })
  check(pass20000.code === 0 && pass20000.out.includes('构建前磁盘空间够用') && pass20000.out.includes('FULL_BUILD_DISK_AVAIL_MB=20000') && pass20000.out.includes('DEPLOY_MIN_FREE_FLOOR_MB=10240') && !pass20000.out.includes('先 pnpm store prune') && !pass20000.pruned,
    '构建前 1：可用 20000MB 高于 10240，不 prune 直接通过', `退出码 ${pass20000.code} pruned=${pass20000.pruned}\n${pass20000.out}`)
  const pruneThenPass = runBuild({ DRILL_DF_AVAIL_MB: '7000', DRILL_DF_AVAIL_AFTER_PRUNE_MB: '20000' })
  check(pruneThenPass.code === 0 && pruneThenPass.out.includes('FULL_BUILD_DISK_AVAIL_MB=7000') && pruneThenPass.out.includes('先 pnpm store prune') && pruneThenPass.out.includes('pnpm store prune 后 FULL_BUILD_DISK_AVAIL_MB=20000') && pruneThenPass.out.includes('构建前磁盘空间够用'),
    '构建前 2：7000MB 低于 10240 时先 prune，复判够了才继续', `退出码 ${pruneThenPass.code}\n${pruneThenPass.out}`)
  const pruneStillShort = runBuild({ DRILL_DF_AVAIL_MB: '100' })
  check(pruneStillShort.code !== 0 && pruneStillShort.out.includes('先 pnpm store prune') && pruneStillShort.out.includes('pnpm store prune 后 FULL_BUILD_DISK_AVAIL_MB=100') && pruneStillShort.out.includes('构建前磁盘空间不足') && pruneStillShort.out.includes('未安装依赖') && pruneStillShort.out.includes('dry_run=false、keep=3、prune_pnpm=true、vacuum_journal=false') && !pruneStillShort.out.includes('构建前磁盘空间够用'),
    '构建前 3：prune 后仍不够，在安装依赖之前失败', `退出码 ${pruneStillShort.code}\n${pruneStillShort.out}`)
  const backupProbe = join(buildDf, 'backups')
  mkdirSync(backupProbe)
  const splitFs = runBuild({
    DEPLOY_BACKUP_ROOT: backupProbe,
    DRILL_DF_AVAIL_MB: '8000',
    DRILL_DF_BACKUP_AVAIL_MB: '5000',
    DRILL_DF_DEPLOY_FS: 'deployfs',
    DRILL_DF_BACKUP_FS: 'backupfs',
  })
  check(splitFs.code !== 0 && splitFs.out.includes('可用 5000MB') && splitFs.out.includes('DEPLOY_DIR_AVAIL_MB=8000') && splitFs.out.includes('BACKUP_DIR_AVAIL_MB=5000') && splitFs.out.includes('先 pnpm store prune'),
    '构建前 4：部署目录与备份目录不同分区时取较小可用空间', `退出码 ${splitFs.code}\n${splitFs.out}`)
  const sameFs = runBuild({
    DEPLOY_BACKUP_ROOT: backupProbe,
    DRILL_DF_AVAIL_MB: '20000',
    DRILL_DF_BACKUP_AVAIL_MB: '1000',
    DRILL_DF_DEPLOY_FS: 'samefs',
    DRILL_DF_BACKUP_FS: 'samefs',
  })
  check(sameFs.code === 0 && sameFs.out.includes('FULL_BUILD_DISK_AVAIL_MB=20000') && !sameFs.out.includes('先 pnpm store prune'),
    '构建前 5：同一分区只看部署目录的可用空间', `退出码 ${sameFs.code}\n${sameFs.out}`)
  const buildHuge = runBuild({ DRILL_DF_AVAIL_MB: '100', DEPLOY_MIN_FREE_FLOOR_MB: '12345678901234567890' })
  check(buildHuge.code !== 0 && buildHuge.out.includes('不是 1 到 7 位数字') && buildHuge.out.includes('门槛 10240MB'),
    '构建前 6：超长门槛回到 10240，100MB 仍失败', `退出码 ${buildHuge.code}\n${buildHuge.out}`)
  const build08 = runBuild({ DRILL_DF_AVAIL_MB: '50000', DEPLOY_MIN_FREE_FLOOR_MB: '08' })
  check(build08.code === 0 && build08.out.includes('DEPLOY_MIN_FREE_FLOOR_MB=8 '),
    '构建前 7：08 按十进制 8 使用', `退出码 ${build08.code}\n${build08.out}`)
  const buildZero = runBuild({ DRILL_DF_AVAIL_MB: '100', DEPLOY_MIN_FREE_FLOOR_MB: '0' })
  check(buildZero.code !== 0 && buildZero.out.includes('不是 1 到 7 位数字') && buildZero.out.includes('门槛 10240MB') && !buildZero.out.includes('构建前磁盘空间够用'),
    '构建前 8：门槛 0 回到 10240，100MB 不能通过', `退出码 ${buildZero.code}\n${buildZero.out}`)

  const helperFn = extractBetween(workflow, 'cleanup_control_plane_helper() {', 'if [ -z "${CONTROL_PLANE_DEPLOY_HELPER_B64:-}" ]')
  const bundlePath = '/tmp/release.bundle'
  const bundleBackup = existsSync(bundlePath) ? readFileSync(bundlePath) : null
  const helperPath = join(buildDf, 'control-plane-helper.sh')
  writeFileSync(helperPath, 'helper\n')
  const runBundle = (tail) => {
    writeFileSync(bundlePath, 'drill bundle\n')
    writeFileSync(helperPath, 'helper\n')
    const result = runFragment(`${helperFn}\n${tail}\n`, { CONTROL_PLANE_HELPER: helperPath })
    reviewDirs.push(result.dir)
    return result
  }
  try {
    // EXIT trap 在未捕获信号时也会删文件，但进程状态是 signal 而不是 exit。
    // 信号陷阱必须自己 exit，node 才能看到 129/130/141/143。
    const bundleExit = runBundle('exit 1')
    check(bundleExit.code !== 0 && !existsSync(bundlePath),
      'bundle：SSH 脚本以失败退出时，EXIT trap 仍删除 /tmp/release.bundle', `退出码 ${bundleExit.code} 还在=${existsSync(bundlePath)}\n${bundleExit.out}`)
    for (const [sig, code] of [['HUP', 129], ['INT', 130], ['TERM', 143], ['PIPE', 141]]) {
      const bundleSig = runBundle(`kill -s ${sig} $$\necho survived-${sig}`)
      check(bundleSig.status === code && bundleSig.signal === null && !existsSync(bundlePath) && !bundleSig.out.includes(`survived-${sig}`),
        `bundle：${sig} 清理 /tmp/release.bundle 后以 ${code} 退出`, `status=${bundleSig.status} signal=${bundleSig.signal} 还在=${existsSync(bundlePath)}\n${bundleSig.out}`)
    }
  } finally {
    if (bundleBackup === null) rmSync(bundlePath, { force: true })
    else writeFileSync(bundlePath, bundleBackup)
  }

  const cleanupBody = extractBetween(cleanupWorkflow, 'echo "=== 备份清单', 'echo "=== 清理后 ===')
  const fillCleanup = (backupDir, { withOk = true, withPartial = true } = {}) => {
    mkdirSync(backupDir, { recursive: true })
    const put = (stem, iso, ok) => {
      const stamp = new Date(iso)
      writeFileSync(join(backupDir, `${stem}.dump`), 'dump\n')
      mkdirSync(join(backupDir, `${stem}.runtime`))
      writeFileSync(join(backupDir, `${stem}.migrations.log`), 'log\n')
      for (const name of [`${stem}.dump`, `${stem}.runtime`, `${stem}.migrations.log`]) {
        utimesSync(join(backupDir, name), stamp, stamp)
      }
      if (ok) {
        writeFileSync(join(backupDir, `${stem}.ok`), 'ok\n')
        utimesSync(join(backupDir, `${stem}.ok`), stamp, stamp)
      }
    }
    put('pre-ok', '2026-01-02T00:00:00Z', withOk)
    put('pre-mid', '2026-02-02T00:00:00Z', false)
    put('pre-new', '2026-03-04T00:00:00Z', false)
    writeFileSync(join(backupDir, 'README.txt'), 'notes\n')
    writeFileSync(join(backupDir, 'notes.tar.gz'), 'archive\n')
    writeFileSync(join(backupDir, 'pre-extra.dump.bak'), 'not a dump\n')
    if (withPartial) {
      const partialName = join(backupDir, 'pre-part.dump.partial')
      writeFileSync(partialName, 'partial\n')
      const stamp = new Date('2026-04-04T00:00:00Z')
      utimesSync(partialName, stamp, stamp)
    }
  }
  const runCleanup = (backupDir, env) => {
    const bin = mkdtempSync(join(tmpdir(), 'cleanup-bin-'))
    reviewDirs.push(bin)
    writeFindShim(bin)
    writeExec(join(bin, 'awk'), `#!/usr/bin/env bash
now="$(date +%s)"
args=()
for a in "$@"; do
  args+=("\${a//systime()/\$now}")
done
exec /usr/bin/awk "\${args[@]}"
`)
    const result = runFragment(cleanupBody, {
      PATH: `${bin}:/usr/bin:/bin`,
      BK: backupDir,
      PRUNE_PNPM: 'false',
      VACUUM_JOURNAL: 'false',
      ...env,
    })
    reviewDirs.push(result.dir)
    return result
  }
  const cleanupKeep = join(buildDf, 'cleanup-keep')
  fillCleanup(cleanupKeep)
  const dry = runCleanup(cleanupKeep, { DRY_RUN: 'true', KEEP: '1' })
  const keptLines = dry.out.split('\n').filter((line) => line.includes('[保留]'))
  const dropLines = dry.out.split('\n').filter((line) => line.includes('[待删]'))
  check(dry.code === 0 && dry.out.includes('RELEASE_GROUP_COUNT=4'),
    '清理分组：partial 与 .ok 归进所属 stem，一共 4 组', `退出码 ${dry.code}\n${dry.out}`)
  check(dropLines.some((line) => line.includes('不完整')) && keptLines.some((line) => line.includes('最近一次成功发布前的快照（回退锚点）')) && keptLines.length === 2 && dropLines.length === 2,
    '清理分组：dry-run 标出不完整组与最近一次成功发布前的快照（回退锚点），keep=1 仍多留一组', `保留 ${keptLines.length} 待删 ${dropLines.length}\n${dry.out}`)
  const cleanupDelete = join(buildDf, 'cleanup-delete')
  fillCleanup(cleanupDelete)
  const deleted = runCleanup(cleanupDelete, { DRY_RUN: 'false', KEEP: '1' })
  const deletedNames = readdirSync(cleanupDelete)
  check(deleted.code === 0 && deleted.out.includes('最近一次成功发布前的快照（回退锚点）') && !existsSync(join(cleanupDelete, 'pre-part.dump.partial')) && !existsSync(join(cleanupDelete, 'pre-mid.dump')) && existsSync(join(cleanupDelete, 'pre-new.dump')) && existsSync(join(cleanupDelete, 'pre-ok.dump')) && existsSync(join(cleanupDelete, 'pre-ok.ok')) && existsSync(join(cleanupDelete, 'pre-ok.runtime')) && ['README.txt', 'notes.tar.gz', 'pre-extra.dump.bak'].every((name) => deletedNames.includes(name)),
    '清理分组：执行删除后 partial 与中间组消失，最新组、带 .ok 的组和无关文件留下', `退出码 ${deleted.code} 剩下 ${deletedNames.join(',')}\n${deleted.out}`)
  const cleanupPlain = join(buildDf, 'cleanup-plain')
  fillCleanup(cleanupPlain, { withOk: false, withPartial: false })
  const plain = runCleanup(cleanupPlain, { DRY_RUN: 'false', KEEP: '1' })
  const plainDumps = readdirSync(cleanupPlain).filter((name) => name.endsWith('.dump'))
  check(plain.code === 0 && plainDumps.length === 1 && plainDumps[0].includes('pre-new'),
    '清理分组：没有任何 .ok 时至少留下 1 组完整备份', `剩下 ${plainDumps.join(',')}`)
  const cleanupZero = join(buildDf, 'cleanup-zero')
  fillCleanup(cleanupZero)
  const zeroKeep = runCleanup(cleanupZero, { DRY_RUN: 'false', KEEP: '0' })
  const zeroDumps = readdirSync(cleanupZero).filter((name) => name.endsWith('.dump'))
  check(zeroKeep.code === 0 && zeroKeep.out.includes('超出 1-20') && zeroKeep.out.includes('PLAN_KEEP=3') && zeroDumps.length === 3 && !existsSync(join(cleanupZero, 'pre-part.dump.partial')),
    '清理分组：KEEP=0 回到 3，三组完整备份都留，partial 删掉', `退出码 ${zeroKeep.code} dumps=${zeroDumps.join(',')} \n${zeroKeep.out}`)
  const sizeLine = cleanupWorkflow.split('\n').map((line) => line.trim()).find((line) => line.startsWith('SZ="$(du -sm'))
  const rmLine = cleanupWorkflow.split('\n').map((line) => line.trim()).find((line) => line.startsWith('rm -rf -- "$BK"'))
  check(Boolean(sizeLine && rmLine && sizeLine.includes('.dump.partial') && sizeLine.includes('.ok') && rmLine.includes('.dump.partial') && rmLine.includes('.ok')),
    '清理分组：大小统计和删除都包含 partial 与 .ok')
} catch (error) {
  fail(`复核场景无法运行：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
} finally {
  for (const box of reviewBoxes) rmSync(box.dir, { recursive: true, force: true })
  for (const dir of reviewDirs) rmSync(dir, { recursive: true, force: true })
}

if (failures) {
  console.error(`\nverify:deploy-rollback：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:deploy-rollback 通过（真跑发布脚本 + 磁盘门槛与原子备份 + 静态目录 + 清理分组 / 构建前检查 / 预检 + 信号 / 数字 / 锚点 / bundle）')
