// verify:server-maintenance-workflows
//
// 用假命令真跑整份 deploy-precheck.sh，以及 cleanup-stale-releases.sh。
// 只用 node 内置模块，可在 pnpm install 之前跑。
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// 反向变异时把改坏的副本放到这个目录，缺省读仓库本身。
const sourceRoot = process.env.MAINT_FIXTURE_DIR || root
const precheckYmlPath = '.github/workflows/deploy-precheck.yml'
const cleanupYmlPath = '.github/workflows/cleanup-stale-releases.yml'
const cleanupShPath = '.github/scripts/cleanup-stale-releases.sh'
const precheckShPath = '.github/scripts/deploy-precheck.sh'
const precheckYml = readFileSync(join(sourceRoot, precheckYmlPath), 'utf8')
const cleanupYml = readFileSync(join(sourceRoot, cleanupYmlPath), 'utf8')
const cleanupSh = readFileSync(join(sourceRoot, cleanupShPath), 'utf8')
const precheckSh = readFileSync(join(sourceRoot, precheckShPath), 'utf8')
const SSH_SHA = '0ff4204d59e8e51228ff73bce53f80d53301dee2'

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => { failures += 1; console.error(`  FAIL ${message}`) }
const check = (ok, message, detail = '') => (ok ? pass(message) : fail(detail ? `${message} —— ${detail}` : message))
// 反向变异时只跑点名的场景。缺省跑全部；CI 不设置这个变量。
const onlySet = new Set((process.env.MAINT_ONLY || '').split(',').map((item) => item.trim()).filter(Boolean))
function want(...ids) {
  if (onlySet.size === 0) return true
  return ids.some((id) => onlySet.has(id))
}

const INDET = 'PLAINTEXT_API_COUNT=indeterminate（日志格式不含端口）'
const WARN = '::warning::HTTPS 心跳近 7 天次数为 0，统计可能没测到'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IP = '203.0.113.55'
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/
const HEALTH_OK = '{"success":true,"data":{"status":"ok","db":"postgresql"}}'
const NEW_WHITELIST = [
  'ai-job-print-api-backups',
  'ai-job-print-env-backups',
  'ai-job-print-artifacts',
  'ai-job-print-static-releases',
  'ai-job-print-recovery-artifacts',
]

function commandPath(name) {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' })
  return (result.stdout || '').trim()
}
const realDu = commandPath('du')
if (!realDu) {
  console.error('找不到 du，无法演练清理脚本')
  process.exit(1)
}
const gnuBin = '/opt/homebrew/opt/coreutils/libexec/gnubin'
const toolDir = existsSync(join(gnuBin, 'readlink')) ? gnuBin : dirname(realDu)
const realNode = process.execPath
const realStat = existsSync(join(toolDir, 'stat')) ? join(toolDir, 'stat') : '/usr/bin/stat'

function writeExec(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function pad(n) { return String(n).padStart(2, '0') }
function nginxStamp(date, offset = '+0000') {
  return `${pad(date.getUTCDate())}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${offset}`
}
function combinedLine(ip, stamp, req, port) {
  return `${ip} - - [${stamp}] "${req}" 200 12 "-" "-" ${port}\n`
}

const boxes = []
const shortHomes = []
const socketPids = []
process.on('exit', () => {
  for (const pid of socketPids) {
    try { process.kill(pid, 'SIGTERM') } catch { /* 套接字进程已退出 */ }
  }
  for (const td of boxes) {
    try { rmSync(td, { recursive: true, force: true }) } catch { /* 临时目录已清 */ }
  }
  for (const dir of shortHomes) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 短 HOME 已清 */ }
  }
})

function makeShortHome() {
  const dir = realpathSync(mkdtempSync('/tmp/pc-home-'))
  shortHomes.push(dir)
  return dir
}

function startSocket(homeDir) {
  const pm2 = join(homeDir, '.pm2')
  mkdirSync(pm2, { recursive: true })
  const sock = join(pm2, 'rpc.sock')
  if (existsSync(sock)) rmSync(sock, { force: true })
  const child = spawn(realNode, ['-e', 'const net=require("net"); const s=net.createServer(); s.listen(process.argv[1]); setInterval(()=>{},1e9);', sock], { stdio: 'ignore' })
  child.unref()
  if (child.pid) socketPids.push(child.pid)
  const started = Date.now()
  while (!existsSync(sock)) {
    if (Date.now() - started > 5000) throw new Error(`pm2 套接字没建起来：${sock}`)
    spawnSync('sleep', ['0.05'])
  }
  return sock
}

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let st
    try { st = statSync(path) } catch { continue }
    if (st.isDirectory()) walkFiles(path, acc)
    else acc.push(path)
  }
  return acc
}

function runPrecheck(extraEnv = {}, opts = {}) {
  const td = realpathSync(mkdtempSync(join(tmpdir(), 'precheck-gate-')))
  boxes.push(td)
  const bin = join(td, 'bin')
  const home = join(td, 'home')
  const shortHome = makeShortHome()
  const srv = join(td, 'srv')
  const tmp = join(td, 'tmp')
  const live = join(td, 'live')
  const syslog = join(td, 'syslog')
  const pg = join(td, 'pg')
  const apt = join(td, 'apt')
  const redis = join(td, 'redis')
  const expect = join(td, 'expect')
  const backup = join(td, 'backups')
  const pm2Log = join(td, 'pm2-calls.log')
  const pythonLog = join(td, 'python-calls.log')
  for (const dir of [bin, home, srv, tmp, live, syslog, pg, apt, redis, expect, backup, join(expect, '.git')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(expect, '.git', 'gitprobe-unique'), 'x\n')
  if (!opts.noSocket) startSocket(shortHome)
  writeExec(join(bin, 'node'), `#!/usr/bin/env bash
if [ "$1" = "-e" ] || [ "$1" = "-p" ]; then exec "\${REAL_NODE}" "$@"; fi
if [ "\${DRILL_NODE_FAIL:-}" = 1 ]; then exit 1; fi
printf '%s\\n' "\${DRILL_NODE_V:-v22.12.0}"
`)
  writeExec(join(bin, 'python3'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DRILL_PYTHON_LOG}"
exit 1
`)
  writeExec(join(bin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "9.15.0"\n')
  writeExec(join(bin, 'pm2'), `#!/usr/bin/env bash
printf '%s\\n' "call $*" >> "\${DRILL_PM2_LOG}"
printf '%s\\n' "\${DRILL_PM2_JLIST:-[]}"
`)
  writeExec(join(bin, 'nginx'), '#!/usr/bin/env bash\n[ "$1" = "-T" ] && cat "${DRILL_NGINX_CONF:-/dev/null}"\nexit 0\n')
  writeExec(join(bin, 'certbot'), '#!/usr/bin/env bash\nexit 0\n')
  writeExec(join(bin, 'systemctl'), `#!/usr/bin/env bash
echo "NEXT LEFT LAST PASSED UNIT ACTIVATES"
echo "2026-10-06 03:00:00 6d 2026-09-01 03:00:00 1d certbot.timer certbot.service"
`)
  writeExec(join(bin, 'openssl'), '#!/usr/bin/env bash\necho "notAfter=Dec  1 00:00:00 2027 GMT"\n')
  writeExec(join(bin, 'redis-cli'), `#!/usr/bin/env bash
if [ "\${DRILL_REDIS_FAIL:-}" = 1 ]; then exit 1; fi
if [ "$1" = ping ]; then printf '%s\\n' PONG; exit 0; fi
if [ "$1" = CONFIG ]; then printf '%s\\n' dir; printf '%s\\n' "\${DRILL_REDIS_DIR:-${redis}}"; exit 0; fi
if [ "$1" = INFO ]; then
  printf '%s\\n' '# Memory'
  printf '%s\\n' 'used_memory:1572864'
  printf '%s\\n' 'used_memory_human:1.50M'
  printf '%s\\n' 'used_memory_peak_human:2.00M'
  printf '%s\\n' 'executable:/usr/bin/redis-server'
  printf '%s\\n' 'CANARY_REDIS=secret-from-redis-info'
  exit 0
fi
exit 1
`)
  writeExec(join(bin, 'free'), `#!/usr/bin/env bash
if [ "\${DRILL_FREE_FAIL:-}" = 1 ]; then exit 1; fi
printf '%s\\n' '               total        used        free      shared  buff/cache   available'
printf '%s\\n' 'Mem:            7940        2100         800         100        5000        5400'
printf '%s\\n' 'Swap:           2048         256        1792'
printf '%s\\n' 'CANARY_FREE=secret-from-free'
`)
  writeExec(join(bin, 'ps'), `#!/usr/bin/env bash
if [ "\${DRILL_PS_FAIL:-}" = 1 ]; then exit 1; fi
if [ "$*" = "-eo rss=,comm=" ]; then
  printf '%s\\n' '10240 postgres'
  printf '%s\\n' '10240 postgres: writer'
  printf '%s\\n' '99999 redis-server'
  exit 0
fi
printf '%s\\n' 'CANARY_CMDLINE secret-from-ps node dist/main.js --env DATABASE_URL=leak'
exit 0
`)
  writeExec(join(bin, 'journalctl'), `#!/usr/bin/env bash
case "$*" in
  *--disk-usage*) echo "Archived and active journals take up 12M in the file system." ;;
  *--list-boots*) printf '%s\\n' " -1 abc 2024-01-15 00:00:00 UTC 2024-02-01 00:00:00 UTC" "  0 def 2026-09-28 00:00:00 UTC 2026-09-29 00:00:00 UTC" ;;
  *) echo "2020-01-01T00:00:00+0000 oldest" ;;
esac
`)
  writeExec(join(bin, 'psql'), `#!/usr/bin/env bash
sql=\$(cat || true)
if ! printf '%s' "\$sql" | grep -q 'oversize-paid-unfinished-count'; then
  exit 1
fi
if [ -n "\${DRILL_PSQL_SQL_OUT:-}" ]; then
  printf '%s' "\$sql" > "\${DRILL_PSQL_SQL_OUT}"
fi
if [ -n "\${DRILL_PSQL_ARGS_OUT:-}" ]; then
  printf '%s\\n' "\$*" > "\${DRILL_PSQL_ARGS_OUT}"
fi
mode="\${DRILL_PSQL_MODE:-fail}"
case "\$mode" in
  number)
    printf '%s\\n' "\${DRILL_PSQL_STDOUT:-0}"
    exit 0
    ;;
  text)
    printf '%s\\n' "\${DRILL_PSQL_STDOUT:-not-a-number}"
    exit 0
    ;;
  *)
    if [ -n "\${DRILL_PSQL_STDOUT:-}" ]; then
      printf '%s\\n' "\${DRILL_PSQL_STDOUT}"
    fi
    if [ -n "\${DRILL_PSQL_STDERR:-}" ]; then
      printf '%s\\n' "\${DRILL_PSQL_STDERR}" >&2
    fi
    exit 1
    ;;
esac
`)
  writeExec(join(bin, 'sudo'), `#!/usr/bin/env bash
if [ "\$1" = "-n" ] && [ "\$2" = "-u" ] && [ "\$4" = "psql" ]; then
  shift 4
  exec psql "\$@"
fi
exit 1
`)
  writeExec(join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n')
  writeExec(join(bin, 'df'), '#!/usr/bin/env bash\nprintf "%s\\n" 100\n')
  writeExec(join(bin, 'du'), `#!/usr/bin/env bash
target=""
for a in "$@"; do
  case "$a" in
    -*) ;;
    *) target="$a"; break ;;
  esac
done
case "$target" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
    exec "\${REAL_DU}" "$@" ;;
esac
printf '1\\t%s\\n' "\${target:-.}"
`)
  writeExec(join(bin, 'find'), `#!/usr/bin/env bash
target=""
for a in "$@"; do
  case "$a" in
    -*) ;;
    *) target="$a"; break ;;
  esac
done
case "$target" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
    exec /usr/bin/find "$@" ;;
esac
exit 0
`)
  const script = join(td, 'precheck.sh')
  writeFileSync(script, precheckSh)
  chmodSync(script, 0o755)
  const env = {
    PATH: `${bin}:${toolDir}:/usr/bin:/bin`,
    HOME: shortHome,
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
    REAL_NODE: realNode,
    REAL_DU: realDu,
    PRECHECK_HOME: home,
    PRECHECK_SRV: srv,
    PRECHECK_TMP: tmp,
    PRECHECK_LE_LIVE: live,
    PRECHECK_SYSLOG_DIR: syslog,
    PRECHECK_PG_LOG: pg,
    PRECHECK_APT: apt,
    EXPECT_DIR: expect,
    EXPECT_PM2: 'ai-job-print-api',
    EXPECT_BACKUP: backup,
    DRILL_NODE_V: 'v22.12.0',
    DRILL_PM2_JLIST: '[]',
    DRILL_PM2_LOG: pm2Log,
    DRILL_PYTHON_LOG: pythonLog,
    DRILL_NGINX_CONF: join(td, 'empty.conf'),
    ...extraEnv,
  }
  if (extraEnv.DRILL_PSQL_MODE) {
    env.DRILL_PSQL_SQL_OUT = join(td, 'psql-oversize.sql')
    env.DRILL_PSQL_ARGS_OUT = join(td, 'psql-oversize.args')
  }
  if (extraEnv && Object.prototype.hasOwnProperty.call(extraEnv, 'DRILL_NGINX_BODY')) {
    writeFileSync(env.DRILL_NGINX_CONF, extraEnv.DRILL_NGINX_BODY)
  } else if (!existsSync(env.DRILL_NGINX_CONF)) {
    mkdirSync(dirname(env.DRILL_NGINX_CONF), { recursive: true })
    writeFileSync(env.DRILL_NGINX_CONF, 'http {}\n')
  }
  const before = opts.snapshot ? new Set([...walkFiles(td), ...walkFiles(shortHome)]) : null
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' })
  const created = []
  if (before) {
    for (const path of [...walkFiles(td), ...walkFiles(shortHome)]) {
      if (!before.has(path) && path !== pm2Log && path !== pythonLog) created.push(path)
    }
  }
  return {
    td, home, shortHome, srv, tmp, live, syslog, pg, apt, redis, expect, backup, bin, pm2Log, pythonLog,
    psqlSql: join(td, 'psql-oversize.sql'),
    psqlArgs: join(td, 'psql-oversize.args'),
    created,
    code: result.status ?? 1,
    out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

function nginxConf(body, td) {
  const path = join(td, 'nginx.conf')
  writeFileSync(path, body)
  return path
}

const now = Date.now()
const recent = new Date(now - 86400000)
const old = new Date(now - 20 * 86400000)
const edge = new Date(now - 7 * 86400000 + 3 * 3600000)

function fieldConf(logPath) {
  return `http {
  log_format main '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" $server_port';
  access_log ${logPath} main;
  server { listen 80; server_name example.com; }
  server { listen [::]:443 ssl; }
}
`
}

// —— 静态：过时数字、白名单、接线、描述、${VAR} ——
// 旧断言：P-old S7 S10 S11。S9（内联副本逐字节一致）已删除，改为 S-wire。
if (want('P-old')) check(!['19.75GB', '8.5GB', '88%', '35GB', '27GB'].some((token) => precheckYml.includes(token) || precheckSh.includes(token)),
  'P-old 预检注释不再引用过时的具体用量')
if (want('S7')) check(!cleanupSh.includes('/srv/node_modules') && !cleanupSh.includes('/srv/services'),
  'S7 清理白名单不含 /srv/node_modules 与 /srv/services')

const executeDesc = /execute:\n\s+description: '([^']*)'/.exec(cleanupYml)?.[1] ?? ''
if (want('S10')) check(executeDesc.includes('STALE_CRITICAL_FREE_MB') && executeDesc.includes('直接删除') && executeDesc.includes('将隔离'),
  'S10 execute 输入说明写了告急阈值、直接删除和隔离', executeDesc)

function nonAsciiVarHits(text) {
  return text.split('\n').map((line, index) => [index + 1, line]).filter(([, line]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(line))
}
const varHits = [
  ...nonAsciiVarHits(cleanupSh),
  ...nonAsciiVarHits(precheckSh),
]
if (want('S11')) check(varHits.length === 0, 'S11 变量后不紧跟非 ASCII（写成 ${VAR}）', varHits.map(([n, line]) => `${n}:${line}`).join(' | '))

if (want('S-wire', 'S-concurrency')) {
  const pin = `appleboy/ssh-action@${SSH_SHA} # v1.2.5`
  const inputLines = cleanupYml.split('\n').filter((line) => line.includes('${{ inputs.'))
  const inputOk = inputLines.length === 3 && inputLines.every((line) => /^\s*[A-Z0-9_]+:\s*\$\{\{\s*inputs\.[A-Za-z0-9_]+\s*\}\}\s*$/.test(line))
  const deployUntouched = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8').includes('appleboy/ssh-action@v1.0.3')
  const serverUntouched = readFileSync(join(root, '.github/workflows/server-cleanup.yml'), 'utf8').includes('appleboy/ssh-action@v1.0.3')
  if (want('S-wire')) check(
    precheckYml.includes(pin)
      && cleanupYml.includes(pin)
      && precheckYml.includes('script_path: .github/scripts/deploy-precheck.sh')
      && cleanupYml.includes('script_path: .github/scripts/cleanup-stale-releases.sh')
      && precheckYml.includes('actions/checkout@v4')
      && cleanupYml.includes('actions/checkout@v4')
      && !precheckYml.includes('base64')
      && !cleanupYml.includes('base64')
      && !/base64\s+-d|<<'B64'/.test(precheckYml)
      && !/base64\s+-d|<<'B64'/.test(cleanupYml)
      && !precheckYml.includes('mktemp')
      && !cleanupYml.includes('mktemp')
      && !precheckSh.includes('mktemp')
      && !cleanupSh.includes('mktemp')
      && !/^ {10}script: \|/m.test(precheckYml)
      && !/^ {10}script: \|/m.test(cleanupYml)
      && inputOk
      && deployUntouched
      && serverUntouched
      && !precheckYml.includes('appleboy/ssh-action@v1.0.3')
      && !cleanupYml.includes('appleboy/ssh-action@v1.0.3'),
    'S-wire 两个工作流用 script_path、40 位 SHA，且没有 base64 内联',
    inputLines.join(' || '),
  )
  if (want('S-concurrency')) check(
    /concurrency:\n {2}group: production-deploy\n {2}cancel-in-progress: false/.test(cleanupYml),
    'S-concurrency 清理与发布共用 production-deploy，且不取消进行中的运行',
    cleanupYml.slice(0, 800),
  )
}

// —— P1 日志格式不含端口 ——
if (want('P1')) {
  const probe = runPrecheck({})
  const conf = nginxConf(`http {
  log_format combined '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent';
  access_log ${join(probe.td, 'access-drill-secret.log')} combined;
  server { listen 80; }
  server { listen 443 ssl; }
}
`, probe.td)
  writeFileSync(join(probe.td, 'access-drill-secret.log'), combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK01/heartbeat HTTP/1.1', 443))
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(probe.td, { recursive: true, force: true })
  check(run.code === 0 && run.out.includes(INDET) && !run.out.includes('PLAINTEXT_API_COUNT=0') && !run.out.includes('HTTPS_HEARTBEAT_COUNT_7D') && !run.out.includes('TERMINAL_API '),
    'P1 日志格式不含端口时输出 indeterminate，而不是 0', run.out.slice(0, 800))
}

// —— P2 / P4 / P5 443 心跳为 0、不泄露 IP、7 天外不计入 ——
if (want('P2', 'P4', 'P5')) {
  const draft = runPrecheck({})
  const log = join(draft.td, 'access-drill-secret.log')
  let body = ''
  body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK01/heartbeat HTTP/1.1', 80)
  body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK01/status HTTP/1.1', 80)
  body += combinedLine('198.51.100.10', nginxStamp(old), 'GET /api/v1/terminals/OLD99/heartbeat HTTP/1.1', 443)
  body += combinedLine(IP, nginxStamp(edge, '+0800'), 'GET /api/v1/terminals/TZEDGE/heartbeat HTTP/1.1', 443)
  writeFileSync(log, body)
  const conf = nginxConf(fieldConf(log), draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && /HTTPS_HEARTBEAT_COUNT_7D=0/.test(run.out) && run.out.includes(WARN),
    'P2 443 心跳为 0 时打 warning', run.out)
  check(run.code === 0 && run.out.includes('terminal=KIOSK01') && run.out.includes('kind=heartbeat') && run.out.includes('kind=other') && !IP_RE.test(run.out) && !run.out.includes('access-drill-secret') && !run.out.includes(IP),
    'P4 读了含 IP 的访问日志，但输出没有 IP 或日志文件名', run.out)
  check(!run.out.includes('OLD99') && !run.out.includes('TZEDGE'),
    'P5 7 天以前和时区折算后超窗的请求不计入', run.out)
}

// —— P9 字段模式数到 443 心跳时不警告 ——
if (want('P9')) {
  const draft = runPrecheck({})
  const log = join(draft.td, 'access-field.log')
  writeFileSync(log, combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK02/heartbeat HTTP/1.1', 443))
  const conf = nginxConf(fieldConf(log), draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && /HTTPS_HEARTBEAT_COUNT_7D=1/.test(run.out) && run.out.includes('port=443 terminal=KIOSK02 kind=heartbeat count=1') && !run.out.includes(WARN),
    'P9 $server_port 数到 443 心跳时不警告', run.out)
}

// —— 文件模式 + gzip 轮转 ——
if (want('P-file', 'P-gz')) {
  const draft = runPrecheck({})
  const log80 = join(draft.td, 'port80.log')
  const log443 = join(draft.td, 'port443.log')
  writeFileSync(log80, combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK02/status HTTP/1.1', 80))
  writeFileSync(log443, '')
  const gz = join(draft.td, 'port443.log.1.gz')
  writeFileSync(gz, gzipSync(combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/GZ1/heartbeat HTTP/1.1', 443)))
  const stale = join(draft.td, 'port443.log.2.gz')
  writeFileSync(stale, gzipSync(combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/ROTOLD/heartbeat HTTP/1.1', 443)))
  const oldDate = new Date(now - 30 * 86400000)
  utimesSync(stale, oldDate, oldDate)
  const conf = nginxConf(`http {
  server { listen 80; access_log ${log80}; }
  server { listen 443 ssl; access_log ${log443}; }
}
`, draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && run.out.includes('port=80 terminal=KIOSK02 kind=other count=1') && !run.out.includes(INDET) && !run.out.includes(WARN),
    'P-file 80 与 443 日志分开时按文件统计', run.out)
  check(run.out.includes('port=443 terminal=GZ1 kind=heartbeat count=1') && !run.out.includes('ROTOLD'),
    'P-gz 近 7 天的 .gz 计入，更老的轮转文件跳过', run.out)
}

// —— $scheme ——
if (want('P-scheme')) {
  const draft = runPrecheck({})
  const log = join(draft.td, 'scheme.log')
  const stamp = nginxStamp(recent)
  writeFileSync(log, `${IP} - - [${stamp}] "GET /api/v1/terminals/KIOSK03/heartbeat HTTP/1.1" 200 https\n`)
  const conf = nginxConf(`http {
  log_format main '$remote_addr - $remote_user [$time_local] "$request" $status $scheme';
  access_log ${log} main;
  server { listen 80; }
  server { listen 443 ssl; }
}
`, draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && run.out.includes('port=443 terminal=KIOSK03 kind=heartbeat count=1') && !run.out.includes(WARN),
    'P-scheme $scheme 为 https 时记入 443', run.out)
}

// —— 版本、证书、残留目录、增长项 ——
if (want('P6', 'P8', 'P8b', 'P3', 'P10', 'P11')) {
  const draft = runPrecheck({})
  mkdirSync(join(draft.live, 'example.com'))
  writeFileSync(join(draft.live, 'example.com', 'cert.pem'), 'x')
  mkdirSync(join(draft.live, 'README'))
  writeFileSync(join(draft.live, 'README', 'cert.pem'), 'x')
  mkdirSync(join(draft.srv, 'node_modules'))
  writeFileSync(join(draft.srv, 'node_modules', 'blob'), Buffer.alloc(1024 * 1024, 1))
  symlinkSync(join(draft.srv, 'node_modules'), join(draft.srv, 'services'))
  mkdirSync(join(draft.srv, 'ai-job-print-artifacts'))
  for (const [dir, name] of [[join(draft.home, '.cache', 'libreoffice'), 'a'], [join(draft.home, '.cache', 'chromium'), 'a'], [join(draft.home, '.cache', 'puppeteer'), 'a'], [join(draft.home, '.npm'), 'a'], [join(draft.home, '.cache', 'node', 'corepack'), 'a']]) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), Buffer.alloc(1024 * 1024, 2))
  }
  for (const name of ['lu123', 'soffice.bin', '.org.chromium.abc']) {
    mkdirSync(join(draft.tmp, name))
    writeFileSync(join(draft.tmp, name, 'a'), Buffer.alloc(2 * 1024 * 1024, 3))
  }
  mkdirSync(join(draft.tmp, 'unrelated'))
  writeFileSync(join(draft.tmp, 'unrelated', 'a'), Buffer.alloc(8 * 1024 * 1024, 4))
  writeFileSync(join(draft.syslog, 'syslog'), Buffer.alloc(1024 * 1024, 5))
  writeFileSync(join(draft.syslog, 'auth.log'), Buffer.alloc(1024 * 1024, 5))
  writeFileSync(join(draft.syslog, 'other.log'), Buffer.alloc(8 * 1024 * 1024, 5))
  writeFileSync(join(draft.pg, 'a'), Buffer.alloc(1024 * 1024, 6))
  writeFileSync(join(draft.apt, 'a'), Buffer.alloc(1024 * 1024, 7))
  writeFileSync(join(draft.redis, 'dump.rdb'), Buffer.alloc(1024 * 1024, 8))
  mkdirSync(join(draft.redis, 'appendonlydir'))
  writeFileSync(join(draft.redis, 'appendonlydir', 'a'), Buffer.alloc(1024 * 1024, 8))
  const conf = nginxConf(`server { listen 80; alias ${draft.srv}/ai-job-print-artifacts/; }\n`, draft.td)
  const jlist = JSON.stringify([{
    node_version: 'v22.14.0',
    exec_interpreter: '/usr/bin/node',
    pm_cwd: `${draft.srv}/node_modules`,
    pm2_env: { cwd: `${draft.srv}/node_modules`, pm_exec_path: '/bin/true' },
  }])
  const run = runPrecheck({
    DRILL_NGINX_CONF: conf,
    DRILL_PM2_JLIST: jlist,
    DRILL_NODE_V: 'v22.12.0',
    DRILL_REDIS_DIR: draft.redis,
    PRECHECK_HOME: draft.home,
    PRECHECK_SRV: draft.srv,
    PRECHECK_TMP: draft.tmp,
    PRECHECK_LE_LIVE: draft.live,
    PRECHECK_SYSLOG_DIR: draft.syslog,
    PRECHECK_PG_LOG: draft.pg,
    PRECHECK_APT: draft.apt,
    EXPECT_DIR: draft.expect,
  })
  const out = run.out
  const metric = (key) => out.match(new RegExp(`${key}=([^\\s]+)`))?.[1] ?? ''
  check(run.code === 0 && metric('NODE_OK_FOR_PDFJS') === 'yes' && metric('PM2_NODE_VERSION') === 'v22.14.0' && metric('NODE_VERSION') === 'v22.12.0' && metric('PNPM_VERSION') === '9.15.0',
    'P6 PM2 的 node 达到 22.13 时 NODE_OK=yes，即使 PATH 上的 node 更旧', out)
  check(out.includes('CERT_EXPIRES domain=example.com end=2027-12-01') && !out.includes('cert.pem') && !out.includes('domain=README'),
    'P8 只打域名目录和到期日', out)
  check(out.includes('CERTBOT_INSTALLED=yes') && out.includes('CERTBOT_TIMER_PRESENT=yes') && out.includes('CERTBOT_TIMER_NEXT=2026-10-06'),
    'P8b certbot 已安装，定时器下次触发只打日期', out)
  const leftoverNames = ['node_modules', 'services', 'ai-job-print-api-backups', 'ai-job-print-env-backups', 'ai-job-print-artifacts', 'ai-job-print-static-releases', 'ai-job-print-recovery-artifacts']
  check(leftoverNames.every((name) => out.includes(`SRV_LEFTOVER name=${name} `)) && /name=node_modules size_mb=\d+ mtime=\d{4}-\d{2}-\d{2} referenced_by=pm2$/.test(out.split('\n').find((line) => line.includes('name=node_modules')) ?? '')
    && /referenced_by=nginx$/.test(out.split('\n').find((line) => line.includes('name=ai-job-print-artifacts')) ?? '')
    && /name=services size_mb=unknown mtime=unknown referenced_by=none$/.test(out.split('\n').find((line) => line.includes('name=services')) ?? '')
    && /name=ai-job-print-env-backups size_mb=absent mtime=none referenced_by=none$/.test(out.split('\n').find((line) => line.includes('name=ai-job-print-env-backups')) ?? ''),
    'P3 残留目录被 pm2 引用时 referenced_by=pm2，nginx alias 记 nginx', out)
  check(metric('JOURNAL_OLDEST_DATE') === '2024-01-15' && metric('JOURNAL_SIZE_MB') === '12',
    'P10 journal 最早日期来自 list-boots', out)
  const tmpMb = Number(metric('TMP_LO_CHROME_MB'))
  const chromeMb = Number(metric('CACHE_CHROMIUM_MB'))
  const dumpMb = Number(metric('REDIS_DUMP_MB'))
  const aofMb = Number(metric('REDIS_APPENDONLY_MB'))
  const growthKeys = ['CACHE_LIBREOFFICE_MB', 'CACHE_PUPPETEER_MB', 'SYSLOG_AUTH_MB', 'POSTGRESQL_LOG_MB', 'NPM_CACHE_MB', 'COREPACK_CACHE_MB', 'APT_CACHE_MB']
  check(run.code === 0 && chromeMb >= 1 && tmpMb >= 4 && tmpMb <= 8 && dumpMb >= 1 && aofMb >= 1 && metric('GIT_DIR_MB') !== 'unknown'
    && growthKeys.every((key) => Number(metric(key)) >= 1) && Number(metric('SYSLOG_AUTH_MB')) <= 4
    && !out.includes(draft.home) && !out.includes(draft.srv) && !out.includes('gitprobe-unique') && !out.includes('dump.rdb'),
    'P11 增长项只打数字，不打目录或文件名', `chrome=${chromeMb} tmp=${tmpMb} dump=${dumpMb} aof=${aofMb} syslog=${metric('SYSLOG_AUTH_MB')}\n${out}`)
  rmSync(draft.td, { recursive: true, force: true })
}

if (want('P7')) {
  const run = runPrecheck({
    DRILL_NODE_V: 'v22.20.0',
    DRILL_PM2_JLIST: JSON.stringify([{ node_version: 'v22.12.0', exec_interpreter: '/usr/bin/node' }]),
  })
  check(run.code === 0 && /NODE_OK_FOR_PDFJS=no/.test(run.out) && /PM2_NODE_VERSION=v22\.12\.0/.test(run.out),
    'P7 PM2 的 node 低于 22.13 时 NODE_OK=no，即使 PATH 上的 node 更新', run.out)
}

if (want('P-interp')) {
  const draft = runPrecheck({})
  const interp = join(draft.td, 'fake-node')
  writeExec(interp, '#!/usr/bin/env bash\nprintf "%s\\n" "v22.16.0"\n')
  const run = runPrecheck({
    DRILL_NODE_V: 'v22.12.0',
    DRILL_PM2_JLIST: JSON.stringify([{ exec_interpreter: interp }]),
  })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && /PM2_NODE_VERSION=v22\.16\.0/.test(run.out) && /NODE_OK_FOR_PDFJS=yes/.test(run.out) && !run.out.includes(interp),
    'P-interp 没有 node_version 时从 exec_interpreter 读版本，不打路径', run.out)
}

if (want('P-redis')) {
  const draft = runPrecheck({})
  rmSync(join(draft.bin, 'redis-cli'))
  const script = join(draft.td, 'precheck.sh')
  const env = {
    PATH: `${draft.bin}:${toolDir}:/usr/bin:/bin`,
    HOME: draft.shortHome,
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
    REAL_NODE: realNode,
    REAL_DU: realDu,
    PRECHECK_HOME: draft.home,
    PRECHECK_SRV: draft.srv,
    PRECHECK_TMP: draft.tmp,
    PRECHECK_LE_LIVE: draft.live,
    PRECHECK_SYSLOG_DIR: draft.syslog,
    PRECHECK_PG_LOG: draft.pg,
    PRECHECK_APT: draft.apt,
    EXPECT_DIR: draft.expect,
    EXPECT_PM2: 'ai-job-print-api',
    EXPECT_BACKUP: draft.backup,
    DRILL_NGINX_CONF: join(draft.td, 'empty.conf'),
    DRILL_PM2_JLIST: '[]',
    DRILL_PM2_LOG: draft.pm2Log,
    DRILL_PYTHON_LOG: draft.pythonLog,
    DRILL_NODE_V: 'v22.12.0',
  }
  writeFileSync(env.DRILL_NGINX_CONF, 'http {}\n')
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' })
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  rmSync(draft.td, { recursive: true, force: true })
  check((result.status ?? 1) === 0 && /REDIS_DUMP_MB=unknown/.test(out) && /REDIS_APPENDONLY_MB=unknown/.test(out),
    'P-redis 读不到 Redis 目录时写 unknown，而不是 0', out)
}

// —— 内存：假 pm2 / free / redis-cli / ps，只留数字 ——
if (want('P12a', 'P12b', 'P12c', 'P12d', 'P12e', 'P13a', 'P13b', 'P13c', 'P-no-python')) {
  const upMs = Date.now() - (5 * 3600 + 600) * 1000
  const jlist = JSON.stringify([
    {
      name: 'other-worker',
      monit: { memory: 50 * 1024 * 1024 },
      pm2_env: {
        restart_time: 99,
        pm_uptime: upMs,
        axm_monitor: { 'Heap Used': { value: '9.00', unit: 'MiB' }, 'Heap Size': { value: '40.00', unit: 'MiB' } },
        env: { DATABASE_URL: 'postgres://leak-secret@198.51.100.8/db', NODE_OPTIONS: '--require /tmp/should-not-print.js' },
        args: ['dist/other.js'],
      },
    },
    {
      name: 'ai-job-print-api',
      monit: { memory: 180 * 1024 * 1024 },
      pm2_env: {
        restart_time: 4,
        pm_uptime: upMs,
        axm_monitor: {
          'Heap Size': { value: '90.00', unit: 'MiB' },
          'Heap Used': { value: '62.40', unit: 'MiB' },
        },
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://api-secret-token@203.0.113.77/app',
          NODE_OPTIONS: '--require /tmp/should-not-print.js',
        },
        args: ['dist/main.js', '--inspect'],
        node_version: 'v22.14.0',
      },
    },
  ])
  const run = runPrecheck({ DRILL_PM2_JLIST: jlist, DRILL_NODE_V: 'v22.14.0' })
  const section = run.out.split('=== 17.')[1] ?? ''
  const lineOf = (key) => section.split('\n').find((line) => line.startsWith(`${key}=`)) ?? ''
  const numeric = (key, value) => {
    const line = lineOf(key)
    return line === `${key}=${value}` && !/env/i.test(line)
  }
  if (want('P12a', 'P12b', 'P12c', 'P12d', 'P12e', 'P13a', 'P13b', 'P13c')) {
    check(run.code === 0 && numeric('PM2_API_RSS_MB', '180') && !lineOf('PM2_API_RSS_MB').includes('50'),
      'P12a API 常驻内存取该进程 monit.memory，不取其它进程', section)
    check(numeric('PM2_API_HEAP_MB', '62') && !section.includes('Heap Size') && !section.includes('90.00'),
      'P12b 堆用量取 Heap Used，不取 Heap Size', section)
    check(numeric('PM2_API_RESTARTS', '4'),
      'P12c 重启次数取 API 进程的 restart_time', section)
    check(numeric('PM2_API_UPTIME_HOURS', '5'),
      'P12d pm_uptime 换成已运行小时数', section)
    check(run.code === 0 && !/env/i.test(section) && !IP_RE.test(section) && !section.includes('api-secret-token')
      && !section.includes('leak-secret') && !section.includes('dist/main.js') && !section.includes('NODE_OPTIONS')
      && !section.includes('should-not-print') && !section.includes('DATABASE_URL'),
      'P12e 内存段不含 env 字样、密钥、地址或启动参数', section)
    check(numeric('MEM_TOTAL_MB', '7940') && numeric('MEM_AVAILABLE_MB', '5400') && numeric('SWAP_USED_MB', '256')
      && !section.includes('CANARY_FREE') && !section.includes('Mem:') && !section.includes('buff/cache'),
      'P13a free -m 只打总内存、可用内存和 swap 已用', section)
    check(lineOf('REDIS_USED_MEMORY_HUMAN') === 'REDIS_USED_MEMORY_HUMAN=1.50M' && !/env/i.test(lineOf('REDIS_USED_MEMORY_HUMAN'))
      && !section.includes('CANARY_REDIS') && !section.includes('used_memory_peak') && !section.includes('executable'),
      'P13b Redis 只打 used_memory_human', section)
    check(numeric('POSTGRES_RSS_MB', '20') && !section.includes('postgres') && !section.includes('CANARY_CMDLINE')
      && !section.includes('redis-server') && !section.includes('dist/main.js'),
      'P13c PostgreSQL 进程 RSS 合计，不打命令行', section)
  }
  if (want('P-no-python')) check(run.code === 0 && numeric('PM2_API_RSS_MB', '180') && !existsSync(run.pythonLog) && !precheckSh.includes('python3'),
    'P-no-python 内存四项不调用 python3', `${section}\npython=${existsSync(run.pythonLog)}`)
  rmSync(run.td, { recursive: true, force: true })
}

if (want('P14a', 'P14b', 'P14c', 'P14d')) {
  const run = runPrecheck({
    DRILL_PM2_JLIST: '[]',
    DRILL_REDIS_FAIL: '1',
    DRILL_FREE_FAIL: '1',
    DRILL_PS_FAIL: '1',
  })
  const section = run.out.split('=== 17.')[1] ?? ''
  const lineOf = (key) => section.split('\n').find((line) => line.startsWith(`${key}=`)) ?? ''
  check(run.code === 0 && lineOf('PM2_API_RSS_MB') === 'PM2_API_RSS_MB=unknown'
    && lineOf('PM2_API_HEAP_MB') === 'PM2_API_HEAP_MB=unknown'
    && lineOf('PM2_API_RESTARTS') === 'PM2_API_RESTARTS=unknown'
    && lineOf('PM2_API_UPTIME_HOURS') === 'PM2_API_UPTIME_HOURS=unknown'
    && !/PM2_API_RSS_MB=0/.test(section),
    'P14a 读不到 PM2 内存时写 unknown，而不是 0', section)
  check(lineOf('MEM_TOTAL_MB') === 'MEM_TOTAL_MB=unknown'
    && lineOf('MEM_AVAILABLE_MB') === 'MEM_AVAILABLE_MB=unknown'
    && lineOf('SWAP_USED_MB') === 'SWAP_USED_MB=unknown'
    && !/MEM_TOTAL_MB=0/.test(section),
    'P14b free 失败时内存写 unknown，而不是 0', section)
  check(lineOf('REDIS_USED_MEMORY_HUMAN') === 'REDIS_USED_MEMORY_HUMAN=unknown'
    && !/REDIS_USED_MEMORY_HUMAN=0/.test(section),
    'P14c 读不到 Redis 内存时写 unknown，而不是 0', section)
  check(lineOf('POSTGRES_RSS_MB') === 'POSTGRES_RSS_MB=unknown' && !/POSTGRES_RSS_MB=0/.test(section),
    'P14d ps 失败时 PostgreSQL 内存写 unknown，而不是 0', section)
  rmSync(run.td, { recursive: true, force: true })
}

if (want('P-pm2-down')) {
  const run = runPrecheck({}, { noSocket: true })
  check(run.code === 0 && !existsSync(run.pm2Log) && /PM2_DAEMON=down/.test(run.out)
    && /PM2_NAME_DEFAULT_OK=unknown/.test(run.out) && /PM2_API_RSS_MB=unknown/.test(run.out),
    'P-pm2-down 套接字不在时不调用 pm2，相关项写 unknown', run.out)
}

if (want('P-node-unknown')) {
  const down = runPrecheck({ DRILL_NODE_FAIL: '1' }, { noSocket: true })
  const garbage = runPrecheck({
    DRILL_NODE_FAIL: '1',
    DRILL_PM2_JLIST: JSON.stringify([{ node_version: 'not-a-version' }]),
  })
  check(/NODE_OK_FOR_PDFJS=unknown/.test(down.out) && !/NODE_OK_FOR_PDFJS=no/.test(down.out)
    && /NODE_OK_FOR_PDFJS=unknown/.test(garbage.out) && !/NODE_OK_FOR_PDFJS=no/.test(garbage.out),
    'P-node-unknown 版本读不到或解析失败时写 unknown，不写 no', `${down.out}\n---\n${garbage.out}`)
}

if (want('P-root')) {
  const draft = runPrecheck({})
  const rootHome = join(draft.td, 'roothome')
  mkdirSync(rootHome)
  const secret = 'super-secret-root-filename'
  writeFileSync(join(rootHome, secret), Buffer.alloc(1024 * 1024, 7))
  const run = runPrecheck({ PRECHECK_ROOT_HOME: rootHome })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && /ROOT_HOME_MB=\d+/.test(run.out) && !run.out.includes(secret)
    && !precheckSh.includes('/root/*') && !precheckSh.includes('/root/.[!.]*'),
    'P-root 只打 /root 合计 MB，不打文件名', run.out)
}

if (want('P-term-invalid')) {
  const draft = runPrecheck({})
  const log = join(draft.td, 'invalid-term.log')
  let body = ''
  body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/bad.id/heartbeat HTTP/1.1', 443)
  body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/$(touchpwn)/status HTTP/1.1', 80)
  body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK01/heartbeat HTTP/1.1', 443)
  writeFileSync(log, body)
  const conf = nginxConf(fieldConf(log), draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && run.out.includes('terminal=invalid_format') && run.out.includes('terminal=KIOSK01')
    && !run.out.includes('bad.id') && !run.out.includes('touchpwn'),
    'P-term-invalid 非白名单终端编号只计 invalid_format，不回显原文', run.out)
}

if (want('P-trunc')) {
  const draft = runPrecheck({})
  const log = join(draft.td, 'trunc.log')
  let body = ''
  for (let i = 0; i < 5; i += 1) {
    body += combinedLine(IP, nginxStamp(recent), 'GET /api/v1/terminals/KIOSK01/heartbeat HTTP/1.1', 443)
  }
  writeFileSync(log, body)
  const conf = nginxConf(fieldConf(log), draft.td)
  const run = runPrecheck({ DRILL_NGINX_CONF: conf, PRECHECK_LOG_LINE_CAP: '3' })
  rmSync(draft.td, { recursive: true, force: true })
  check(run.code === 0 && /truncated=yes/.test(run.out) && run.out.includes('port=443 terminal=KIOSK01 kind=heartbeat count=3')
    && !run.out.includes('count=5') && precheckSh.includes('2000000'),
    'P-trunc 超过行数上限时截断并标明 truncated=yes', run.out)
}

if (want('P-early')) {
  const run = runPrecheck({}, { snapshot: true })
  check(run.code === 0 && run.created.length === 0 && run.out.includes('=== 1. ') && run.out.includes('=== 11. ')
    && /API_DIR_DEFAULT_OK=yes/.test(run.out) && /REDIS_REACHABLE=yes/.test(run.out) && /API_HEALTH_LOCAL=ok/.test(run.out)
    && !precheckSh.includes('mktemp'),
    'P-early 整份预检 1–11 节真的跑了，且没有新文件', `created=${run.created.join(',')} code=${run.code}\n${run.out.slice(0, 1500)}`)
}

// 假 psql 回显的订单号和文件名。预检输出里不能出现。
const OVERSIZE_LEAK_ORDER = 'ord-leak-99188'
const OVERSIZE_LEAK_FILE = 'secret-resume.pdf'
const OVERSIZE_PG_EXPECT = '5'
const OVERSIZE_DML = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i
const OVERSIZE_FIXTURE = `
CREATE TABLE "Order" (
  id text PRIMARY KEY,
  "payStatus" text NOT NULL,
  "taskStatus" text NOT NULL,
  "billablePages" integer,
  "printParamsJson" text NOT NULL
);
CREATE TABLE "OrderItem" (
  id text PRIMARY KEY,
  "orderId" text NOT NULL REFERENCES "Order"(id),
  "billablePages" integer NOT NULL,
  "copies" integer NOT NULL
);
INSERT INTO "Order" (id, "payStatus", "taskStatus", "billablePages", "printParamsJson") VALUES
  ('${OVERSIZE_LEAK_ORDER}', 'paid', 'pending', NULL, '{"fileName":"${OVERSIZE_LEAK_FILE}","copies":9}'),
  ('ord-no-items', 'paid', 'pending', 60, '{"copies": 2}'),
  ('ord-bad-json', 'paid', 'printing', 10, '{not json "copies": 50, "fileName":"${OVERSIZE_LEAK_FILE}"}'),
  ('ord-exact-100', 'paid', 'pending', 100, '{"copies":1}'),
  ('ord-101', 'paid', 'claimed', 101, '{"copies":1}'),
  ('ord-completed', 'paid', 'completed', 200, '{"copies":1}'),
  ('ord-unpaid', 'unpaid', 'pending', 200, '{"copies":1}'),
  ('ord-items-small', 'paid', 'pending', 500, '{"copies":9}'),
  ('ord-null-pages', 'paid', 'pending', NULL, '{"copies":9}'),
  ('ord-failed', 'paid', 'failed', 200, '{}'),
  ('ord-cancelled', 'paid', 'cancelled', 200, '{}'),
  ('ord-string-copies', 'paid', 'pending', 80, '{"copies":"9"}'),
  ('ord-float-copies', 'paid', 'pending', 80, '{"copies":1.5}'),
  ('ord-zero-copies', 'paid', 'pending', 101, '{"copies":0}'),
  ('ord-missing-copies', 'paid', 'pending', 101, '{}');
INSERT INTO "OrderItem" (id, "orderId", "billablePages", "copies") VALUES
  ('item-a1', '${OVERSIZE_LEAK_ORDER}', 40, 2),
  ('item-a2', '${OVERSIZE_LEAK_ORDER}', 21, 1),
  ('item-h1', 'ord-items-small', 5, 2);
`

function psqlExec(psql, sock, port, args, input) {
  return spawnSync(psql, ['-h', sock, '-p', String(port), '-U', 'postgres', '-d', 'postgres', ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, PGHOST: sock, PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'postgres' },
  })
}

function runOversizePg(sql) {
  const initdb = commandPath('initdb')
  const postgres = commandPath('postgres')
  const psql = commandPath('psql')
  const pgCtl = commandPath('pg_ctl')
  if (!initdb || !postgres || !psql || !pgCtl) {
    return { skipped: true, out: '', note: 'PATH 里没有 initdb、postgres、psql 或 pg_ctl，计数 SQL 没真跑' }
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'oversize-pg-')))
  const data = join(dir, 'data')
  const sock = join(dir, 'sock')
  mkdirSync(sock)
  const init = spawnSync(initdb, ['-D', data, '--username=postgres', '--auth=trust', '--no-sync', '--locale=C'], { encoding: 'utf8' })
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true })
    return { skipped: true, out: '', note: `initdb 没成功，计数 SQL 没真跑：${(init.stderr || init.stdout || '').slice(0, 300)}` }
  }
  const port = 25000 + (process.pid % 20000)
  const child = spawn(postgres, ['-D', data, '-k', sock, '-p', String(port), '-c', 'listen_addresses='], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  const stop = () => {
    spawnSync(pgCtl, ['-D', data, '-m', 'immediate', 'stop'], { encoding: 'utf8' })
    try { process.kill(child.pid, 'SIGTERM') } catch { /* 已退出 */ }
    rmSync(dir, { recursive: true, force: true })
  }
  let up = false
  for (let i = 0; i < 50; i += 1) {
    const ping = psqlExec(psql, sock, port, ['-tAc', 'SELECT 1'])
    if (ping.status === 0 && (ping.stdout || '').trim() === '1') { up = true; break }
    spawnSync('sleep', ['0.1'])
  }
  if (!up) {
    stop()
    return { skipped: false, out: '', note: '本机临时 PostgreSQL 没接受连接，计数 SQL 没跑完' }
  }
  const made = psqlExec(psql, sock, port, ['-v', 'ON_ERROR_STOP=1'], OVERSIZE_FIXTURE)
  if (made.status !== 0) {
    const detail = `${made.stdout || ''}\n${made.stderr || ''}`
    stop()
    return { skipped: false, out: detail, note: '临时库建表或灌数失败' }
  }
  const query = psqlExec(psql, sock, port, ['-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1'], sql)
  const out = query.stdout || ''
  const err = query.stderr || ''
  stop()
  if (query.status !== 0) return { skipped: false, out: `${out}\n${err}`, note: '计数查询失败' }
  return { skipped: false, out, count: out.trim(), note: '' }
}

if (want('S-oversize-num', 'S-oversize-err', 'S-oversize-nan', 'S-oversize-leak', 'S-oversize-ro', 'S-oversize-pg', 'S-oversize-pgver')) {
  const leakText = `${OVERSIZE_LEAK_ORDER}\n${OVERSIZE_LEAK_FILE}`
  const numbered = runPrecheck({ DRILL_PSQL_MODE: 'number', DRILL_PSQL_STDOUT: '17' })
  const failed = runPrecheck({
    DRILL_PSQL_MODE: 'fail',
    DRILL_PSQL_STDOUT: leakText,
    DRILL_PSQL_STDERR: leakText,
  })
  const dirty = runPrecheck({ DRILL_PSQL_MODE: 'text', DRILL_PSQL_STDOUT: `nope\n${leakText}` })
  const sql = existsSync(numbered.psqlSql) ? readFileSync(numbered.psqlSql, 'utf8') : ''
  const args = existsSync(numbered.psqlArgs) ? readFileSync(numbered.psqlArgs, 'utf8') : ''
  if (want('S-oversize-num')) check(
    numbered.code === 0 && /^OVERSIZE_PAID_UNFINISHED_ORDERS=17$/m.test(numbered.out),
    'S-oversize-num 假 psql 返回数字时原样输出该数字',
    numbered.out,
  )
  if (want('S-oversize-err')) check(
    failed.code === 0 && /^OVERSIZE_PAID_UNFINISHED_ORDERS=unknown$/m.test(failed.out),
    'S-oversize-err 查询失败时输出 unknown',
    failed.out,
  )
  if (want('S-oversize-nan')) check(
    dirty.code === 0 && /^OVERSIZE_PAID_UNFINISHED_ORDERS=unknown$/m.test(dirty.out),
    'S-oversize-nan 结果不是纯数字时输出 unknown',
    dirty.out,
  )
  if (want('S-oversize-leak')) check(
    !failed.out.includes(OVERSIZE_LEAK_ORDER) && !failed.out.includes(OVERSIZE_LEAK_FILE)
      && !dirty.out.includes(OVERSIZE_LEAK_ORDER) && !dirty.out.includes(OVERSIZE_LEAK_FILE)
      && !numbered.out.includes(OVERSIZE_LEAK_ORDER) && !numbered.out.includes(OVERSIZE_LEAK_FILE),
    'S-oversize-leak 输出里没有假数据的订单号和文件名',
    `${failed.out}\n---\n${dirty.out}`,
  )
  if (want('S-oversize-ro')) check(
    sql.includes('BEGIN READ ONLY')
      && !OVERSIZE_DML.test(sql)
      && args.includes('-X') && args.includes('-q') && args.includes('-tA') && args.includes('ON_ERROR_STOP=1')
      && precheckSh.includes('OVERSIZE_MAX_SIDES=100')
      && precheckSh.includes('PRINT_MAX_SIDES_PER_ORDER')
      && sql.includes('> 100'),
    'S-oversize-ro 查询只读，上限变量指向 PRINT_MAX_SIDES_PER_ORDER',
    `args=${args}\n${sql.slice(0, 500)}`,
  )
  if (want('S-oversize-pg')) {
    const pg = runOversizePg(sql)
    if (pg.skipped) {
      console.log(`  NOTE S-oversize-pg ${pg.note}`)
    } else {
      check(
        pg.count === OVERSIZE_PG_EXPECT
          && !pg.out.includes(OVERSIZE_LEAK_ORDER)
          && !pg.out.includes(OVERSIZE_LEAK_FILE),
        `S-oversize-pg 临时 PostgreSQL 计数为 ${OVERSIZE_PG_EXPECT}`,
        `${pg.note}\n${pg.out}`,
      )
    }
  }
  if (want('S-oversize-pgver')) check(
    sql.includes('substring(')
      && sql.includes('"copies"\\s*:\\s*([1-9][0-9]{0,3})\\s*[,}]')
      && sql.includes('BEGIN READ ONLY')
      && !sql.includes('pg_input_is_valid')
      && !precheckSh.includes('pg_input_is_valid'),
    'S-oversize-pgver 查询文本用 substring 取 copies，不含 pg_input_is_valid',
    sql.slice(0, 900),
  )
}

// —— 清理脚本 ——
function runCleanup(options) {
  const {
    free,
    mode,
    confirm = '',
    curlFail = false,
    curlBody = '',
    pm2Name = '',
    pm2Cwd = '',
    nginxName = '',
    pm2Socket = true,
    pm2Fail = false,
    pm2LateName = '',
    mountFail = false,
    findFail = false,
    psFail = false,
    readlinkFail = false,
    nginxUp = Boolean(nginxName),
    nginxFail = false,
    nginxBody = null,
    duGap = false,
    rmFail = false,
    statCross = false,
    makeTrashLink = false,
    purgePath = null,
    inject = false,
    refStyle = '',
    purgeStyle = '',
  } = options
  const td = realpathSync(mkdtempSync(join(tmpdir(), 'stale-gate-')))
  if (td.includes('/srv')) throw new Error(`临时目录含 /srv：${td}`)
  boxes.push(td)
  const rootDir = join(td, 'root')
  mkdirSync(rootDir)
  const shortHome = makeShortHome()
  if (pm2Socket) startSocket(shortHome)
  for (const name of NEW_WHITELIST) {
    const dir = join(rootDir, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'blob'), Buffer.alloc(2 * 1024 * 1024, 9))
  }
  mkdirSync(join(rootDir, 'node_modules'))
  writeFileSync(join(rootDir, 'node_modules', 'keep'), 'keep')
  mkdirSync(join(rootDir, 'services'))
  writeFileSync(join(rootDir, 'services', 'keep'), 'keep')
  mkdirSync(join(rootDir, 'ai-job-print-backups'))
  const bin = join(td, 'bin')
  mkdirSync(bin)
  const pm2Log = join(td, 'pm2-calls.log')
  writeExec(join(bin, 'du'), `#!/usr/bin/env bash
has_x=no
target=""
for a in "$@"; do
  case "$a" in
    -*x*) has_x=yes ;;
    -*) ;;
    *) target="$a" ;;
  esac
done
case "$target" in
  ${rootDir}/ai-job-print-backups) printf '2048\\t%s\\n' "$target"; exit 0 ;;
esac
if [ "\${DRILL_DU_GAP:-}" = 1 ]; then
  if [ "$has_x" = yes ]; then printf '1\\t%s\\n' "$target"; else printf '10\\t%s\\n' "$target"; fi
  exit 0
fi
exec ${realDu} "$@"
`)
  writeExec(join(bin, 'df'), `#!/usr/bin/env bash
printf '%s\\n' "Filesystem 1048576-blocks Used Available Capacity Mounted on"
printf '%s\\n' "drill 100 10 \${DRILL_DF_AVAIL_MB:-9000} 50% /"
`)
  writeExec(join(bin, 'curl'), `#!/usr/bin/env bash
if [ "\${DRILL_CURL_FAIL:-}" = 1 ]; then exit 1; fi
if [ -n "\${DRILL_CURL_BODY:-}" ]; then
  printf '%s\\n' "\${DRILL_CURL_BODY}"
else
  printf '%s\\n' '{"success":true,"data":{"status":"ok","db":"postgresql"}}'
fi
`)
  writeExec(join(bin, 'pm2'), `#!/usr/bin/env bash
printf '%s\\n' "call $*" >> "\${DRILL_PM2_LOG}"
if [ "\${DRILL_PM2_FAIL:-}" = 1 ]; then exit 1; fi
n=$(wc -l < "\${DRILL_PM2_LOG}" | tr -d ' ')
if [ "$n" -ge 2 ] && [ -n "\${DRILL_PM2_LATE:-}" ]; then
  printf '%s\\n' "\${DRILL_PM2_LATE}"
  exit 0
fi
printf '%s\\n' "\${DRILL_PM2_JLIST:-[]}"
`)
  writeExec(join(bin, 'nginx'), `#!/usr/bin/env bash
if [ "\${DRILL_NGINX_FAIL:-}" = 1 ]; then exit 1; fi
[ "$1" = "-T" ] && cat "\${DRILL_NGINX_CONF:-/dev/null}"
exit 0
`)
  writeExec(join(bin, 'lsof'), '#!/usr/bin/env bash\nexit 1\n')
  writeExec(join(bin, 'node'), `#!/usr/bin/env bash
if [ "$1" = "-e" ] || [ "$1" = "-p" ]; then exec "\${REAL_NODE}" "$@"; fi
printf '%s\\n' "v22.14.0"
`)
  writeExec(join(bin, 'mount'), `#!/usr/bin/env bash
if [ "\${DRILL_MOUNT_FAIL:-}" = 1 ]; then exit 1; fi
printf '%s\\n' "/dev/disk1 on / type ext4 (rw)"
printf '%s\\n' "/dev/disk2 on /tmp type ext4 (rw)"
`)
  writeExec(join(bin, 'find'), `#!/usr/bin/env bash
if [ "\${DRILL_FIND_FAIL:-}" = 1 ]; then exit 1; fi
exit 0
`)
  writeExec(join(bin, 'ps'), `#!/usr/bin/env bash
if [ "\${DRILL_PS_FAIL:-}" = 1 ]; then exit 1; fi
if [ "\${DRILL_NGINX_UP:-}" = 1 ]; then printf '%s\\n' nginx; fi
exit 0
`)
  writeExec(join(bin, 'readlink'), `#!/usr/bin/env bash
if [ "\${DRILL_READLINK_FAIL:-}" = 1 ]; then exit 1; fi
exec "${join(toolDir, 'readlink')}" "$@"
`)
  writeExec(join(bin, 'realpath'), `#!/usr/bin/env bash
if [ "\${DRILL_READLINK_FAIL:-}" = 1 ]; then exit 1; fi
exec "${join(toolDir, 'realpath')}" "$@"
`)
  writeExec(join(bin, 'stat'), `#!/usr/bin/env bash
if [ "\${DRILL_STAT_XDEV:-}" != 1 ]; then exec "\${REAL_STAT}" "$@"; fi
path="\${@: -1}"
case "$path" in
  "\${DRILL_ROOT}"|"\${DRILL_ROOT}/.cleanup-trash"|"\${DRILL_ROOT}/.cleanup-trash/"*) printf '%s\\n' 1 ;;
  *) printf '%s\\n' 2 ;;
esac
`)
  writeExec(join(bin, 'rm'), `#!/usr/bin/env bash
if [ "\${DRILL_RM_FAIL:-}" = 1 ]; then exit 1; fi
exec /bin/rm "$@"
`)
  const targetName = 'ai-job-print-api-backups'
  let styledCwd = pm2Cwd
  let styledNginx = nginxBody
  let styledUp = nginxUp
  if (refStyle === 'dotdot') styledCwd = `${rootDir}/${targetName}/../${targetName}`
  if (refStyle === 'slash') styledCwd = `${rootDir}//${targetName}`
  if (refStyle === 'symlink') {
    const link = join(td, 'ref-link')
    symlinkSync(join(rootDir, targetName), link)
    styledNginx = `events {}\nserver { root ${link}; }\n`
    styledUp = true
  }
  if (refStyle === 'multiline') {
    styledNginx = `events {}\nserver {\n  root\n    ${rootDir}/${targetName};\n}\n`
    styledUp = true
  }
  if (refStyle === 'parent') {
    styledNginx = `events {}\nhttp { root ${rootDir}; }\n`
    styledUp = true
  }
  if (refStyle === 'variable') {
    styledNginx = 'events {}\nserver { root $document_root; }\n'
    styledUp = true
  }
  const pm2Path = styledCwd || (pm2Name ? join(rootDir, pm2Name) : '')
  const nginxAlias = nginxName ? join(rootDir, nginxName) : ''
  const conf = join(td, 'nginx.conf')
  const body = styledNginx != null
    ? styledNginx
    : (nginxAlias
      ? `# alias ${rootDir}/ai-job-print-env-backups\nevents {}\nserver { listen 80; alias ${nginxAlias}/; include ${nginxAlias}/mime.types; }\n`
      : 'events {}\n')
  writeFileSync(conf, body)
  const jlist = pm2Path
    ? JSON.stringify([{
      name: 'api',
      status: join(rootDir, 'ai-job-print-static-releases'),
      pm_cwd: pm2Path,
      pm2_env: { pm_cwd: pm2Path, cwd: pm2Path, pm_exec_path: '/bin/true' },
    }])
    : '[]'
  const late = pm2LateName
    ? JSON.stringify([{
      name: 'api',
      pm_cwd: join(rootDir, pm2LateName),
      pm2_env: { cwd: join(rootDir, pm2LateName), pm_exec_path: '/bin/true' },
    }])
    : ''
  let outside = ''
  if (makeTrashLink) {
    outside = join(td, 'outside-trash')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep'), 'keep')
    symlinkSync(outside, join(rootDir, '.cleanup-trash'))
  }
  const script = cleanupSh.replaceAll('/srv', rootDir)
  const sp = join(td, 'cleanup.sh')
  writeFileSync(sp, script)
  chmodSync(sp, 0o755)
  const canary = join(td, 'canary-inject')
  const env = {
    PATH: `${bin}:${toolDir}:/usr/bin:/bin`,
    LC_ALL: 'C',
    LANG: 'C',
    HOME: shortHome,
    REAL_NODE: realNode,
    REAL_STAT: realStat,
    DRILL_DF_AVAIL_MB: String(free),
    DRILL_CURL_FAIL: curlFail ? '1' : '',
    DRILL_CURL_BODY: curlBody,
    DRILL_PM2_JLIST: jlist,
    DRILL_PM2_LOG: pm2Log,
    DRILL_PM2_FAIL: pm2Fail ? '1' : '',
    DRILL_PM2_LATE: late,
    DRILL_NGINX_CONF: conf,
    DRILL_NGINX_UP: styledUp ? '1' : '',
    DRILL_NGINX_FAIL: nginxFail ? '1' : '',
    DRILL_MOUNT_FAIL: mountFail ? '1' : '',
    DRILL_FIND_FAIL: findFail ? '1' : '',
    DRILL_PS_FAIL: psFail ? '1' : '',
    DRILL_READLINK_FAIL: readlinkFail ? '1' : '',
    DRILL_DU_GAP: duGap ? '1' : '',
    DRILL_RM_FAIL: rmFail ? '1' : '',
    DRILL_STAT_XDEV: statCross ? '1' : '',
    DRILL_ROOT: rootDir,
    CLEANUP_MODE: mode,
    CLEANUP_CONFIRM: confirm,
    CLEANUP_EXPECT_CONFIRM: 'CLEANUP-CONFIRM',
  }
  if (purgePath != null) env.CLEANUP_PURGE_PATH = purgePath
  if (inject) {
    env.CLEANUP_PURGE_PATH = `${rootDir}/.cleanup-trash/$(touch ${canary})\n"quoted"`
    env.CLEANUP_CONFIRM = `$(touch ${canary})"`
  }
  const stampKeep = join(rootDir, '.cleanup-trash', '20260101T010101', 'keep')
  if (purgeStyle) {
    const stamp = join(rootDir, '.cleanup-trash', '20260101T010101')
    mkdirSync(stamp, { recursive: true })
    writeFileSync(join(stamp, 'keep'), 'keep')
    env.CLEANUP_CONFIRM = 'CLEANUP-CONFIRM'
    if (purgeStyle === 'slash') env.CLEANUP_PURGE_PATH = `${rootDir}/.cleanup-trash//`
    if (purgeStyle === 'dot') env.CLEANUP_PURGE_PATH = `${rootDir}/.cleanup-trash/.`
    if (purgeStyle === 'nested') {
      const extra = join(stamp, 'extra')
      mkdirSync(extra)
      writeFileSync(join(extra, 'keep'), 'keep')
      env.CLEANUP_PURGE_PATH = extra
    }
    if (purgeStyle === 'link') {
      const link = join(rootDir, '.cleanup-trash', 'link')
      symlinkSync(stamp, link)
      env.CLEANUP_PURGE_PATH = link
    }
  }
  const result = spawnSync('bash', [sp], { cwd: td, env, encoding: 'utf8' })
  return {
    td, rootDir, pm2Log, canary, outside, stampKeep,
    code: result.status ?? 1,
    out: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    exists: (name) => existsSync(join(rootDir, name)),
  }
}

function bothCounters(out) {
  return /^QUARANTINED_MB=\d+$/m.test(out) && /^FREED_MB=\d+$/m.test(out)
}

function keptNames(run, names) {
  return names.every((name) => run.exists(name))
}

function keptAll(run) {
  return keptNames(run, NEW_WHITELIST) && run.exists('node_modules') && run.exists('services')
}

if (want('S1', 'S6a')) {
  const dryHigh = runCleanup({ free: 8000, mode: 'dry-run' })
  const plans = NEW_WHITELIST.map((name) => `PLAN_QUARANTINE ${dryHigh.rootDir}/${name}`)
  const skippedOld = (dryHigh.out.match(/不存在，跳过/g) ?? []).length
  check(dryHigh.code === 0 && plans.every((line) => dryHigh.out.includes(line)) && skippedOld === 6 && keptNames(dryHigh, NEW_WHITELIST),
    'S1 新白名单 5 个目录可被识别，原 6 个不存在时跳过', dryHigh.out)
  check(dryHigh.out.includes('将隔离') && !dryHigh.out.includes('将直接删除') && keptNames(dryHigh, NEW_WHITELIST) && !existsSync(join(dryHigh.rootDir, '.cleanup-trash')) && bothCounters(dryHigh.out) && /DF_AVAIL_MB_BEFORE=8000/.test(dryHigh.out) && /DF_AVAIL_MB_AFTER=8000/.test(dryHigh.out),
    'S6a 可用不低于阈值的 dry-run 预告将隔离且不改文件', dryHigh.out)
}

if (want('S6b', 'S5a')) {
  const dryLow = runCleanup({ free: 1000, mode: 'dry-run' })
  const plans = NEW_WHITELIST.every((name) => dryLow.out.includes(`PLAN_DELETE ${dryLow.rootDir}/${name}`))
  check(dryLow.code === 0 && dryLow.out.includes('将直接删除') && !dryLow.out.includes('将隔离') && plans && keptNames(dryLow, NEW_WHITELIST) && dryLow.exists('node_modules') && dryLow.exists('services') && !existsSync(join(dryLow.rootDir, '.cleanup-trash')),
    'S6b 可用低于阈值的 dry-run 预告将直接删除且不改文件', dryLow.out)
  check(bothCounters(dryLow.out) && /QUARANTINED_MB=0/.test(dryLow.out) && /FREED_MB=[1-9]/.test(dryLow.out) && /DF_AVAIL_MB_BEFORE=1000/.test(dryLow.out) && /DF_AVAIL_MB_AFTER=1000/.test(dryLow.out),
    'S5a dry-run 同时输出 QUARANTINED_MB 与 FREED_MB，并打印前后可用空间', dryLow.out)
}

if (want('S4a', 'S3a')) {
  const at = runCleanup({ free: 5120, mode: 'dry-run' })
  const below = runCleanup({ free: 5119, mode: 'dry-run' })
  check(at.code === 0 && at.out.includes('CLEANUP_ACTION=quarantine') && at.out.includes('将隔离') && keptNames(at, NEW_WHITELIST),
    'S4a 可用等于阈值时计划隔离', at.out)
  check(below.code === 0 && below.out.includes('CLEANUP_ACTION=delete') && below.out.includes('将直接删除') && keptNames(below, NEW_WHITELIST),
    'S3a 可用比阈值少 1MB 时计划直接删除', below.out)
}

if (want('S2', 'S3b', 'S5b')) {
  const low = runCleanup({
    free: 1000,
    mode: 'execute',
    confirm: 'CLEANUP-CONFIRM',
    pm2Name: 'ai-job-print-api-backups',
    nginxName: 'ai-job-print-artifacts',
  })
  const removed = ['ai-job-print-env-backups', 'ai-job-print-static-releases', 'ai-job-print-recovery-artifacts']
  check(low.code === 0
    && low.out.includes('被 pm2 引用')
    && low.out.includes('被 nginx 引用')
    && low.exists('ai-job-print-api-backups')
    && low.exists('ai-job-print-artifacts')
    && removed.every((name) => !low.exists(name))
    && low.exists('node_modules')
    && low.exists('services'),
    'S2 被 pm2 或 nginx 引用的目录拒绝处理，注释和无关字段不算引用', low.out)
  check(low.code === 0
    && low.out.includes('CLEANUP_ACTION=delete')
    && !existsSync(join(low.rootDir, '.cleanup-trash'))
    && removed.every((name) => low.out.includes(`DELETE ${low.rootDir}/${name}`))
    && !low.out.includes(`DELETE ${low.rootDir}/ai-job-print-api-backups`)
    && !low.out.includes(`DELETE ${low.rootDir}/ai-job-print-artifacts`)
    && !low.out.includes(`DELETE ${low.rootDir}/node_modules`)
    && !low.out.includes(`DELETE ${low.rootDir}/services`)
    && removed.every((name) => !low.exists(name))
    && low.exists('node_modules')
    && low.exists('services')
    && low.exists('ai-job-print-backups'),
    'S3b 可用低于阈值时直接删除，且只删通过护栏的目录', low.out)
  check(bothCounters(low.out) && /QUARANTINED_MB=0/.test(low.out) && /FREED_MB=[1-9]/.test(low.out) && /DF_AVAIL_MB_BEFORE=1000/.test(low.out) && /DF_AVAIL_MB_AFTER=/.test(low.out),
    'S5b execute 直接删除时 QUARANTINED_MB 与 FREED_MB 都输出', low.out)
}

if (want('S4b')) {
  const high = runCleanup({ free: 8000, mode: 'execute', confirm: 'CLEANUP-CONFIRM' })
  const trash = join(high.rootDir, '.cleanup-trash')
  const stamps = existsSync(trash) ? readdirSync(trash) : []
  const moved = stamps.length === 1 ? readdirSync(join(trash, stamps[0])) : []
  check(high.code === 0
    && high.out.includes('CLEANUP_ACTION=quarantine')
    && !/^DELETE /m.test(high.out)
    && NEW_WHITELIST.every((name) => !high.exists(name) && moved.includes(name))
    && high.exists('node_modules')
    && high.exists('services')
    && high.exists('ai-job-print-backups')
    && /QUARANTINED_MB=[1-9]/.test(high.out)
    && /FREED_MB=0/.test(high.out)
    && /DF_AVAIL_MB_BEFORE=8000/.test(high.out)
    && /DF_AVAIL_MB_AFTER=/.test(high.out),
    'S4b 可用不低于阈值时移到隔离区，不直接删除', high.out)
}

if (want('S-confirm')) {
  const bad = runCleanup({ free: 1000, mode: 'execute', confirm: 'nope' })
  check(bad.code !== 0 && bad.out.includes('confirm 不匹配') && keptNames(bad, NEW_WHITELIST) && bad.exists('node_modules') && !existsSync(join(bad.rootDir, '.cleanup-trash')),
    'S-confirm 确认词不对时不删除也不隔离', bad.out)
}

if (want('S-health')) {
  const sick = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', curlFail: true })
  check(sick.code !== 0 && sick.out.includes('健康检查不通过') && keptNames(sick, NEW_WHITELIST) && sick.exists('node_modules') && !existsSync(join(sick.rootDir, '.cleanup-trash')),
    'S-health 健康检查不通过时不删除', sick.out)
}

function refuseDir(id, options, needle) {
  if (!want(id)) return
  const run = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', ...options })
  check(keptAll(run) && run.out.includes(needle) && !/^DELETE /m.test(run.out),
    `${id} 探针或引用不可用时拒绝该目录，不动文件`, run.out)
}

refuseDir('S-probe-mount', { mountFail: true }, 'mount 不可用')
refuseDir('S-probe-find', { findFail: true }, 'find 不可用')
refuseDir('S-probe-ps', { psFail: true }, 'ps 不可用')
refuseDir('S-probe-readlink', { readlinkFail: true }, 'readlink 不可用')
refuseDir('S-probe-nginx', { nginxUp: true, nginxFail: true }, '不可判定')
refuseDir('S-probe-pm2', { pm2Fail: true }, '不可判定')

if (want('S-pm2-down')) {
  const run = runCleanup({ free: 8000, mode: 'dry-run', pm2Socket: false })
  check(!existsSync(run.pm2Log) && keptAll(run) && run.out.includes('不可判定') && !run.out.includes('PLAN_'),
    'S-pm2-down 清理时读不到 pm2 就不调用，并拒绝删除', run.out)
}

if (want('S-degraded')) {
  const run = runCleanup({
    free: 1000,
    mode: 'execute',
    confirm: 'CLEANUP-CONFIRM',
    curlBody: '{"success":true,"data":{"status":"degraded","db":"postgresql"}}',
  })
  check(run.code !== 0 && keptAll(run) && run.out.includes('不是 data.status=ok') && run.out.includes('健康检查不通过'),
    'S-degraded 健康返回 degraded 时不动文件', run.out)
}

function oneRef(id, refStyle, message) {
  if (!want(id)) return
  const run = runCleanup({
    free: 1000,
    mode: 'execute',
    confirm: 'CLEANUP-CONFIRM',
    refStyle,
  })
  check(run.exists('ai-job-print-api-backups') && !run.exists('ai-job-print-env-backups') && run.exists('node_modules'),
    message, run.out)
}

oneRef('S-ref-dotdot', 'dotdot', 'S-ref-dotdot 引用路径含 .. 时仍算引用，只拒绝该目录')
oneRef('S-ref-slash', 'slash', 'S-ref-slash 引用路径含重复斜杠时仍算引用，只拒绝该目录')
oneRef('S-ref-symlink', 'symlink', 'S-ref-symlink 引用是软链时仍算引用，只拒绝该目录')
oneRef('S-ref-multiline', 'multiline', 'S-ref-multiline nginx root 跨行时仍算引用，只拒绝该目录')

if (want('S-ref-parent')) {
  const run = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', refStyle: 'parent' })
  check(keptAll(run) && run.out.includes('被 nginx 引用') && !/^DELETE /m.test(run.out),
    'S-ref-parent nginx root 指父目录时每个子目录都算被引用', run.out)
}
if (want('S-ref-var')) {
  const run = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', refStyle: 'variable' })
  check(keptAll(run) && run.out.includes('不可判定') && !/^DELETE /m.test(run.out),
    'S-ref-var root 带变量时整份 nginx 不可判定，拒绝删除', run.out)
}

function prepareStamp(rootDir, name) {
  const dir = join(rootDir, '.cleanup-trash', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'keep'), 'keep')
  return dir
}

function purgeRefuses(id, purgeStyle, needle) {
  if (!want(id)) return
  const run = runCleanup({ free: 8000, mode: 'dry-run', confirm: 'CLEANUP-CONFIRM', purgeStyle })
  check(run.code !== 0 && existsSync(run.stampKeep) && run.out.includes(needle),
    `${id} 拒绝这次 purge，隔离目录还在`, run.out)
}
purgeRefuses('S-purge-slash', 'slash', '只允许删')
purgeRefuses('S-purge-dot', 'dot', '只允许删')
purgeRefuses('S-purge-nested', 'nested', '只允许删')
purgeRefuses('S-purge-link', 'link', '不许是软链')

if (want('S-trash-link')) {
  const quarantine = runCleanup({ free: 8000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', makeTrashLink: true })
  const purge = runCleanup({ free: 8000, mode: 'dry-run', makeTrashLink: true, purgePath: 'ignored' })
  check(quarantine.code !== 0 && quarantine.out.includes('隔离区根目录是软链') && keptAll(quarantine) && existsSync(join(quarantine.outside, 'keep')),
    'S-trash-link 隔离区是软链时拒绝隔离', quarantine.out)
  check(purge.code !== 0 && purge.out.includes('隔离区根目录是软链') && existsSync(join(purge.outside, 'keep')),
    'S-trash-link 隔离区是软链时拒绝 purge', purge.out)
}

if (want('S-rm-fail')) {
  const run = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', rmFail: true })
  check(run.code !== 0 && keptAll(run) && /^FREED_MB=0$/m.test(run.out) && run.out.includes('WARNING'),
    'S-rm-fail 删除失败时不计入 FREED_MB，退出码非 0', run.out)
}

if (want('S-du-diff')) {
  const dry = runCleanup({ free: 1000, mode: 'dry-run', duGap: true })
  const exec = runCleanup({ free: 1000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', duGap: true })
  check(dry.code === 0 && dry.out.includes('体积') && dry.out.includes('PLAN_DELETE') && keptAll(dry)
    && keptAll(exec) && exec.out.includes('体积差超过 1MB') && !/^DELETE /m.test(exec.out),
    'S-du-diff 体积差超过 1MB 时 execute 拒绝，dry-run 仍只报告', `${dry.out}\n---\n${exec.out}`)
}

if (want('S-xdev')) {
  const run = runCleanup({ free: 8000, mode: 'execute', confirm: 'CLEANUP-CONFIRM', statCross: true })
  check(run.code !== 0 && keptAll(run) && run.out.includes('不在同一文件系统') && !existsSync(join(run.rootDir, '.cleanup-trash')),
    'S-xdev 与隔离区不在同一文件系统时拒绝该目录', run.out)
}

if (want('S-recheck')) {
  const run = runCleanup({
    free: 1000,
    mode: 'execute',
    confirm: 'CLEANUP-CONFIRM',
    pm2LateName: 'ai-job-print-api-backups',
  })
  check(run.exists('ai-job-print-api-backups') && !run.exists('ai-job-print-env-backups')
    && run.out.includes('删除前复查') && !run.out.includes(`DELETE ${run.rootDir}/ai-job-print-api-backups`),
    'S-recheck 删除前重新发现引用时跳过该目录，其它继续', run.out)
}

if (want('S-inject')) {
  const run = runCleanup({ free: 8000, mode: 'dry-run', confirm: 'CLEANUP-CONFIRM', inject: true })
  const inputLines = cleanupYml.split('\n').filter((line) => line.includes('${{ inputs.'))
  check(!existsSync(run.canary) && run.code !== 0 && inputLines.length > 0,
    'S-inject 输入里的引号、命令替换和换行不会被执行', run.out)
}


if (failures) {
  console.error(`\nverify:server-maintenance-workflows：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:server-maintenance-workflows：通过')
process.exit(0)
