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
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync,
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

// ── 真跑发布脚本 ────────────────────────────────────────────────────────────────
const isDarwin = process.platform === 'darwin'
const which = (name) => spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim()

function writeExec(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function makeShims(bin) {
  writeExec(join(bin, 'pnpm'), `#!/usr/bin/env bash
echo "pnpm $* @ $PWD" >> "$DRILL_CALLS"
case "$*" in
  *"--filter @ai-job-print/api build"*)
    mkdir -p "$DRILL_DEPLOY/services/api/dist/config"
    echo "// drill build" > "$DRILL_DEPLOY/services/api/dist/config/production-runtime-gates.js" ;;
  "install --frozen-lockfile")
    if [ "$PWD" = "$DRILL_RUNTIME" ]; then
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
out=""; while [ $# -gt 0 ]; do [ "$1" = -f ] && out="$2"; shift; done
echo drill-dump > "$out"
`)
  writeExec(join(bin, 'pg_restore'), '#!/usr/bin/env bash\nexit 0\n')
  writeExec(join(bin, 'pm2'), '#!/usr/bin/env bash\necho "pm2 $* COMMIT=$COMMIT" >> "$DRILL_CALLS"\nexit 0\n')
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
    for (const [name, gnu] of [['date', 'gdate'], ['chmod', 'gchmod'], ['chown', 'gchown']]) {
      const path = which(gnu)
      if (!path) throw new Error(`本机缺少 ${gnu}（brew install coreutils），无法演练发布脚本里的 GNU 写法`)
      writeExec(join(bin, name), `#!/usr/bin/env bash\nexec "${path}" "$@"\n`)
    }
    // 发布脚本只用到 find <dir> -maxdepth 1 -mindepth 1 [-type d] -printf <fmt>
    writeExec(join(bin, 'find'), `#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if '-printf' not in args:
    os.execv('/usr/bin/find', ['find'] + args)
base, fmt = args[0], args[args.index('-printf') + 1]
only_dirs = '-type' in args and args[args.index('-type') + 1] == 'd'
for name in os.listdir(base):
    path = os.path.join(base, name)
    if only_dirs and not os.path.isdir(path):
        continue
    line = fmt.replace('%T@', '%.10f' % os.lstat(path).st_mtime).replace('%f', name).replace('%p', path)
    sys.stdout.write(line.replace('\\\\t', '\\t').replace('\\\\n', '\\n'))
`)
  }
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

function runDeploy(box, extraEnv) {
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
    DRILL_CALLS: box.calls,
    DRILL_DEPLOY: box.checkout,
    DRILL_RUNTIME: box.runtime,
    DRILL_MARKER_REF: box.markerRef,
    // 固定用 C 语言环境跑：服务器经 SSH 执行时语言环境不由我们保证，脚本必须在最差情况下也正确
    LC_ALL: 'C',
    LANG: 'C',
    ...extraEnv,
  }
  const result = spawnSync('bash', [deployScript], { env, encoding: 'utf8' })
  const calls = existsSync(box.calls) ? readFileSync(box.calls, 'utf8') : ''
  return { code: result.status, out: `${result.stdout}\n${result.stderr}`, calls, pm2Restarts: (calls.match(/^pm2 restart /gm) ?? []).length }
}

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').trim() : '(缺失)')
const groupsOf = (backups) => {
  const stems = new Set(readdirSync(backups).map((name) => name.replace(/\.(dump|runtime|migrations\.log)$/, '')))
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

if (failures) {
  console.error(`\nverify:deploy-rollback：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:deploy-rollback 通过（真跑发布脚本 7 个场景 + 静态目录 3 个场景）')
