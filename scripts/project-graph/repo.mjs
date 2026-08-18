// ============================================================================
// 项目图谱 · 仓库访问层
//
// 只用 node 内置模块（与 verify-repository-integrity / verify-ci-gate-coverage
// 同规矩）：图谱脚本要能在 `pnpm install` 之前跑，不得引入任何依赖。
//
// 事实来源是 `git ls-files`，不是磁盘遍历 —— 磁盘上有 node_modules、dist、
// 别人 worktree 的残留和未跟踪的临时文件；只有 git 索引里的才是仓库内容。
// 这条同时也是 docs/README.md 里那条取证规则的机器化版本。
// ============================================================================

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 仓库内路径统一用 posix 分隔符表示，保证 Windows / macOS 产出同一份图谱。 */
export function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

export function absolute(relativePath) {
  return path.join(REPO_ROOT, ...relativePath.split('/'))
}

let trackedCache = null

/** git 索引里的全部文件（已排序，posix 路径）。 */
export function trackedFiles() {
  if (trackedCache) return trackedCache

  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString('utf8').trim()}`)
  }

  trackedCache = result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .sort()

  return trackedCache
}

const textCache = new Map()

/** 读取文本；二进制或不存在一律返回空串，调用方不必到处 try。 */
export function readText(relativePath) {
  if (textCache.has(relativePath)) return textCache.get(relativePath)

  let text = ''
  try {
    const bytes = fs.readFileSync(absolute(relativePath))
    if (!bytes.includes(0)) text = bytes.toString('utf8')
  } catch {
    text = ''
  }

  textCache.set(relativePath, text)
  return text
}

export function readJson(relativePath) {
  const text = readText(relativePath)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 注释剥离
// ---------------------------------------------------------------------------
// 为什么必须先剥注释：本仓库的 controller 顶部普遍有一整块「路由清单」注释
// （见 services/api/src/jobs/jobs.controller.ts），直接对原文 grep 装饰器会
// 把注释里的历史路由当成真实端点 —— 那正是今天要消灭的「按注释判断实现」。
//
// 反斜杠在字符串外也按转义处理，这样正则字面量里的 `\/\/` 不会被误当行注释。
export function stripComments(text) {
  let out = ''
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]

    if (ch === '\\') {
      out += text.slice(i, i + 2)
      i += 2
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < n) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text[j] === quote) break
        j += 1
      }
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      // 用换行占位保住行号，方便人拿图谱回查源文件。
      const chunk = text.slice(i, end === -1 ? n : end + 2)
      out += chunk.replace(/[^\n]/g, ' ')
      i = end === -1 ? n : end + 2
      continue
    }

    out += ch
    i += 1
  }

  return out
}

// ---------------------------------------------------------------------------
// 模块解析
// ---------------------------------------------------------------------------

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json']

/** workspace 包名 → 入口文件所在目录（用于跨包引用解析）。 */
export const WORKSPACE_PACKAGES = {
  '@ai-job-print/shared': 'packages/shared/src',
  '@ai-job-print/ui': 'packages/ui/src',
  '@ai-job-print/refresh': 'packages/refresh/src',
}

function tryFile(candidate, fileSet) {
  if (fileSet.has(candidate)) return candidate
  for (const ext of EXTENSIONS) {
    if (fileSet.has(candidate + ext)) return candidate + ext
  }
  for (const ext of EXTENSIONS) {
    if (fileSet.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`
  }
  return null
}

/**
 * 把 import 说明符解析成仓库内文件路径。
 * 解析不到（第三方依赖、node: 内置、静态资源）返回 null —— 图谱只画仓库内的边。
 *
 * @param fromFile  posix 相对路径，如 apps/kiosk/src/pages/jobs/JobsPage.tsx
 * @param spec      import 字符串
 * @param fileSet   Set<posix 相对路径>
 * @param appRoot   该文件所属应用根（用于 '@/' 别名），如 apps/kiosk
 */
export function resolveModule(fromFile, spec, fileSet, appRoot) {
  if (!spec || spec.startsWith('node:')) return null

  if (spec.startsWith('.')) {
    const dir = path.posix.dirname(fromFile)
    return tryFile(path.posix.normalize(path.posix.join(dir, spec)), fileSet)
  }

  // vite alias：'@/x' → <appRoot>/src/x（见各 app 的 vite.config.ts resolve.alias）
  if (spec.startsWith('@/') && appRoot) {
    return tryFile(`${appRoot}/src/${spec.slice(2)}`, fileSet)
  }

  for (const [pkg, dir] of Object.entries(WORKSPACE_PACKAGES)) {
    if (spec === pkg) return tryFile(dir, fileSet)
    if (spec.startsWith(`${pkg}/`)) return tryFile(`${dir}/${spec.slice(pkg.length + 1)}`, fileSet)
  }

  return null
}

// `(?:...)??` 里的第二个 `?` 是必须的：默认贪婪会让 `import './a.css'` 这行的
// 空 from 子句被跳过，正则一路吃到下一行的 `from './routes'`，于是副作用 import
// （所有 CSS）在图里凭空消失，全部样式表都会被误报成孤儿。改成惰性后先试空子句。
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)??['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_PATTERN = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
// CSS 之间靠 `@import` 串联（如 pages/auth/login.css 汇总 styles/login-*.css），
// 这类边不在 JS import 图里，漏掉会让被汇总的分片样式全部误报为孤儿。
const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g

/** 抽出一个文件里的全部 import/export-from/动态 import/CSS @import 说明符。 */
export function importSpecifiers(strippedText) {
  const found = new Set()
  for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN, CSS_IMPORT_PATTERN]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(strippedText)) !== null) found.add(match[1])
  }
  return [...found].sort()
}

/** 稳定排序：图谱两次生成必须逐字节一致，所有集合都从这里出。 */
export function sorted(values) {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
