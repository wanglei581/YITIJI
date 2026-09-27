import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { build } = createRequire(require.resolve('vite'))('esbuild')
const modules = {
  advisor: 'pages/ai-plan/advisorArtifactModel.ts',
  report: 'pages/resume/resume-report-model.ts',
  optimize: 'pages/resume/components/resume-deliver/optimizeQuery.ts',
  generate: 'pages/resume/components/resume-deliver/generatePreviewQuery.ts',
  sign: 'pages/print-scan/sign-stamp/signStampModel.ts',
  print: 'pages/print/printConfirmQuery.ts',
}

// Compile the real parsers under each build's substituted environment. Do not mock their decisions.
for (const [name, env, allowed] of [
  ['production', { DEV: false }, false],
  ['production with blank E2E token', { DEV: false, VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: '  ' }, false],
  ['development', { DEV: true }, true],
  ['E2E production build', { DEV: false, VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN: 'test-only' }, true],
]) {
  test(`${name}: fixture parameters cannot cross the build boundary`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'w1-build-mode-'))
    try {
      const outfile = join(dir, 'parsers.mjs')
      await build({
        stdin: { contents: Object.entries(modules).map(([key, file]) => `export * as ${key} from './src/${file}';`).join('\n'), resolveDir: root },
        bundle: true, format: 'esm', platform: 'browser', outfile,
        define: { 'import.meta.env': JSON.stringify(env), 'process.env.NODE_ENV': '"production"' },
      })
      const parsers = await import(pathToFileURL(outfile).href)
      for (const flag of ['capture', 'debug']) {
        const query = `?${flag}=1&state=report&taskId=w1_real_task`
        const report = parsers.report.parseReportSearch(query)
        assert.equal(report.tech, allowed)
        assert.equal(parsers.report.shouldSkipReportFetch(report.tech, report.urlState), allowed)
        assert.equal(report.queryTaskId, 'w1_real_task', 'real task context survives ignored fixtures')
        if (!allowed) assert.equal(report.urlState, null)
        const advisor = parsers.advisor.resolveFixtureState(new URLSearchParams(`${flag}=1&state=qa-pins`))
        assert.equal(advisor, allowed ? 'qa-pins' : null)
        for (const state of ['ready', 'illegal', 'unknown-state']) {
          const result = parsers.optimize.parseOptimizeQuery(`?${flag}=1&state=${state}&taskId=w1_real_task&export=ready`)
          assert.equal(result.capture || result.debug, allowed)
          if (!allowed) {
            assert.equal(result.requested, null)
            assert.equal(result.exportHint, null)
            assert.equal(parsers.optimize.resolveOptimizeView(result, { hasTask: true, loading: true }).view, 'loading')
          }
        }
        const generate = parsers.generate.parseGeneratePreviewQuery(`?${flag}=1&state=preview-ready&taskId=w1_real_task`)
        assert.equal(generate.capture || generate.debug, allowed)
        if (!allowed) {
          assert.equal(generate.requested, null)
          assert.equal(parsers.generate.resolveGeneratePreviewView(generate, { restoring: true }).view, 'preview-loading')
        }
        assert.equal(parsers.sign.parseSignStampQuery(`?${flag}=1&state=placement-default`).capture, allowed)
      }
      const scan = parsers.print.scanPrintConfirmQuery('?capture=1&debug=1&state=quoted', '', 'https://example.test/print/confirm')
      assert.equal(scan.capture && scan.debug, allowed)
      if (!allowed) assert.equal(parsers.print.allowSyntheticScreen(scan, 'quoted'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
