// 数据集 v2 · D2：网点、机构账号、终端、渠道与政策。只通过后台界面。
// 用法：node scripts/walkthrough/dataset/d2-run.mjs [orgs|terminals|agents|content|shots|all|check]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TERMINALS } from './d2-catalog.mjs'
import { startSimAgents } from './d2-agents.mjs'
import { publishContent } from './d2-content.mjs'
import { openAdmin } from './d2-lib.mjs'
import { EVID, ROOT, SECRET } from './d2-lib.mjs'
import { setupOrgs } from './d2-orgs.mjs'
import { loadPartnerSecrets } from './d2-secrets.mjs'
import { finalShots } from './d2-shots.mjs'
import { loadReadyContent } from './d2-sources.mjs'
import { setupTerminals } from './d2-terminals.mjs'

const phase = process.argv[2] || 'all'
const order = ['orgs', 'terminals', 'agents', 'content', 'shots']

function hostsByOrg() {
  try {
    return loadReadyContent()?.hostsByOrg ?? {}
  } catch (error) {
    console.log(String(error.message || error))
    return {}
  }
}

async function runOrgs() {
  const session = await openAdmin()
  try {
    const notes = await setupOrgs(session, hostsByOrg())
    console.log(notes.join('\n'))
  } finally {
    await session.close()
  }
}

async function runTerminals() {
  const session = await openAdmin()
  try {
    await setupTerminals(session)
  } finally {
    await session.close()
  }
}

function modeOf(path) {
  if (!existsSync(path)) return '缺失'
  return (statSync(path).mode & 0o777).toString(8)
}

function selfCheck() {
  const secrets = loadPartnerSecrets()
  const secretReport = {}
  for (const [key, row] of Object.entries(secrets.orgs)) {
    secretReport[key] = {
      username: row.username,
      phone: row.phone,
      accountCreated: row.accountCreated,
      passwordLength: String(row.initialPassword || '').length,
    }
  }
  const panels = {}
  for (const terminal of TERMINALS.filter((item) => !item.existing)) {
    const curl = spawnSync('curl', ['-fsS', '--max-time', '5', `http://127.0.0.1:${terminal.port}/local/panel`], { encoding: 'utf8' })
    panels[terminal.code] = {
      port: terminal.port,
      http: curl.status === 0 ? 200 : curl.status,
      showsCode: (curl.stdout || '').includes(terminal.code),
    }
  }
  const shots = existsSync(EVID) ? readdirSync(EVID).filter((name) => name.endsWith('.png')) : []
  const report = {
    partnersFileMode: modeOf(join(SECRET, 'partners-v2.json')),
    bindModes: Object.fromEntries(['WALK-002', 'WALK-003', 'WALK-004'].map((code) => [code, modeOf(join(SECRET, `bind-${code}.txt`))])),
    pidsFile: existsSync(join(homedir(), '.cache/walk0929/pids-v2.txt')),
    accounts: secretReport,
    panels,
    screenshotCount: shots.length,
    flowLines: existsSync(join(EVID, 'flow.jsonl')) ? readFileSync(join(EVID, 'flow.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0,
    finalShots: shots.filter((name) => name.includes('final-')),
  }
  writeFileSync(join(EVID, 'self-check.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  return report
}

const runners = {
  orgs: runOrgs,
  terminals: runTerminals,
  agents: async () => { await startSimAgents(null) },
  content: publishContent,
  shots: finalShots,
  check: async () => { selfCheck() },
}

const selected = phase === 'all' ? order : [phase]
if (!selected.every((name) => runners[name])) {
  console.error(`未知阶段 ${phase}`)
  process.exit(2)
}

try {
  for (const name of selected) {
    console.log(`\n== ${name} ==`)
    await runners[name]()
  }
  if (phase === 'all' || phase === 'check') selfCheck()
  console.log('D2_DONE')
} catch (error) {
  console.error(`PHASE_FAIL ${error?.stack || error}`)
  process.exit(1)
}
