#!/usr/bin/env node
/**
 * F1 Genesis D2 — real PM2 isolation drill (inside Docker / equivalent network NS).
 *
 * Proves:
 * 1) empty control root → Genesis r1 (parallel-serving)
 * 2) activate r2 with post-switch health failure → rollback only to verified r1
 * 3) narrowed runtime env (PATH+HOME) is what PM2 start/reload/describe receive; CANARY excluded
 * 4) missing-process PM2 output is classified exactly; other PM2 failures are not masked as missing
 *
 * Evidence prints release IDs, hashes, status codes only — no env values, secrets, or host paths
 * outside the drill workspace basename markers.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { get } from 'node:http'

const require = createRequire(import.meta.url)
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const {
  createReleaseManifest,
  ReleaseProvenanceError,
} = require(join(apiRoot, 'dist/release-provenance/release-provenance.js'))
const { runReleaseGenesis } = require(join(apiRoot, 'dist/release-provenance/release-genesis.js'))
const { activateRelease } = require(join(apiRoot, 'dist/release-provenance/release-activation.js'))
const { readCurrentRelease } = require(join(apiRoot, 'dist/release-provenance/release-runtime-contract.js'))

const R1_ID = `release-d2-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-r1`
const R2_ID = `release-d2-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-r2`
const PM2_NAME = 'd2-genesis-api'
const HEALTH_URL = 'http://127.0.0.1:3010/api/v1/health'
const GIT_COMMIT = 'b'.repeat(40)
const CANARY_NAME = 'D2_ENV_CANARY'
const CANARY_VALUE = `canary-${randomBytes(8).toString('hex')}`

const evidence = {
  plane: 'docker-isolation',
  r1ReleaseId: R1_ID,
  r2ReleaseId: R2_ID,
  pm2Name: PM2_NAME,
  healthUrl: HEALTH_URL,
  steps: [],
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function healthyMain() {
  return `const http=require("node:http");
http.createServer((req,res)=>{
  if(req.url==="/api/v1/health"){
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({success:true,data:{status:"ok",db:"postgres",time:new Date().toISOString()}}));
    return;
  }
  if(req.url==="/__d2/env"){
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({canary:process.env[${JSON.stringify(CANARY_NAME)}]??null,hasPath:Boolean(process.env.PATH),hasHome:Boolean(process.env.HOME)}));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(3010,"127.0.0.1");
`
}

function unhealthyMain() {
  return `const http=require("node:http");
http.createServer((req,res)=>{
  if(req.url==="/api/v1/health"){
    res.writeHead(503,{"content-type":"application/json"});
    res.end(JSON.stringify({success:false,data:{status:"degraded",db:"down"}}));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(3010,"127.0.0.1");
`
}

function buildRelease(workspace, releaseName, releaseId, mainSource) {
  const releaseRoot = join(workspace, releaseName)
  const artifactRoot = join(workspace, 'artifacts')
  const sourceArchivePath = join(workspace, `${releaseName}.tar.gz`)
  for (const path of [
    'services/api/dist/release-provenance',
    'services/api/node_modules',
    'node_modules/.pnpm',
    'apps/kiosk/dist',
    'apps/admin/dist',
    'apps/partner/dist',
  ]) {
    mkdirSync(join(releaseRoot, path), { recursive: true })
  }
  writeFile(join(releaseRoot, 'services/api/dist/main.js'), mainSource)
  copyFileSync(
    join(apiRoot, 'dist/release-provenance/release-guard.js'),
    join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js'),
  )
  copyFileSync(
    join(apiRoot, 'dist/release-provenance/release-provenance.js'),
    join(releaseRoot, 'services/api/dist/release-provenance/release-provenance.js'),
  )
  writeFile(join(releaseRoot, 'apps/kiosk/dist/index.html'), '<main>kiosk</main>\n')
  writeFile(join(releaseRoot, 'apps/admin/dist/index.html'), '<main>admin</main>\n')
  writeFile(join(releaseRoot, 'apps/partner/dist/index.html'), '<main>partner</main>\n')
  const pnpmPkg = join(releaseRoot, 'node_modules/.pnpm/fixture@1.0.0/node_modules/@fixture/pkg')
  const linkPath = join(releaseRoot, 'services/api/node_modules/@fixture/pkg')
  writeFile(join(pnpmPkg, 'index.js'), 'module.exports="fixture"\n')
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(relative(dirname(linkPath), pnpmPkg), linkPath)
  writeFileSync(sourceArchivePath, `${releaseName} source archive\n`)
  createReleaseManifest({
    releaseRoot,
    artifactRoot,
    releaseId,
    gitCommit: GIT_COMMIT,
    previousReleaseId: null,
    sourceArchivePath,
    createdAt: new Date().toISOString(),
    toolchain: { node: process.version, pnpm: 'd2-drill' },
  })
  return {
    releaseRoot: realpathSync(releaseRoot),
    artifactRoot: realpathSync(artifactRoot),
    releaseId,
    mainSha256: sha256File(join(releaseRoot, 'services/api/dist/main.js')),
    guardSha256: sha256File(join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js')),
  }
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(body) })
        } catch {
          resolve({ statusCode: res.statusCode ?? 0, body })
        }
      })
    })
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('health timeout'))
    })
    req.on('error', reject)
  })
}

function runPm2(args, environment) {
  return spawnSync('pm2', args, {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function isExactMissing(result, pm2Name) {
  const message = `[PM2][WARN] ${pm2Name} doesn't exist\n`
  return (
    (result.status === 0 || result.status === 1) &&
    ((result.stdout === message && result.stderr === '') || (result.stdout === '' && result.stderr === message))
  )
}

async function expectCode(expected, action) {
  try {
    await action()
    assert.fail(`expected ${expected}`)
  } catch (error) {
    assert.ok(error instanceof ReleaseProvenanceError, `expected ReleaseProvenanceError, got ${error}`)
    assert.equal(error.code, expected)
  }
}

/** Retrying probe for cold PM2 start only; still hits real loopback :3010 health. */
function createRetryHealthProbe(attempts = 20, delayMs = 250) {
  return async (healthUrl) => {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const result = await httpGetJson(healthUrl)
        if (
          result.statusCode === 200 &&
          result.body?.success === true &&
          result.body?.data?.status === 'ok' &&
          result.body?.data?.db === 'postgres'
        ) {
          return true
        }
      } catch {
        // process not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    return false
  }
}

async function main() {
  assert.equal(process.env.D2_DRILL_PLANE, 'docker-isolation', 'D2_DRILL_PLANE must be docker-isolation')
  process.env[CANARY_NAME] = CANARY_VALUE

  const workspace = mkdtempSync(join(tmpdir(), 'f1-d2-'))
  const controlRoot = join(workspace, 'deployment-control')
  const managedCurrentLink = join(workspace, 'managed-current')
  const launcherCwd = join(workspace, 'launcher')
  mkdirSync(controlRoot, { recursive: true })
  mkdirSync(launcherCwd, { recursive: true })

  const launcherPath = join(launcherCwd, 'release-current-launcher.js')
  copyFileSync(join(apiRoot, 'dist/release-provenance/release-current-launcher.js'), launcherPath)
  copyFileSync(join(apiRoot, 'dist/release-provenance/release-provenance.js'), join(launcherCwd, 'release-provenance.js'))
  const launcherSha256 = sha256File(launcherPath)

  const contractPath = join(workspace, 'runtime-env-contract.json')
  const contractBody = `${JSON.stringify({
    schemaVersion: 1,
    variables: [
      { name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' },
      { name: 'HOME', purpose: 'Stable PM2 home resolution for the drill daemon.' },
    ],
  })}\n`
  writeFileSync(contractPath, contractBody)
  const contractSha256 = createHash('sha256').update(contractBody, 'utf8').digest('hex')
  assert.ok(process.env.PATH)
  assert.ok(process.env.HOME)

  const r1 = buildRelease(workspace, 'r1', R1_ID, healthyMain())
  const r2 = buildRelease(workspace, 'r2', R2_ID, unhealthyMain())
  evidence.r1MainSha256 = r1.mainSha256
  evidence.r2MainSha256 = r2.mainSha256
  evidence.launcherSha256 = launcherSha256
  evidence.runtimeEnvContractSha256 = contractSha256

  // --- Prove missing-process classification before Genesis ---
  const narrowed = Object.freeze(
    Object.assign(Object.create(null), {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    }),
  )
  const missing = runPm2(['describe', 'd2-definitely-missing', '--no-color'], narrowed)
  assert.equal(isExactMissing(missing, 'd2-definitely-missing'), true)
  evidence.steps.push({
    name: 'missing-process-exact',
    status: missing.status,
    classifiedAsMissing: true,
  })

  const brokenPathEnv = Object.freeze(Object.assign(Object.create(null), { PATH: '/var/empty-d2-no-pm2', HOME: process.env.HOME }))
  const broken = runPm2(['describe', PM2_NAME, '--no-color'], brokenPathEnv)
  assert.equal(isExactMissing(broken, PM2_NAME), false)
  assert.notEqual(broken.status, 0)
  evidence.steps.push({
    name: 'non-missing-pm2-error-not-masked',
    status: broken.status,
    classifiedAsMissing: false,
  })

  // Warm PM2 daemon under the same HOME the contract will use.
  const ping = runPm2(['ping'], narrowed)
  assert.equal(ping.status, 0, 'pm2 ping failed under narrowed env')

  // Ensure target name absent
  runPm2(['delete', PM2_NAME], narrowed)

  const healthProbe = createRetryHealthProbe()
  const genesis = await runReleaseGenesis({
    candidateRoot: r1.releaseRoot,
    managedCurrentLink,
    artifactRoot: r1.artifactRoot,
    deploymentControlRoot: controlRoot,
    pm2Name: PM2_NAME,
    healthUrl: HEALTH_URL,
    launcherCwd: realpathSync(launcherCwd),
    launcherPath: realpathSync(launcherPath),
    launcherSha256,
    runtimeEnvContractPath: contractPath,
    runtimeEnvContractSha256: contractSha256,
    healthProbe,
  })
  assert.equal(genesis.status, 'parallel-serving-r1')
  assert.equal(genesis.releaseId, R1_ID)
  assert.equal(readCurrentRelease(managedCurrentLink), r1.releaseRoot)
  const health1 = await httpGetJson(HEALTH_URL)
  assert.equal(health1.statusCode, 200)
  assert.equal(health1.body?.success, true)
  assert.equal(health1.body?.data?.status, 'ok')
  assert.equal(health1.body?.data?.db, 'postgres')
  const env1 = await httpGetJson('http://127.0.0.1:3010/__d2/env')
  assert.equal(env1.body?.canary, null, 'CANARY must not enter managed process env')
  assert.equal(env1.body?.hasPath, true)
  evidence.steps.push({
    name: 'genesis-r1',
    status: 'parallel-serving-r1',
    releaseId: genesis.releaseId,
    healthStatusCode: health1.statusCode,
    canaryPresentInProcess: false,
  })

  // Inject canary into parent env again before activate (reload must not import it).
  process.env[CANARY_NAME] = CANARY_VALUE
  await expectCode('RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK', () =>
    activateRelease({
      candidateRoot: r2.releaseRoot,
      currentLink: managedCurrentLink,
      artifactRoot: r1.artifactRoot,
      pm2Name: PM2_NAME,
      healthUrl: HEALTH_URL,
      launcherCwd: realpathSync(launcherCwd),
      launcherPath: realpathSync(launcherPath),
      launcherSha256,
      runtimeEnvContractPath: contractPath,
      runtimeEnvContractSha256: contractSha256,
      healthProbe,
    }),
  )

  assert.equal(readCurrentRelease(managedCurrentLink), r1.releaseRoot, 'current must point at verified r1 after rollback')
  const health2 = await httpGetJson(HEALTH_URL)
  assert.equal(health2.statusCode, 200)
  assert.equal(health2.body?.data?.status, 'ok')
  assert.equal(health2.body?.data?.db, 'postgres')
  const env2 = await httpGetJson('http://127.0.0.1:3010/__d2/env')
  assert.equal(env2.body?.canary, null)
  evidence.steps.push({
    name: 'activate-r2-health-fail-rollback-r1',
    resultCode: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
    currentReleaseId: R1_ID,
    healthStatusCode: health2.statusCode,
    canaryPresentInProcess: false,
    rolledBackToLegacyMainJs: false,
  })

  const successPath = join(controlRoot, 'GENESIS_SUCCESS.json')
  assert.equal(existsSync(successPath), true)
  const success = JSON.parse(readFileSync(successPath, 'utf8'))
  assert.equal(success.status, 'PARALLEL_SERVING_R1')
  assert.equal(success.releaseId, R1_ID)
  evidence.genesisSuccessStatus = success.status
  evidence.genesisSuccessReleaseId = success.releaseId

  // Cleanup managed process only (never touch host production).
  runPm2(['delete', PM2_NAME], narrowed)
  rmSync(workspace, { recursive: true, force: true })

  evidence.verdict = 'D2_PASS_ISOLATION'
  evidence.productionF1 = 'NO-GO'
  evidence.notes = [
    'Host production PM2 was not started, stopped, or reloaded by this drill.',
    'Rollback target was verified managed r1 only; legacy dist/main.js was not a rollback source.',
    'D3–D5 still require separate authorization; traffic cutover remains NO-GO.',
  ]

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

main().catch((error) => {
  const code = error instanceof ReleaseProvenanceError ? error.code : 'D2_DRILL_FAILED'
  process.stderr.write(`${code}\n`)
  if (error && error.stack) process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
