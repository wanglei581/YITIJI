import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..')

// Git's split marker must occupy the whole line. Start/base/end markers are also
// rejected when appended to prose because that exact corruption has reached main.
const conflictMarkerPattern = /(?<![<|>`])(?<marker><{7}(?: [^`\r\n]*)?|\|{7}(?: [^`\r\n]*)?|>{7}(?: [^`\r\n]*)?)(?=\r?$)|^(?<split>={7})\r?$/gm

function scanConflictMarkers(content) {
  conflictMarkerPattern.lastIndex = 0
  return [...content.matchAll(conflictMarkerPattern)].map((match) => ({
    index: match.index,
    marker: match.groups.marker ?? match.groups.split,
  }))
}

function verifyConflictMarkerDetector() {
  const left = '<'.repeat(7)
  const base = '|'.repeat(7)
  const split = '='.repeat(7)
  const right = '>'.repeat(7)
  const cases = [
    { name: 'clean text', content: 'ordinary text\n', expected: [] },
    {
      name: 'standard conflict',
      content: `${left} HEAD\nleft\n${base} base\n${split}\nright\n${right} branch\n`,
      expected: [`${left} HEAD`, `${base} base`, split, `${right} branch`],
    },
    {
      name: 'marker appended to prose',
      content: `ordinary text ${right} branch\n`,
      expected: [`${right} branch`],
    },
    {
      name: 'markdown code example',
      content: `Example: \`${right} branch\`\n`,
      expected: [],
    },
    { name: 'equals appended to prose', content: `ordinary text ${split}\n`, expected: [] },
    { name: 'long decorative rule', content: `${'='.repeat(8)}\n`, expected: [] },
  ]

  for (const testCase of cases) {
    const actual = scanConflictMarkers(testCase.content).map(({ marker }) => marker)
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      throw new Error(
        `conflict marker detector self-test failed (${testCase.name}): expected ${JSON.stringify(testCase.expected)}, got ${JSON.stringify(actual)}`
      )
    }
  }
}

function gitTrackedFiles(patterns = []) {
  const args = ['ls-files', '-z']
  if (patterns.length > 0) args.push('--', ...patterns)

  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`)
  }

  return result.stdout.toString('utf8').split('\0').filter(Boolean)
}

function displayPath(filePath) {
  const relative = path.relative(root, filePath)
  return relative.startsWith('..') ? filePath : relative
}

export function findConflictMarkers(filePaths) {
  const findings = []

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(root, filePath)
    let content

    try {
      const bytes = fs.readFileSync(absolutePath)
      if (bytes.includes(0)) continue
      content = bytes.toString('utf8')
    } catch (error) {
      if (error.code === 'EISDIR') continue
      throw error
    }

    for (const match of scanConflictMarkers(content)) {
      const line = content.slice(0, match.index).split('\n').length
      findings.push(`${displayPath(absolutePath)}:${line}: ${match.marker}`)
    }
  }

  return findings
}

export function findInvalidYaml(filePaths) {
  const findings = []

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(root, filePath)
    const result = spawnSync(
      'ruby',
      ['-e', 'require "yaml"; YAML.parse_file(ARGV.fetch(0))', absolutePath],
      { encoding: 'utf8' }
    )

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error('Ruby is required for workflow YAML syntax validation but was not found')
      }
      throw result.error
    }

    if (result.status !== 0) {
      const detail = result.stderr
        .trim()
        .split('\n')
        .find((line) => line.includes('parse'))
      findings.push(`${displayPath(absolutePath)}: ${detail ?? 'invalid YAML syntax'}`)
    }
  }

  return findings
}

function parseExplicitPaths(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  const paths = process.argv.slice(index + 1)
  if (paths.length === 0) throw new Error(`${flag} requires at least one file path`)
  return paths
}

// ── 资产体积门禁（2026-09-06 新增）──────────────────────────────────────────
// 为什么要有：2026-09-06 仓库审计实测——.git 2.3 GB 里 789 MB 是本地分支钉住的
// 截图证据，其中 549 MB 出自 docs/design/kiosk-redesign-2026-08；磁盘上另有 722 MB
// 未跟踪证据当时没有任何 .gitignore 规则拦着。整个仓库此前没有任何体积门禁，
// 唯一的防线是人自觉。这条就是那道机械防线。
//
// 口径：只看**已跟踪**文件的当前体积，不看历史（历史已成事实，重写代价见审计报告）。
// 超限的既有文件登记在 ALLOWED_LARGE_ASSETS 里，新增的必须显式加进来才能过。
const LARGE_ASSET_LIMIT_BYTES = 1024 * 1024

// 既有超限资产白名单。加新条目前先问：这个文件必须进版本库吗？
// 设计稿背景图、首页大图属「运行时要用」，证据截图不属于。
const ALLOWED_LARGE_ASSETS = new Set([
  // 一体机运行时资源（构建产物要用，必须入库）
  'apps/kiosk/public/assets/kiosk-home-hero-job-fair.png',
  'apps/kiosk/public/assets/ai-advisor.png',
  // 青序流光原型的运行时背景图（产品负责人指定保留的设计真值目录）
  'docs/design/kiosk-redesign-2026-08/assets/bg-hero.jpg',
  'docs/design/kiosk-redesign-2026-08/assets/bg-standby.jpg',
  // 按 CLAUDE.md §7 强制维护的进度文档；是否分档见审计报告「需拍板」
  'docs/progress/current-progress.md',
  // 项目图谱自动产物（pnpm graph 生成，可重建）
  'docs/graph/graph.json',
])

function findOversizedAssets(files) {
  const findings = []
  for (const file of files) {
    if (ALLOWED_LARGE_ASSETS.has(file)) continue
    const abs = path.join(root, file)
    let size
    try {
      size = fs.statSync(abs).size
    } catch {
      continue // 已删除但仍在索引里的，交给别的检查
    }
    if (size > LARGE_ASSET_LIMIT_BYTES) {
      findings.push(
        `${file}: ${(size / 1024 / 1024).toFixed(2)} MB 超过 ${LARGE_ASSET_LIMIT_BYTES / 1024 / 1024} MB 上限。` +
          '证据截图与一次性验收素材不要入库（放 docs/design 下对应目录并加 .gitignore）；' +
          '确属运行时必需的，加进 ALLOWED_LARGE_ASSETS 并写明理由。',
      )
    }
  }
  return findings
}

function reportFailures(label, findings) {
  if (findings.length === 0) return
  console.error(`ERROR: ${label}`)
  for (const finding of findings) console.error(`  ${finding}`)
  process.exitCode = 1
}

function main() {
  verifyConflictMarkerDetector()

  const explicitConflictPaths = parseExplicitPaths('--check-conflicts')
  const explicitYamlPaths = parseExplicitPaths('--check-yaml')

  if (explicitConflictPaths && explicitYamlPaths) {
    throw new Error('Use only one explicit check mode at a time')
  }

  if (explicitConflictPaths) {
    const findings = findConflictMarkers(explicitConflictPaths)
    reportFailures('unresolved conflict markers found', findings)
    if (findings.length === 0) console.log('OK: no unresolved conflict markers found')
    return
  }

  if (explicitYamlPaths) {
    const findings = findInvalidYaml(explicitYamlPaths)
    reportFailures('invalid workflow YAML found', findings)
    if (findings.length === 0) console.log('OK: workflow YAML syntax is valid')
    return
  }

  const trackedFiles = gitTrackedFiles()
  const workflowFiles = gitTrackedFiles(['.github/workflows/*.yml', '.github/workflows/*.yaml'])

  const conflictFindings = findConflictMarkers(trackedFiles)
  const yamlFindings = findInvalidYaml(workflowFiles)
  const oversizedFindings = findOversizedAssets(trackedFiles)
  reportFailures('unresolved conflict markers found in tracked files', conflictFindings)
  reportFailures('invalid workflow YAML found', yamlFindings)
  reportFailures('oversized tracked assets found', oversizedFindings)

  if (conflictFindings.length === 0) {
    console.log(`OK: ${trackedFiles.length} tracked files contain no unresolved conflict markers`)
  }
  if (yamlFindings.length === 0) {
    console.log(`OK: ${workflowFiles.length} workflow YAML files have valid syntax`)
  }
  if (oversizedFindings.length === 0) {
    console.log(
      `OK: no tracked file exceeds ${LARGE_ASSET_LIMIT_BYTES / 1024 / 1024} MB ` +
        `(${ALLOWED_LARGE_ASSETS.size} registered exceptions)`,
    )
  }
}

try {
  main()
} catch (error) {
  console.error(`ERROR: repository integrity check could not run: ${error.message}`)
  process.exitCode = 1
}
