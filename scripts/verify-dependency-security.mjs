#!/usr/bin/env node
/**
 * Dependency security gate:
 * - fail closed on audit/network/JSON errors
 * - allow at most one accepted-unreachable high: GHSA-qwww-vcr4-c8h2 (React Router RSC)
 * - require SPA architecture guard for that exception
 * - keep package.json pnpm.overrides and pnpm-workspace.yaml overrides in sync
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const ACCEPTED_UNREACHABLE_HIGH = 'GHSA-qwww-vcr4-c8h2'
const FRONTENDS = ['admin', 'kiosk', 'partner']

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function runAudit(extraArgs = []) {
  const result = spawnSync('pnpm', ['audit', ...extraArgs, '--audit-level=high', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  })
  const stdout = result.stdout || ''
  if (!stdout.trim()) {
    fail(`pnpm audit ${extraArgs.join(' ')} produced empty stdout (status=${result.status}): ${result.stderr || ''}`.trim())
  }
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    fail(`pnpm audit ${extraArgs.join(' ')} returned non-JSON: ${error.message}`)
  }
  return parsed
}

function highAdvisories(auditJson) {
  return Object.values(auditJson.advisories || {}).filter((item) => item.severity === 'high' || item.severity === 'critical')
}

function advisoryId(item) {
  return item.github_advisory_id || (String(item.url || '').match(/GHSA-[a-z0-9-]+/i)?.[0] ?? null)
}

function assertOverridesSync() {
  const pkg = readJson(path.join(root, 'package.json'))
  const workspace = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')
  const pkgOverrides = pkg.pnpm?.overrides
  assert.ok(pkgOverrides && typeof pkgOverrides === 'object', 'package.json must declare pnpm.overrides for pnpm 9 servers')

  const workspaceBlock = workspace.match(/^overrides:\n([\s\S]*?)(?=^[a-zA-Z]|\z)/m)
  assert.ok(workspaceBlock, 'pnpm-workspace.yaml must declare overrides')
  const workspaceMap = {}
  for (const line of workspaceBlock[1].split('\n')) {
    const match = /^\s+('([^']+)'|([^:]+)):\s*(.+)\s*$/.exec(line)
    if (!match) continue
    const key = match[2] || match[3]
    workspaceMap[key.trim()] = match[4].trim()
  }

  const pkgKeys = Object.keys(pkgOverrides).sort()
  const wsKeys = Object.keys(workspaceMap).sort()
  assert.deepEqual(pkgKeys, wsKeys, 'package.json pnpm.overrides keys must match pnpm-workspace.yaml overrides keys')
  for (const key of pkgKeys) {
    assert.equal(
      String(pkgOverrides[key]),
      workspaceMap[key],
      `override mismatch for ${key}: package.json=${pkgOverrides[key]} workspace=${workspaceMap[key]}`,
    )
  }
}

function collectSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, out)
      continue
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function assertSpaArchitectureGuard() {
  const forbiddenImport = /@react-router\/(dev|node|express|serve|cloudflare)/
  const forbiddenApis = /\b(hydrateRoot|renderToPipeableStream|renderToReadableStream|StaticRouterProvider|createStaticHandler)\b/
  const forbiddenRouteExport = /\b(clientLoader|clientAction|loader|action|middleware)\s*[:=]/

  for (const app of FRONTENDS) {
    const manifestPath = path.join(root, 'apps', app, 'package.json')
    const manifest = readJson(manifestPath)
    assert.ok(manifest.dependencies?.['react-router-dom'] || manifest.devDependencies?.['react-router-dom'], `${app} must depend on react-router-dom`)
    assert.ok(manifest.devDependencies?.vite || manifest.dependencies?.vite, `${app} must remain a Vite SPA (vite dependency required)`)
    assert.equal(manifest.dependencies?.['@react-router/dev'], undefined, `${app} must not depend on @react-router/dev`)
    assert.equal(manifest.dependencies?.['@react-router/node'], undefined, `${app} must not depend on @react-router/node`)

    const files = [
      ...collectSourceFiles(path.join(root, 'apps', app, 'src')),
      path.join(root, 'apps', app, 'vite.config.ts'),
      path.join(root, 'apps', app, 'react-router.config.ts'),
    ].filter((file) => fs.existsSync(file))

    let sawCreateBrowserRouter = false
    let sawRouterProvider = false
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      if (forbiddenImport.test(text)) fail(`${app}: forbidden React Router package import in ${path.relative(root, file)}`)
      if (forbiddenApis.test(text)) fail(`${app}: forbidden SSR/RSC API in ${path.relative(root, file)}`)
      // Route module exports named loader/action are Framework Mode; SPA route tables use element/Component.
      if (file.includes(`${path.sep}routes${path.sep}`) && forbiddenRouteExport.test(text) && !text.includes('createBrowserRouter')) {
        // Allow local helper names only outside route modules; still block Framework-style route exports.
        if (/\bexport\s+(async\s+)?function\s+(loader|action|clientLoader|clientAction|middleware)\b/.test(text)
          || /\bexport\s+const\s+(loader|action|clientLoader|clientAction|middleware)\b/.test(text)) {
          fail(`${app}: Framework Mode route export in ${path.relative(root, file)}`)
        }
      }
      if (/\bcreateBrowserRouter\b/.test(text)) sawCreateBrowserRouter = true
      if (/\bRouterProvider\b/.test(text)) sawRouterProvider = true
    }
    assert.ok(sawCreateBrowserRouter, `${app} must use createBrowserRouter`)
    assert.ok(sawRouterProvider, `${app} must use RouterProvider`)
  }
}

function assertAuditAcceptable(label, auditJson) {
  const highs = highAdvisories(auditJson)
  const unexpected = []
  let accepted = 0
  for (const item of highs) {
    const id = advisoryId(item)
    if (id === ACCEPTED_UNREACHABLE_HIGH && item.module_name === 'react-router') {
      accepted += 1
      continue
    }
    unexpected.push(`${item.severity} ${item.module_name} ${id || item.url || item.title}`)
  }
  if (unexpected.length > 0) {
    fail(`${label}: unaccepted critical/high advisories remain:\n- ${unexpected.join('\n- ')}`)
  }
  if (accepted > 1) {
    fail(`${label}: accepted unreachable high counted ${accepted} times; expected at most one advisory object`)
  }
  console.log(`OK: ${label} — unaccepted critical/high = 0; accepted-unreachable high (${ACCEPTED_UNREACHABLE_HIGH}) = ${accepted}`)
}

console.log('\n=== verify dependency security ===')
assertOverridesSync()
console.log('OK: package.json pnpm.overrides ↔ pnpm-workspace.yaml overrides synchronized')
assertSpaArchitectureGuard()
console.log('OK: Admin/Kiosk/Partner remain Vite SPA + createBrowserRouter Data Mode')

const fullAudit = runAudit([])
const prodAudit = runAudit(['--prod'])
assertAuditAcceptable('full tree', fullAudit)
assertAuditAcceptable('--prod', prodAudit)

const fullMeta = fullAudit.metadata?.vulnerabilities || {}
const prodMeta = prodAudit.metadata?.vulnerabilities || {}
console.log(`audit metadata full=${JSON.stringify(fullMeta)} prod=${JSON.stringify(prodMeta)}`)
console.log('ALL PASS: dependency security gate')
