import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createReleaseManifest } from '../src/release-provenance/release-provenance'

export const RELEASE_ID = 'release-20260716-a1b2c3d4'
export const GIT_COMMIT = 'a'.repeat(40)

export type Fixture = {
  artifactRoot: string
  pnpmLinkPath: string
  releaseRoot: string
  sourceArchivePath: string
  workspace: string
}

export type RuntimeEnvironmentContractFixture = {
  path: string
  sha256: string
}

export function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function createFixture(options: { workspace?: string; releaseName?: string; sourceArchiveName?: string } = {}): Fixture {
  const workspace = options.workspace ?? mkdtempSync(join(tmpdir(), 'release-provenance-'))
  const releaseRoot = join(workspace, options.releaseName ?? 'release')
  const artifactRoot = join(workspace, 'artifacts')
  const sourceArchivePath = join(workspace, options.sourceArchiveName ?? 'source.tar.gz')
  const pnpmPackagePath = join(releaseRoot, 'node_modules/.pnpm/fixture@1.0.0/node_modules/@fixture/pkg')
  const pnpmLinkPath = join(releaseRoot, 'services/api/node_modules/@fixture/pkg')

  for (const path of [
    'services/api/dist',
    'services/api/node_modules',
    'node_modules/.pnpm',
    'apps/kiosk/dist',
    'apps/admin/dist',
    'apps/partner/dist',
  ]) {
    mkdirSync(join(releaseRoot, path), { recursive: true })
  }

  writeFixtureFile(join(releaseRoot, 'services/api/dist/main.js'), 'console.log("fixture main")\n')
  writeFixtureFile(join(releaseRoot, 'services/api/dist/release-provenance/release-guard.js'), 'console.log("fixture guard")\n')
  writeFixtureFile(join(releaseRoot, 'apps/kiosk/dist/index.html'), '<main>kiosk</main>\n')
  writeFixtureFile(join(releaseRoot, 'apps/admin/dist/index.html'), '<main>admin</main>\n')
  writeFixtureFile(join(releaseRoot, 'apps/partner/dist/index.html'), '<main>partner</main>\n')
  writeFixtureFile(join(pnpmPackagePath, 'index.js'), 'module.exports = "fixture"\n')
  mkdirSync(dirname(pnpmLinkPath), { recursive: true })
  symlinkSync(relative(dirname(pnpmLinkPath), pnpmPackagePath), pnpmLinkPath)
  writeFileSync(sourceArchivePath, 'fixture source archive\n')

  return { artifactRoot, pnpmLinkPath, releaseRoot, sourceArchivePath, workspace }
}

export function createManifest(fixture: Fixture, releaseId = RELEASE_ID): void {
  const created = createReleaseManifest({
    releaseRoot: fixture.releaseRoot,
    artifactRoot: fixture.artifactRoot,
    releaseId,
    gitCommit: GIT_COMMIT,
    previousReleaseId: null,
    sourceArchivePath: fixture.sourceArchivePath,
    createdAt: '2026-07-16T00:00:00.000Z',
    toolchain: { node: process.version, pnpm: 'test' },
  })

  assert.equal(created.manifest.schemaVersion, 1)
  assert.equal(created.manifest.releaseId, releaseId)
  assert.ok(created.manifest.entrypoints['services/api/dist/main.js'])
  assert.ok(created.manifest.entrypoints['services/api/dist/release-provenance/release-guard.js'])
}

export function createRuntimeEnvironmentContract(workspace: string): RuntimeEnvironmentContractFixture {
  const path = join(workspace, 'runtime-env-contract.json')
  const content = `${JSON.stringify({ schemaVersion: 1, variables: [{ name: 'PATH', purpose: 'Resolve Node.js and PM2 commands.' }] })}\n`
  writeFileSync(path, content)
  return { path, sha256: createHash('sha256').update(content, 'utf8').digest('hex') }
}

export function replaceManifestCopies(
  fixture: Fixture,
  mutate: (manifest: Record<string, unknown>) => void,
  releaseId = RELEASE_ID,
): void {
  const manifestPath = join(fixture.releaseRoot, 'RELEASE_MANIFEST.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  mutate(manifest)
  const manifestText = `${JSON.stringify(manifest)}\n`
  const sidecar = `${createHash('sha256').update(manifestText, 'utf8').digest('hex')}  RELEASE_MANIFEST.json\n`
  for (const root of [fixture.releaseRoot, join(fixture.artifactRoot, releaseId)]) {
    writeFileSync(join(root, 'RELEASE_MANIFEST.json'), manifestText)
    writeFileSync(join(root, 'RELEASE_MANIFEST.sha256'), sidecar)
  }
}

export function withFixture(action: (fixture: Fixture) => void): void {
  const fixture = createFixture()
  try {
    action(fixture)
  } finally {
    rmSync(fixture.workspace, { recursive: true, force: true })
  }
}
