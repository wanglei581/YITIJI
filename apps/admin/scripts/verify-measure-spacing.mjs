import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import vm from 'node:vm'

/** 两后台源码里「少于 5」与量词之间必须有空格。公共包拼接的瓷砖不在这里改。 */
export function verifyMeasureSpacing({ repoRoot, fail }) {
  console.log('\n=== 少于 5 与量词的空格 ===')
  let failed = false
  const report = (message) => {
    failed = true
    fail(message)
  }
  const bad = /少于\s*5(?![\s（(])(?:次浏览|人次|次|单|页|条|批)/
  const rawUnit = /unit:\s*'(?:次浏览|次|单)'|className="twin-unit">(?:次浏览|次|单)</
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.(?:test|d)\.ts$/.test(name)) files.push(path)
    }
  }
  walk(join(repoRoot, 'apps/admin/src'))
  walk(join(repoRoot, 'apps/partner/src'))
  for (const file of files) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const rel = file.slice(repoRoot.length + 1)
    if (bad.test(code)) report(`${rel} 仍把「少于 5」和量词粘在一起`)
    if (code.includes('twinSmall') && rawUnit.test(code) && !code.includes('measureUnit(')) {
      report(`${rel} 用 twinSmall 直接贴量词，必须经 measureUnit`)
    }
  }
  for (const rel of ['apps/admin/src/routes/screen/measureUnit.ts', 'apps/partner/src/routes/screen/measureUnit.ts']) {
    const src = readFileSync(join(repoRoot, rel), 'utf8')
    if (!src.includes("value.endsWith('少于 5')")) report(`${rel} 必须只在「少于 5」后加空格`)
    const js = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: rel,
    }).outputText
    const exportsBox = {}
    const mod = { exports: exportsBox }
    vm.runInNewContext(js, { module: mod, exports: exportsBox }, { filename: rel })
    const measureUnit = mod.exports.measureUnit
    if (measureUnit('少于 5', '次') !== ' 次') report(`${rel} 未在「少于 5」后加空格`)
    if (measureUnit('21', '次') !== '次') report(`${rel} 给普通数字加了空格`)
  }
  if (!failed) console.log('  PASS 两后台源码没有「少于 5次」，twinSmall 贴量词走 measureUnit')
}
