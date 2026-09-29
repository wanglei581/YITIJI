// verify:server-maintenance-workflows
//
// 用假命令真跑 deploy-precheck 的只读探测段，以及 cleanup-stale-releases.sh。
// 只用 node 内置模块，可在 pnpm install 之前跑。
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// 反向变异时把改坏的副本放到这个目录，缺省读仓库本身。
const sourceRoot = process.env.MAINT_FIXTURE_DIR || root
const precheckYmlPath = '.github/workflows/deploy-precheck.yml'
const cleanupYmlPath = '.github/workflows/cleanup-stale-releases.yml'
const cleanupShPath = '.github/scripts/cleanup-stale-releases.sh'
const precheckYml = readFileSync(join(sourceRoot, precheckYmlPath), 'utf8')
const cleanupYml = readFileSync(join(sourceRoot, cleanupYmlPath), 'utf8')
const cleanupSh = readFileSync(join(sourceRoot, cleanupShPath), 'utf8')

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
const toolDir = dirname(realDu)

function writeExec(path, body) {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

function extractBetween(text, startMarker, endMarker) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.includes(startMarker))
  const end = lines.findIndex((line, index) => index > start && line.includes(endMarker))
  if (start < 0 || end < 0) throw new Error(`找不到片段：${startMarker} → ${endMarker}`)
  const block = lines.slice(start, end)
  const indent = (block[0].match(/^\s*/) ?? [''])[0].length
  return block.map((line) => line.slice(Math.min(indent, (line.match(/^\s*/) ?? [''])[0].length))).join('\n')
}

function pad(n) { return String(n).padStart(2, '0') }
function nginxStamp(date, offset = '+0000') {
  return `${pad(date.getUTCDate())}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${offset}`
}
function combinedLine(ip, stamp, req, port) {
  return `${ip} - - [${stamp}] "${req}" 200 12 "-" "-" ${port}\n`
}

const precheckBody = extractBetween(precheckYml, '=== 12. ', '=== 完成：以上均为只读探测')
const boxes = []
process.on('exit', () => {
  for (const td of boxes) {
    try { rmSync(td, { recursive: true, force: true }) } catch { /* 临时目录已清 */ }
  }
})

function runPrecheck(extraEnv) {
  const td = realpathSync(mkdtempSync(join(tmpdir(), 'precheck-gate-')))
  boxes.push(td)
  const bin = join(td, 'bin')
  const home = join(td, 'home')
  const srv = join(td, 'srv')
  const tmp = join(td, 'tmp')
  const live = join(td, 'live')
  const syslog = join(td, 'syslog')
  const pg = join(td, 'pg')
  const apt = join(td, 'apt')
  const redis = join(td, 'redis')
  const expect = join(td, 'expect')
  for (const dir of [bin, home, srv, tmp, live, syslog, pg, apt, redis, expect, join(expect, '.git')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(expect, '.git', 'gitprobe-unique'), 'x\n')
  writeExec(join(bin, 'node'), '#!/usr/bin/env bash\nprintf "%s\\n" "${DRILL_NODE_V:-v22.12.0}"\n')
  writeExec(join(bin, 'pnpm'), '#!/usr/bin/env bash\nprintf "%s\\n" "9.15.0"\n')
  writeExec(join(bin, 'pm2'), '#!/usr/bin/env bash\nprintf "%s\\n" "${DRILL_PM2_JLIST:-[]}"\n')
  writeExec(join(bin, 'nginx'), '#!/usr/bin/env bash\n[ "$1" = "-T" ] && cat "${DRILL_NGINX_CONF:-/dev/null}"\nexit 0\n')
  writeExec(join(bin, 'certbot'), '#!/usr/bin/env bash\nexit 0\n')
  writeExec(join(bin, 'systemctl'), `#!/usr/bin/env bash
echo "NEXT LEFT LAST PASSED UNIT ACTIVATES"
echo "2026-10-06 03:00:00 6d 2026-09-01 03:00:00 1d certbot.timer certbot.service"
`)
  writeExec(join(bin, 'openssl'), '#!/usr/bin/env bash\necho "notAfter=Dec  1 00:00:00 2027 GMT"\n')
  writeExec(join(bin, 'redis-cli'), `#!/usr/bin/env bash
if [ "\${DRILL_REDIS_FAIL:-}" = 1 ]; then exit 1; fi
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
  const script = join(td, 'precheck.sh')
  writeFileSync(script, `#!/usr/bin/env bash\nset -uo pipefail\n${precheckBody}\n`)
  chmodSync(script, 0o755)
  const env = {
    PATH: `${bin}:${toolDir}:/usr/bin:/bin`,
    HOME: home,
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
    PRECHECK_HOME: home,
    PRECHECK_SRV: srv,
    PRECHECK_TMP: tmp,
    PRECHECK_LE_LIVE: live,
    PRECHECK_SYSLOG_DIR: syslog,
    PRECHECK_PG_LOG: pg,
    PRECHECK_APT: apt,
    EXPECT_DIR: expect,
    DRILL_NODE_V: 'v22.12.0',
    DRILL_PM2_JLIST: '[]',
    DRILL_NGINX_CONF: join(td, 'empty.conf'),
    ...extraEnv,
  }
  if (extraEnv && Object.prototype.hasOwnProperty.call(extraEnv, 'DRILL_NGINX_BODY')) {
    writeFileSync(env.DRILL_NGINX_CONF, extraEnv.DRILL_NGINX_BODY)
  } else if (!existsSync(env.DRILL_NGINX_CONF)) {
    mkdirSync(dirname(env.DRILL_NGINX_CONF), { recursive: true })
    writeFileSync(env.DRILL_NGINX_CONF, 'http {}\n')
  }
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' })
  return {
    td, home, srv, tmp, live, syslog, pg, apt, redis, expect, bin,
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

// —— 静态：过时数字、白名单、base64、描述、${VAR} ——
if (want('P-old')) check(!['19.75GB', '8.5GB', '88%', '35GB', '27GB'].some((token) => precheckYml.includes(token)),
  'P-old 预检注释不再引用过时的具体用量')
if (want('S7')) check(!cleanupSh.includes('/srv/node_modules') && !cleanupSh.includes('/srv/services'),
  'S7 清理白名单不含 /srv/node_modules 与 /srv/services')

function decodeB64(yml) {
  const start = yml.indexOf("<<'B64'\n")
  const end = yml.indexOf('\n            B64\n', start)
  if (start < 0 || end < 0) return ''
  const payload = yml.slice(start + "<<'B64'\n".length, end).split('\n').map((line) => line.trim()).join('')
  return Buffer.from(payload, 'base64').toString('utf8')
}
if (want('S9')) check(decodeB64(cleanupYml) === cleanupSh, 'S9 工作流内联脚本与 cleanup-stale-releases.sh 逐字节一致')
const executeDesc = /execute:\n\s+description: '([^']*)'/.exec(cleanupYml)?.[1] ?? ''
if (want('S10')) check(executeDesc.includes('STALE_CRITICAL_FREE_MB') && executeDesc.includes('直接删除') && executeDesc.includes('将隔离'),
  'S10 execute 输入说明写了告急阈值、直接删除和隔离', executeDesc)

function nonAsciiVarHits(label, text) {
  return text.split('\n').map((line, index) => [index + 1, line]).filter(([, line]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(line))
}
const varHits = [
  ...nonAsciiVarHits('cleanup', cleanupSh),
  ...nonAsciiVarHits('precheck', precheckBody),
]
if (want('S11')) check(varHits.length === 0, 'S11 变量后不紧跟非 ASCII（写成 ${VAR}）', varHits.map(([n]) => String(n)).join(','))

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
    HOME: draft.home,
    LC_ALL: 'C',
    LANG: 'C',
    TZ: 'UTC',
    PRECHECK_HOME: draft.home,
    PRECHECK_SRV: draft.srv,
    PRECHECK_TMP: draft.tmp,
    PRECHECK_LE_LIVE: draft.live,
    PRECHECK_SYSLOG_DIR: draft.syslog,
    PRECHECK_PG_LOG: draft.pg,
    PRECHECK_APT: draft.apt,
    EXPECT_DIR: draft.expect,
    DRILL_NGINX_CONF: join(draft.td, 'empty.conf'),
    DRILL_PM2_JLIST: '[]',
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
if (want('P12a', 'P12b', 'P12c', 'P12d', 'P12e', 'P13a', 'P13b', 'P13c')) {
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

// —— 清理脚本 ——
function runCleanup({ free, mode, confirm = '', curlFail = false, pm2Name = '', nginxName = '' }) {
  const td = realpathSync(mkdtempSync(join(tmpdir(), 'stale-gate-')))
  if (td.includes('/srv')) throw new Error(`临时目录含 /srv：${td}`)
  boxes.push(td)
  const rootDir = join(td, 'root')
  mkdirSync(rootDir)
  const names = [...NEW_WHITELIST]
  for (const name of names) {
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
  writeExec(join(bin, 'du'), `#!/usr/bin/env bash
args=()
for a in "$@"; do
  case "$a" in
    -*) ;;
    *) args+=("$a") ;;
  esac
done
target="\${args[0]:-}"
case "$target" in
  ${rootDir}/ai-job-print-backups) printf '2048\\t%s\\n' "$target" ;;
  *) exec ${realDu} "$@" ;;
esac
`)
  writeExec(join(bin, 'df'), `#!/usr/bin/env bash
printf '%s\\n' "Filesystem 1048576-blocks Used Available Capacity Mounted on"
printf '%s\\n' "drill 100 10 \${DRILL_DF_AVAIL_MB:-9000} 50% /"
`)
  writeExec(join(bin, 'curl'), `#!/usr/bin/env bash
if [ "\${DRILL_CURL_FAIL:-}" = 1 ]; then exit 1; fi
printf '%s\\n' '{"status":"ok"}'
`)
  writeExec(join(bin, 'pm2'), '#!/usr/bin/env bash\nprintf "%s\\n" "${DRILL_PM2_JLIST:-[]}"\n')
  writeExec(join(bin, 'nginx'), '#!/usr/bin/env bash\n[ "$1" = "-T" ] && cat "${DRILL_NGINX_CONF:-/dev/null}"\nexit 0\n')
  writeExec(join(bin, 'lsof'), '#!/usr/bin/env bash\nexit 1\n')
  const pm2Path = pm2Name ? join(rootDir, pm2Name) : ''
  const nginxAlias = nginxName ? join(rootDir, nginxName) : ''
  const conf = join(td, 'nginx.conf')
  const nginxBody = nginxAlias
    ? `# alias ${rootDir}/ai-job-print-env-backups\nevents {}\nserver { listen 80; alias ${nginxAlias}/; include ${nginxAlias}/mime.types; }\n`
    : 'events {}\n'
  writeFileSync(conf, nginxBody)
  const jlist = pm2Path
    ? JSON.stringify([{
      name: 'api',
      status: join(rootDir, 'ai-job-print-static-releases'),
      pm_cwd: pm2Path,
      pm2_env: { pm_cwd: pm2Path, cwd: pm2Path, pm_exec_path: '/bin/true' },
    }])
    : '[]'
  const script = cleanupSh.replaceAll('/srv', rootDir)
  const sp = join(td, 'cleanup.sh')
  writeFileSync(sp, script)
  chmodSync(sp, 0o755)
  const env = {
    PATH: `${bin}:${toolDir}:/usr/bin:/bin`,
    LC_ALL: 'C',
    LANG: 'C',
    HOME: td,
    DRILL_DF_AVAIL_MB: String(free),
    DRILL_CURL_FAIL: curlFail ? '1' : '',
    DRILL_PM2_JLIST: jlist,
    DRILL_NGINX_CONF: conf,
    CLEANUP_MODE: mode,
    CLEANUP_CONFIRM: confirm,
    CLEANUP_EXPECT_CONFIRM: 'CLEANUP-CONFIRM',
  }
  const result = spawnSync('bash', [sp], { cwd: td, env, encoding: 'utf8' })
  return {
    td, rootDir,
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

if (failures) {
  console.error(`\nverify:server-maintenance-workflows：${failures} 项失败`)
  process.exit(1)
}
console.log('\nverify:server-maintenance-workflows：通过')
