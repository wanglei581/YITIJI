import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * 已迁路由必须从能力契约清单退役。
 *
 * 唯一判据：`docs/design/kiosk-migration-capability-contracts.md` 里
 * `## /路由（稿 xx）` 列出的页面，如果这条路由已经进了
 * `KioskRoot.tsx` 的 `QX_MIGRATED_ROUTES`，那一段必须已经从清单删除。
 *
 * 不检查四条（出口 / a11y / 状态告知 / 诚实披露）有没有真做到——
 * 那做不到，也不该假装能做到。迁完的人必须回来处理这一段，
 * 处理时会被迫再看一遍那四条。
 *
 * `QX_MIGRATED_ROUTES` 用 TypeScript AST 读。这个文件已经让两个人
 * 用正则读出过 0 条（注释、泛型参数、换行把字面量切开）。
 */

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')
const kioskRootPath = join(kioskRoot, 'src/layouts/KioskRoot.tsx')
const contractPath = join(repoRoot, 'docs/design/kiosk-migration-capability-contracts.md')
const packageJsonPath = join(kioskRoot, 'package.json')

const SCRIPT_NAME = 'verify:migration-contract-retired'
const SCRIPT_BODY = 'node scripts/verify-migration-contract-retired.mjs'
const HEADING_MARK = '（稿'

function fail(message) {
  console.error(`FAIL ${SCRIPT_NAME}\n`)
  console.error(message)
  process.exit(1)
}

function collectQxMigratedRoutes(source) {
  const file = ts.createSourceFile(
    'KioskRoot.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let initializer = null
  const findDeclaration = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'QX_MIGRATED_ROUTES'
    ) {
      initializer = node.initializer ?? null
    }
    ts.forEachChild(node, findDeclaration)
  }
  findDeclaration(file)

  if (!initializer) {
    fail('apps/kiosk/src/layouts/KioskRoot.tsx 必须声明 QX_MIGRATED_ROUTES')
  }

  if (!ts.isNewExpression(initializer)) {
    fail('QX_MIGRATED_ROUTES 必须是 new Set<string>([...])，不能改成别的初始化式（AST 才能静态枚举）')
  }

  const ctor = initializer.expression
  if (!ts.isIdentifier(ctor) || ctor.text !== 'Set') {
    fail('QX_MIGRATED_ROUTES 必须是 new Set(...)')
  }

  const firstArg = initializer.arguments?.[0]
  if (!firstArg) {
    fail('QX_MIGRATED_ROUTES 的 Set 必须传入路由字符串数组')
  }

  const array = unwrapArrayLiteral(firstArg)
  if (!array) {
    fail('QX_MIGRATED_ROUTES 必须用数组字面量初始化，不能用变量或展开')
  }

  const routes = []
  for (const element of array.elements) {
    if (ts.isSpreadElement(element)) {
      fail('QX_MIGRATED_ROUTES 不得使用展开运算符，门禁无法静态枚举每一条路由')
    }
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
      routes.push(element.text)
      continue
    }
    fail(
      `QX_MIGRATED_ROUTES 的数组元素必须是字符串字面量，收到 ${ts.SyntaxKind[element.kind]}`,
    )
  }

  return [...new Set(routes)]
}

function unwrapArrayLiteral(node) {
  if (ts.isArrayLiteralExpression(node)) return node
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrapArrayLiteral(node.expression)
  }
  return null
}

function collectContractRoutes(markdown) {
  const routes = []
  const seen = new Set()
  const lines = markdown.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('## /')) continue

    const rest = line.slice('## '.length)
    const markAt = rest.indexOf(HEADING_MARK)
    if (markAt < 0) {
      fail(
        `契约标题必须是「## /路由（稿 xx）」格式，第 ${index + 1} 行：${line}`,
      )
    }

    const route = rest.slice(0, markAt).trim()
    if (!route.startsWith('/') || route.includes(' ') || route.includes('（')) {
      fail(`契约标题路由无效，第 ${index + 1} 行：${line}`)
    }
    if (seen.has(route)) {
      fail(`契约标题路由重复：${route}`)
    }

    seen.add(route)
    routes.push(route)
  }

  return routes
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const scripts = packageJson.scripts ?? {}
if (scripts[SCRIPT_NAME] !== SCRIPT_BODY) {
  fail(`apps/kiosk/package.json 必须暴露 \`${SCRIPT_NAME}\`: ${SCRIPT_BODY}`)
}

const chainedFrom = Object.entries(scripts).filter(
  ([name, body]) => name !== SCRIPT_NAME && String(body).includes(`pnpm run ${SCRIPT_NAME}`),
)
if (chainedFrom.length === 0) {
  fail(
    `${SCRIPT_NAME} 必须串进某条已有 verify:*（当前挂在 verify:fusion-shell），` +
      '否则 verify:ci-gate-coverage 会判「未被任何 CI job 执行」',
  )
}

const kioskRootSource = readFileSync(kioskRootPath, 'utf8')
const migratedRoutes = collectQxMigratedRoutes(kioskRootSource)
const migrated = new Set(migratedRoutes)

const contractSource = readFileSync(contractPath, 'utf8')
const contractRoutes = collectContractRoutes(contractSource)

const leftover = contractRoutes.filter((route) => migrated.has(route)).sort()
if (leftover.length > 0) {
  fail(
    [
      `已迁入青序流光（QX_MIGRATED_ROUTES）但契约清单仍留着的路由：${leftover.join('、')}`,
      '',
      '契约文档自己写着「某页迁完就把它那一段删掉——契约的归宿是变成页面本身和门禁，不是永久台账」。',
      '请对照那一段的四条（出口 / a11y / 状态告知 / 诚实披露）逐条确认后删除该段。',
      `清单：docs/design/kiosk-migration-capability-contracts.md`,
    ].join('\n'),
  )
}

console.log(`PASS QX_MIGRATED_ROUTES via AST: ${migratedRoutes.length} routes`)
console.log(`PASS contract headings: ${contractRoutes.length} pending pages`)
console.log('PASS no migrated route still listed in capability contracts')
console.log(`ALL PASS ${SCRIPT_NAME}`)
