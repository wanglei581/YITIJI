import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectMissingLocalReferences,
  extractDeclaredRedirects,
  extractDeclaredRoutePatterns,
  extractManifestRedirects,
  extractManifestRoutePatterns,
  findSensitivePrototypeInputValues,
  findForbiddenFusionReferences,
  sha256File,
} from './lib/fusion-baseline-contract.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fusionRoot = resolve(repoRoot, 'docs/design/kiosk-proto-2026-07-fusion')

const EXPECTED_SOURCES = {
  'sources/5299/index.html': 'b3626b4c9d104244e962015a2d395e74331b6c2a101801ef545f6b0abd20e092',
  'sources/5299/14-profile.html': '8ae855db6f2e5e96bb58043fb52b82e41b419797b0a5a39f9064ff17b9802994',
  'sources/5299/77-print-upload.html': '21feb843118d7c401e36b5dc0b0ddb5c8af8e1d2ef0d798895a2f7380bab8348',
  'sources/8177/index.html': '4978c0a9eaa21f063d3635b2e383bc590ea5570b669108fd02d236023590ebf9',
  'sources/8177/14-profile.html': '363b9d369facd6807a382f28d731f373b578c6e91c5e5c2c0ae143651041444e',
  'sources/8177/77-print-upload.html': '8167069684a77bfe4df4dae44f87901abfd155f842f2c4c97a36c9545633919f',
  'sources/8177/15A-login-error.html': '8e6494e43b374adb8ca076ce4890db29c84d805e5b469c901c765e8b0093cc34',
  'sources/8177/22B-me-feedback.html': '895f186906db07a8bc2900924f70af65e56d669653c5d4315694ecd8d24e774d',
  'sources/8177/32A-cashier-failed.html': 'a47d4549e19494db6be9b91d9478793c16fa6b9ef61631f75c89bd86c2d4c700',
  'sources/8177/34A-scan-offline.html': '8b0d6abfbe2b5ec36317a0615c5e98943f55f22c906f600cded556ecc85db976',
  'sources/8177/76A-toolbox-empty.html': '9b00b902feed6004a1d4c778ebdf5a5d7144db57db5b9c8c726776fa6ea814d1',
  'sources/8177/FREEZE.md': 'cb4990a6309c593f06340a0af949aee69aeffa66a74cb605ebf8acfe943d8c33',
  'sources/8177/WAVE-P-CLOSURE.md': '44601f45e00edf6b72d51e71d3f26f708334f8d29952224ea1d650ee30ed2397',
  'sources/8177/WAVE-P2-FLOWS.md': 'dc26dd2625c407faf87fae2267cdad5229c63291c24f9e4d16a9bcf2239ac4b5',
}

const DERIVED_HTML_FILES = [
  'index.html',
  '14-profile.html',
  '77-print-upload.html',
  '15A-login-error.html',
  '22B-me-feedback.html',
  '32A-cashier-failed.html',
  '34A-scan-offline.html',
  '76A-toolbox-empty.html',
]

const routerPath = resolve(repoRoot, 'apps/kiosk/src/routes/index.tsx')
const manifestPath = resolve(repoRoot, 'apps/kiosk/tests/visual/route-manifest.ts')
const matrixPath = resolve(repoRoot, 'docs/design/kiosk-proto-2026-07-migration-matrix.md')
const srcRoot = resolve(repoRoot, 'apps/kiosk/src')
const results = []

function displayPath(filePath) {
  return relative(repoRoot, filePath)
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function runGroup(name, verify) {
  const failures = []
  const fail = (message) => failures.push(message)
  try {
    await verify(fail)
  } catch (error) {
    fail(`unexpected error: ${describeError(error)}`)
  }
  results.push({ name, failures })
}

async function readRequired(filePath, fail) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    fail(`${displayPath(filePath)}: missing or unreadable artifact (${describeError(error)})`)
    return null
  }
}

async function readDeclaredRoutes(fail) {
  const source = await readRequired(routerPath, fail)
  return source === null ? null : extractDeclaredRoutePatterns(source)
}

await runGroup('immutable fusion source hashes', async (fail) => {
  const sourceEntries = Object.entries(EXPECTED_SOURCES)
  if (sourceEntries.length !== 14) {
    fail(`expected exactly 14 frozen source entries, received ${sourceEntries.length}`)
  }
  for (const [relativePath, expectedHash] of sourceEntries) {
    const sourcePath = resolve(fusionRoot, relativePath)
    try {
      const actualHash = await sha256File(sourcePath)
      if (actualHash !== expectedHash) {
        fail(`${displayPath(sourcePath)}: expected ${expectedHash}, received ${actualHash}`)
      }
    } catch (error) {
      fail(`${displayPath(sourcePath)}: missing or unreadable source (${describeError(error)})`)
    }
  }
})

await runGroup('router route count', async (fail) => {
  const routes = await readDeclaredRoutes(fail)
  if (routes !== null && routes.length !== 86) {
    fail(`${displayPath(routerPath)}: expected exactly 86 normalized routes, received ${routes.length}`)
  }
})

await runGroup('Playwright route manifest parity', async (fail) => {
  const routes = await readDeclaredRoutes(fail)
  const manifestSource = await readRequired(manifestPath, fail)
  if (routes === null || manifestSource === null) return

  const manifestRoutes = extractManifestRoutePatterns(manifestSource)
  const missingFromManifest = routes.filter((routePath) => !manifestRoutes.includes(routePath))
  const missingFromRouter = manifestRoutes.filter((routePath) => !routes.includes(routePath))
  if (missingFromManifest.length > 0 || missingFromRouter.length > 0) {
    fail(`router -> manifest missing: ${missingFromManifest.join(', ') || '(none)'}`)
    fail(`manifest -> router missing: ${missingFromRouter.join(', ') || '(none)'}`)
  }
})

await runGroup('compatibility redirect target parity', async (fail) => {
  const routerSource = await readRequired(routerPath, fail)
  const manifestSource = await readRequired(manifestPath, fail)
  if (routerSource === null || manifestSource === null) return

  const routerRedirects = extractDeclaredRedirects(routerSource)
  const manifestRedirects = extractManifestRedirects(manifestSource)
  const routerSources = Object.keys(routerRedirects)
  const manifestSources = Object.keys(manifestRedirects)
  if (manifestSources.length !== 5) {
    fail(`${displayPath(manifestPath)}: expected exactly 5 compatibility redirects, actual ${manifestSources.length}`)
  }

  const missingFromManifest = routerSources.filter((sourcePath) => !(sourcePath in manifestRedirects))
  const missingFromRouter = manifestSources.filter((sourcePath) => !(sourcePath in routerRedirects))
  if (missingFromManifest.length > 0 || missingFromRouter.length > 0) {
    fail(`router -> manifest redirect source missing: ${missingFromManifest.join(', ') || '(none)'}`)
    fail(`manifest -> router redirect source missing: ${missingFromRouter.join(', ') || '(none)'}`)
  }

  for (const sourcePath of manifestSources.filter((candidate) => candidate in routerRedirects)) {
    const expectedTarget = manifestRedirects[sourcePath]
    const actualTarget = routerRedirects[sourcePath]
    if (actualTarget !== expectedTarget) {
      fail(`${sourcePath}: expected target ${expectedTarget}, actual ${actualTarget}`)
    }
  }
})

await runGroup('migration matrix route mappings', async (fail) => {
  const routes = await readDeclaredRoutes(fail)
  const matrix = await readRequired(matrixPath, fail)
  if (routes === null || matrix === null) return

  const missingRoutes = routes.filter((routePath) => !matrix.includes(`\`${routePath}\``))
  if (missingRoutes.length > 0) {
    fail(`${displayPath(matrixPath)}: missing backtick mappings for ${missingRoutes.join(', ')}`)
  }
})

await runGroup('derived HTML local references', async (fail) => {
  for (const filename of DERIVED_HTML_FILES) {
    const htmlPath = resolve(fusionRoot, filename)
    try {
      const missing = await collectMissingLocalReferences(htmlPath)
      if (missing.length > 0) {
        fail(`${displayPath(htmlPath)}: missing local references ${missing.join(', ')}`)
      }
    } catch (error) {
      fail(`${displayPath(htmlPath)}: missing or unreadable derived artifact (${describeError(error)})`)
    }
  }
})

await runGroup('derived HTML sensitive input privacy', async (fail) => {
  // Frozen sources/** are immutable evidence and intentionally excluded from this scan.
  for (const filename of DERIVED_HTML_FILES) {
    const htmlPath = resolve(fusionRoot, filename)
    const html = await readRequired(htmlPath, fail)
    if (html === null) continue
    const issues = findSensitivePrototypeInputValues(html)
    for (const issue of issues) fail(`${displayPath(htmlPath)}: ${issue}`)
  }
})

await runGroup('print and scan entry separation', async (fail) => {
  const htmlPath = resolve(fusionRoot, '77-print-upload.html')
  const html = await readRequired(htmlPath, fail)
  if (html === null) return
  if (!html.includes('/scan/start')) {
    fail(`${displayPath(htmlPath)}: missing /scan/start entry`)
  }
  if (/data-tab\s*=\s*["']scan["']/.test(html)) {
    fail(`${displayPath(htmlPath)}: forbidden data-tab="scan" declaration remains`)
  }
})

await runGroup('profile asset entry', async (fail) => {
  const htmlPath = resolve(fusionRoot, '14-profile.html')
  const html = await readRequired(htmlPath, fail)
  if (html !== null && !html.includes('我的资产')) {
    fail(`${displayPath(htmlPath)}: missing 我的资产`)
  }
})

await runGroup('runtime fusion import isolation', async (fail) => {
  try {
    const offenders = await findForbiddenFusionReferences(srcRoot)
    if (offenders.length > 0) {
      fail(`${displayPath(srcRoot)}: forbidden fusion references in ${offenders.join(', ')}`)
    }
  } catch (error) {
    fail(`${displayPath(srcRoot)}: unable to scan runtime source (${describeError(error)})`)
  }
})

for (const { name, failures } of results) {
  if (failures.length === 0) {
    console.log(`PASS ${name}`)
    continue
  }
  console.log(`FAIL ${name}`)
  for (const failure of failures) console.log(`  - ${failure}`)
}

const failureCount = results.reduce((count, result) => count + result.failures.length, 0)
if (failureCount > 0) {
  console.log(`FAIL fusion baseline contract: ${failureCount} grouped assertion(s) failed`)
  process.exit(1)
}

console.log('PASS fusion baseline contract')
