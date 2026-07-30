import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { createReleaseManifest } = require(join(apiRoot, 'dist/release-provenance/release-provenance.js'))

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeFixtureFile(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function createD2ReleaseFixture({
  workspace,
  gitCommit = 'b'.repeat(40),
  runtimeEnvironmentVariables,
  currentLinkName = 'managed-current',
  controlRootName = 'deployment-control',
}) {
  const artifactRoot = join(workspace, 'artifacts')
  const controlRoot = join(workspace, controlRootName)
  const managedCurrentLink = join(workspace, currentLinkName)
  const launcherCwd = join(workspace, 'launcher')
  mkdirSync(controlRoot, { recursive: true })
  mkdirSync(launcherCwd, { recursive: true })

  const launcherPath = join(launcherCwd, 'release-current-launcher.js')
  copyFileSync(join(apiRoot, 'dist/release-provenance/release-current-launcher.js'), launcherPath)
  copyFileSync(join(apiRoot, 'dist/release-provenance/release-provenance.js'), join(launcherCwd, 'release-provenance.js'))
  const canonicalLauncherCwd = realpathSync(launcherCwd)
  const canonicalLauncherPath = realpathSync(launcherPath)
  const launcherSha256 = sha256File(canonicalLauncherPath)

  const runtimeEnvContractPath = join(workspace, 'runtime-env-contract.json')
  const runtimeEnvContractBody = `${JSON.stringify({
    schemaVersion: 1,
    variables: runtimeEnvironmentVariables,
  })}\n`
  writeFileSync(runtimeEnvContractPath, runtimeEnvContractBody)
  const runtimeEnvContractSha256 = createHash('sha256').update(runtimeEnvContractBody, 'utf8').digest('hex')

  function buildRelease({ releaseName, releaseId, mainSource, previousReleaseId = null }) {
    const releaseRoot = join(workspace, releaseName)
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
    writeFixtureFile(join(releaseRoot, 'services/api/dist/main.js'), mainSource)
    copyFileSync(
      join(apiRoot, 'dist/release-provenance/release-guard.js'),
      join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js'),
    )
    copyFileSync(
      join(apiRoot, 'dist/release-provenance/release-provenance.js'),
      join(releaseRoot, 'services/api/dist/release-provenance/release-provenance.js'),
    )
    writeFixtureFile(join(releaseRoot, 'apps/kiosk/dist/index.html'), '<main>kiosk</main>\n')
    writeFixtureFile(join(releaseRoot, 'apps/admin/dist/index.html'), '<main>admin</main>\n')
    writeFixtureFile(join(releaseRoot, 'apps/partner/dist/index.html'), '<main>partner</main>\n')
    const pnpmPkg = join(releaseRoot, 'node_modules/.pnpm/fixture@1.0.0/node_modules/@fixture/pkg')
    const linkPath = join(releaseRoot, 'services/api/node_modules/@fixture/pkg')
    writeFixtureFile(join(pnpmPkg, 'index.js'), 'module.exports="fixture"\n')
    mkdirSync(dirname(linkPath), { recursive: true })
    symlinkSync(relative(dirname(linkPath), pnpmPkg), linkPath)
    writeFileSync(sourceArchivePath, `${releaseName} source archive\n`)
    createReleaseManifest({
      releaseRoot,
      artifactRoot,
      releaseId,
      gitCommit,
      previousReleaseId,
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

  return {
    buildRelease,
    controlRoot: realpathSync(controlRoot),
    launcherCwd: canonicalLauncherCwd,
    launcherPath: canonicalLauncherPath,
    launcherSha256,
    managedCurrentLink,
    runtimeEnvContractPath,
    runtimeEnvContractSha256,
  }
}
