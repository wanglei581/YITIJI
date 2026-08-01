#!/usr/bin/env node
/**
 * verify-import-review-reset.mjs
 *
 * 静态分析：确认 Partner/Excel 主动导入的 upsert update 块
 * 一律包含 reviewStatus:'pending' + publishStatus:'draft'（强制重审），
 * 并清空 rejectReason/reviewedBy/reviewedAt 审核元数据。
 *
 * 【实现方式：TypeScript AST，不是正则/词法】
 *
 * 早期三个版本用「剥离注释字符串 + 花括号配平 + 整块正则」的词法方案，
 * 连续三轮 codex 复审累计查出 7 条以上绕过，且每修一条就冒出新的语法边角：
 *   `return /}/` 被当成除号导致块提前截断、`['update']:` 计算属性名、
 *   重复 `update:` 键（JS 后者覆盖前者）、upsert 实参层展开、
 *   `a++ / b / c` 被误判为正则、字段名前缀误匹配……
 * 这些都是词法层**原理上**无法可靠判定的东西。现改为直接用 TypeScript
 * 编译器 API 解析 AST（`typescript` 已是 services/api 的 devDependency，
 * 零新增依赖），上述形态全部由结构判定天然消除：注释与字符串不再参与匹配，
 * 正则是 RegularExpressionLiteral 节点，键名是精确匹配而非子串。
 *
 * 静态不可判定的形态一律**抛错**（fail-closed），绝不放行。共四类：
 *   ① upsert 实参 / update 值不是对象字面量（常量引用、函数调用、三元…）；
 *   ② 第一层出现展开 `...`（可能把状态覆写回已审已发布）；
 *   ③ 第一层出现计算属性名 `[expr]:`（键名运行时才定）；
 *   ④ 第一层出现重复键（JS 后者覆盖前者，静态取哪个都不安全）。
 *
 * ⚠️ 关于 job-sync.service.ts 的反向断言（务必读完再改）
 *
 * 本脚本断言 job-sync（API 定时拉取）的 update 块**不含**无条件重置。
 * 这条断言**不是**在声明当前实现正确，而是把一个**已登记的 P0 缺口**冻结住：
 *
 *   现状缺口：自动拉取会改写已 approved+published 记录的 title/company/
 *   description/sourceUrl 等展示字段，却保留审核发布态，因此内容变更后
 *   继续对外公开而不重新过审。详见 docs/governance/standards-index.md 第十一节。
 *
 * 断言存在的理由：防止有人为"统一风格"把这里改成**无条件** pending 重置——
 * 那会让每 30 分钟一次的 Cron（见 job-sync.scheduler.ts:19 的 @Cron 表达式）
 * 把全部已审记录退回待审，压垮审核队列。
 *
 * 👉 如果你正在实施正解（按内容哈希判定：内容未变只更新 syncTime、
 *    展示字段变化才退审），那么这条断言需要同步放开——请改这里，
 *    不要绕过门禁，也不要简单删掉断言了事。
 *
 * 退出码：0 = 全部通过  1 = 有失败（fail-closed：文件缺失/解析失败/块数不符均算失败）
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const SRC = resolve(__dir, '../src/jobs')

/**
 * 期望库存：精确到「函数名 · 模型」的多重集合，不是每文件数量。
 *
 * 早期只登记数量（partner:3 / excel:2 / sync:2），于是把 `importFairs` 里的
 * `.jobFair.upsert(` 改成 `.job.upsert(` —— 招聘会导入实际写错表，是真实 bug ——
 * 数量仍为 3，门禁照样输出 `✅ importFairs() · job.upsert` 并 exit 0（已实测）。
 * 改为精确集合后，站点构成变化（改名/换模型/挪函数）都会失败。
 */
const EXPECTED_SITES = {
  'jobs-partner.service.ts': ['importJobs·job', 'importJobsFromWebhook·job', 'importFairs·jobFair'],
  'jobs-excel.service.ts': ['confirmExcelImport·job', 'confirmExcelImport·jobFair'],
  'job-sync.service.ts': ['upsertJobs·job', 'upsertFairs·jobFair'], // 反向断言
}

/** 自测用例总数（写死：用例数组被清空时 total=0 会让 17 项断言静默消失，须由此常量兜住） */
const EXPECTED_SELFTEST_CASES = 24

/** 全部汇总检查项 = 5 真实站点 + 2 反向断言 + 自测用例数 */
const EXPECTED_TOTAL =
  Object.values(EXPECTED_SITES).reduce((n, a) => n + a.length, 0) + EXPECTED_SELFTEST_CASES

// ──────────────────────────────────────────────────────────────────────────────
// AST 基础工具
// ──────────────────────────────────────────────────────────────────────────────
function parse(filename, source) {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  // 语法错误必须 fail-closed：解析出错时 AST 不可信，不能继续做判定
  const diags = sf.parseDiagnostics ?? []
  if (diags.length > 0) {
    const first = ts.flattenDiagnosticMessageText(diags[0].messageText, ' ')
    throw new Error(`${filename} 解析出现语法错误，AST 不可信：${first}`)
  }
  return sf
}

/**
 * 剥掉不影响运行时值的包装：`as const` / `satisfies X` / `(expr)` / `expr!` / `<const>expr`。
 * 这些都是纯类型层语法，剥掉不改变运行时值；漏剥只会造成误报（正向断言判为缺失），
 * 不会造成漏判，因此宁可多列几种也不能少列可能改变值的形态。
 */
function unwrap(node) {
  let n = node
  for (;;) {
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) n = n.expression
    else if (ts.isSatisfiesExpression?.(n)) n = n.expression
    else if (ts.isNonNullExpression(n)) n = n.expression
    else if (ts.isTypeAssertionExpression?.(n)) n = n.expression // 老式 <const>'pending'
    else return n
  }
}

/** 取属性名；计算属性名返回 null（调用方按不可判定处理） */
function propName(prop) {
  const name = prop.name
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null // ComputedPropertyName / PrivateIdentifier
}

/**
 * 读对象字面量**第一层**的属性表。
 * 三类静态不可判定形态直接抛错（fail-closed）：展开、计算属性名、重复键。
 */
function topLevelProps(objLit, where) {
  const map = new Map()
  // 记录最后一个展开的位置。JS 对象字面量语义：**后写的键覆盖先前的展开**，
  // 所以「五项重置全部位于最后一个展开之后」是静态可判定的安全形态，应当放行；
  // 反之位于展开之前（或之间）则可能被展开覆写回 approved+published，必须拒绝。
  // 早期版本一律抛错，但错误提示写的是「请放在展开之后」——照做仍然失败，
  // 这种"提示一条走不通的路"的门禁会逼人绕过它，故改为真正实现位置判定。
  let lastSpreadIdx = -1
  let idx = -1
  for (const prop of objLit.properties) {
    idx++
    if (ts.isSpreadAssignment(prop)) {
      lastSpreadIdx = idx
      continue
    }
    if (prop.name && ts.isComputedPropertyName(prop.name)) {
      throw new Error(
        `${where} 第一层出现计算属性名 \`[expr]:\`，键名运行时才确定，静态无法判定 → 按失败处理。`
      )
    }
    const key = propName(prop)
    if (key === null) {
      throw new Error(`${where} 第一层出现无法静态求名的属性（${ts.SyntaxKind[prop.kind]}） → 按失败处理。`)
    }
    if (map.has(key)) {
      throw new Error(
        `${where} 第一层出现重复键 \`${key}\`。JS 语义是后者覆盖前者，静态取任一都不安全 → 按失败处理。`
      )
    }
    // ShorthandPropertyAssignment / MethodDeclaration 没有 initializer，记为 null
    map.set(key, {
      value: ts.isPropertyAssignment(prop) ? unwrap(prop.initializer) : null,
      idx,
    })
  }
  // 注意：这里**不**剔除展开之前的键，位置信息交给两个 checker 各自解释——
  // 两个方向对"位于展开之前的键"的保守解释恰好相反，合并处理必然错一边：
  //   · 正向（必须重置）：展开之前的写入可能被覆写回 approved+published
  //     → 不可信 → 按「缺少」处理（见 trustedValue）；
  //   · 反向（不得无条件重置）：展开之前的写入**也可能真的生效**
  //     （若展开对象不含该键），仍是潜在的无条件重置
  //     → 按「存在」处理（见 checkMustNotReset 用 hasKey 而非 trustedValue）。
  return { map, lastSpreadIdx }
}

/** 取「可信」值：键必须存在，且位置在最后一个展开之后（否则可能被展开覆写） */
function trustedValue(props, key) {
  const e = props.map.get(key)
  if (e === undefined) return undefined
  if (e.idx < props.lastSpreadIdx) return undefined // 可能被后面的展开覆写 → 不可信
  return e.value
}

/** 键是否出现过（不论位置、不论形态）——反向断言用 */
function hasKey(props, key) {
  return props.map.has(key)
}

const isStr = (want) => (node) =>
  node != null && ts.isStringLiteral(node) && node.text === want
const isNull = (node) => node != null && node.kind === ts.SyntaxKind.NullKeyword

// 退审必须同时清空上一次的审核元数据，否则会出现
// 「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态
const REQUIRED = [
  { key: 'reviewStatus', label: "reviewStatus:'pending'", ok: isStr('pending') },
  { key: 'publishStatus', label: "publishStatus:'draft'", ok: isStr('draft') },
  { key: 'rejectReason', label: 'rejectReason:null', ok: isNull },
  { key: 'reviewedBy', label: 'reviewedBy:null', ok: isNull },
  { key: 'reviewedAt', label: 'reviewedAt:null', ok: isNull },
]

// ──────────────────────────────────────────────────────────────────────────────
// 提取：找 .job.upsert( / .jobFair.upsert( 的 update 对象字面量
// ──────────────────────────────────────────────────────────────────────────────
/** 沿 AST 向上找最近的具名函数/方法，作为输出里的上下文标签 */
function enclosingFnName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) {
      if (p.name && ts.isIdentifier(p.name)) return p.name.text
    }
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && ts.isVariableDeclaration(p.parent)) {
      if (ts.isIdentifier(p.parent.name)) return p.parent.name.text
    }
  }
  return '(unknown)'
}

/**
 * 只认带审核字段的内容模型：`<任意>.job.upsert(` / `<任意>.jobFair.upsert(`。
 * 刻意排除 fieldMappingRule 等没有 reviewStatus 字段的模型
 * （早期版本用 /\.upsert\s*\(/ 会把 jobs-excel.service.ts 的
 *   fieldMappingRule.upsert 扫进来，报假阳性）。
 */
/** 静态取成员名：`.foo` 与 `['foo']` 等价，`[expr]` 取不到 */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) {
    const a = node.argumentExpression
    if (a && ts.isStringLiteralLike(a)) return a.text
  }
  return null
}

/**
 * 判定一个调用是否 job/jobFair 的 upsert，返回模型名；不相关则 null。
 *
 * ⚠️ 认出是 upsert 之后，**取不到模型名就必须抛错**，不能 return null 静默跳过。
 * 原实现只认 `a.b.upsert(...)` 一种形态，其余一律 null：于是新增一处
 * `prisma['job'].upsert({...})`（不写重置）对门禁完全不可见——库存核对也抓不到，
 * 因为它只比对「已登记站点是否都在」，凭空多出的隐形站点不在集合里。
 */
function upsertModelOf(call, where) {
  const callee = call.expression
  if (memberName(callee) !== 'upsert') return null

  // owner 形态：`tx.job` / `prisma['job']` / 解构后的裸 `job`
  const owner = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
    ? callee.expression
    : null
  let model = owner ? memberName(owner) : null
  if (model === null && owner && ts.isIdentifier(owner)) model = owner.text // `const { job } = tx`

  if (model === null) {
    throw new Error(
      `${where} 出现无法静态归属的 \`upsert\` 调用（形如 \`prisma[key].upsert\` / \`getModel().upsert\`）——\n` +
        '      取不到模型名就无法判断它是否需要重置审核状态，按失败处理。\n' +
        '      请改成 `tx.job.upsert(...)` 等可静态归属的写法，或在本门禁显式登记。'
    )
  }
  return model === 'job' || model === 'jobFair' ? model : null
}

function extractBlocks(filepath, source) {
  const short = filepath.split('/').pop()
  const sf = parse(short, source)
  const blocks = []

  const visit = (node) => {
    const model = ts.isCallExpression(node) ? upsertModelOf(node, `${short} 第 ${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} 行`) : null
    if (model) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
      const site = `${enclosingFnName(node)}() · ${model}.upsert @L${line}`
      const where = `${short} 的 ${site} 的 upsert 实参`

      const arg = node.arguments[0]
      if (!arg || !ts.isObjectLiteralExpression(unwrap(arg))) {
        throw new Error(
          `${where}不是对象字面量（可能是常量引用/展开/函数调用）——本门禁无法判定其内容，按失败处理。`
        )
      }
      // 实参层也要挡展开/计算键/重复键：`upsert({ ...args, update })` 能注入 update
      const argProps = topLevelProps(unwrap(arg), where)
      // 实参层用 trustedValue：`upsert({ ...args, update: {...} })` 里 update 若在展开之前，
      // 展开可能整体替换掉它 → 取不到可信值 → 走下面的「未找到 update 键」分支 fail-closed。
      const updateNode = trustedValue(argProps, 'update')
      if (updateNode === undefined) {
        throw new Error(`${where}第一层未找到 \`update\` 键 —— 无法确认重置是否存在，按失败处理。`)
      }
      if (updateNode === null || !ts.isObjectLiteralExpression(updateNode)) {
        throw new Error(
          `${where}的 \`update\` 值不是对象字面量（可能写成了 \`update: 常量\` / 函数调用 / 三元）——\n` +
            '      本门禁无法判定其内容，按失败处理。'
        )
      }
      blocks.push({
        filepath,
        site,
        line,
        // 库存核对键：函数名·模型（不含行号——行号会随无关编辑漂移，不适合做登记值）
        key: `${enclosingFnName(node)}·${model}`,
        props: topLevelProps(updateNode, `${short} 的 ${site} 的 update 块`),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return blocks
}

function extractBlocksFromFile(filepath) {
  return extractBlocks(filepath, readFileSync(filepath, 'utf8'))
}

// ──────────────────────────────────────────────────────────────────────────────
// 检查规则
// ──────────────────────────────────────────────────────────────────────────────
function checkMustReset(blocks, label) {
  let pass = 0,
    fail = 0
  // 结构化失败详情：自测据此断言「失败的是哪一处、缺的是哪几项」，
  // 只看聚合 fail 数会让「因无关块失败」的用例假绿。
  const failures = []
  for (const b of blocks) {
    // 只认第一层字段：搬进嵌套子对象的重置对 Prisma 无效，不能算通过
    const missing = REQUIRED.filter((f) => !f.ok(trustedValue(b.props, f.key))).map((f) => f.label)
    if (missing.length === 0) {
      console.log(`  ✅  ${label} · ${b.site} · update 块含 pending+draft 退审 & 已清空审核元数据`)
      pass++
    } else {
      console.error(`  ❌  ${label} · ${b.site} · update 块缺少 ${missing.join(', ')}`)
      failures.push({ site: b.site, missing })
      fail++
    }
  }
  return { pass, fail, failures }
}

function checkMustNotReset(blocks, label) {
  let pass = 0,
    fail = 0
  const failures = []
  for (const b of blocks) {
    // 反向断言同样只看第一层：嵌套里的字段对 Prisma 无效，不构成"无条件重置"
    //
    // ⚠️ 判据是「键在不在」，不是「值等不等于 'pending'」——方向与正向断言相反，这是刻意的：
    //   · 正向（必须重置）要严格：只有确切的 'pending' 字面量才算数，写成表达式一律算缺失；
    //   · 反向（不得无条件重置）要宽松：任何形态的赋值都可能是重置，都必须报失败。
    // 若这里沿用 isStr('pending')，则 `reviewStatus: PENDING`（identifier）、
    // `reviewStatus,`（shorthand）、`reviewStatus: \`pending\``（模板串）三种写法
    // 都不是 StringLiteral 节点 → 判为「缺席」→ 静默放行，冻结标记形同虚设。
    // 这三种绕过已实测复现（门禁 exit 0），故改为键存在即失败。
    // job-sync 的 update 块本来就完全不写这两个键（见 :493 注释），故不会误报。
    const hasR = hasKey(b.props, 'reviewStatus')
    const hasP = hasKey(b.props, 'publishStatus')
    if (!hasR && !hasP) {
      console.log(
        `  ⚠️  ${label} · ${b.site} · 无条件重置缺席（符合断言）` +
          ' —— 注意这是【已登记 P0 缺口冻结态】，不代表当前实现无问题'
      )
      pass++
    } else {
      failures.push({ site: b.site, keys: [hasR && 'reviewStatus', hasP && 'publishStatus'].filter(Boolean) })
      const unexpected = [hasR && 'reviewStatus', hasP && 'publishStatus']
        .filter(Boolean)
        .map((k) => `${k}（任意形态的赋值都算）`)
        .join(', ')
      console.error(
        `  ❌  ${label} · ${b.site} · 自动同步 update 块出现 ${unexpected}\n` +
          '      如果这是"无条件重置"：会让每 30 分钟一次的 Cron 把全部已审记录退回待审，压垮审核队列 → 请回退。\n' +
          '      如果你正在实施正解（按内容哈希退审：内容未变只更新 syncTime，展示字段变化才退审）：\n' +
          '      请改本脚本的这条断言，不要绕过门禁、也不要直接删断言。\n' +
          '      背景：docs/governance/standards-index.md 第十一节「审核控制不随内容变更重新生效」。'
      )
      fail++
    }
  }
  return { pass, fail, failures }
}

// ──────────────────────────────────────────────────────────────────────────────
// 自测：对抗用例（全内存合成夹具，不读真实文件、不写盘）
//
// 门禁自己也可能有假通过。以下用例全部是 codex 三轮复审点出、并已实际复现过的
// 绕过形态或误报形态。改用合成夹具而非「从真实文件切片」是刻意的：
// 旧版靠 `raw.includes(RESET_BLOCK)` 对齐真实文件缩进，一旦真实文件改格式，
// selfTest 会走 `return 1` 分支，而主逻辑按 `{leaked,total}` 解构 → 两者变
// undefined → totalFail 变 NaN → `NaN > 0` 为 false → **真实失败被抹掉后 exit 0**。
// 已实测复现：门禁先打印 `❌ partner · importJobs() … 缺少 reviewedAt:null`，
// 紧接着打印 `✅ ALL PASS` 并 exit 0。合成夹具没有这个耦合，该 fail-open 随之消失。
//
// expect 语义：
//   'fail'         → 必须被判缺字段，且失败块的 site 须匹配 caseSite
//   'throw'        → 必须抛错，且错误信息匹配 errRe（只接受目标机制的错误）
//   'pass'         → 必须正常通过，且提取块数须等于 wantBlocks（防解析退化成空数组也算过）
//   'reverse-fail' → 反向断言（checkMustNotReset）必须报失败
// ──────────────────────────────────────────────────────────────────────────────
const RESET_INLINE = [
  "          reviewStatus: 'pending',",
  "          publishStatus: 'draft',",
  '          rejectReason: null,',
  '          reviewedBy: null,',
  '          reviewedAt: null,',
].join('\n')

/** 合成一个含单个 upsert 的最小 service 夹具 */
function synth(updateInner, { model = 'job', fn = 'importJobs', argExtra = '', body = '' } = {}) {
  return `import { Injectable } from '@nestjs/common'

@Injectable()
export class FixtureService {
  async ${fn}(dto: any) {
${body}
    await this.prisma.${model}.upsert({${argExtra}
      where: { id: dto.id },
      create: { title: dto.title },
      update: {
${updateInner}
      },
    })
  }
}
`
}

const CASE_SITE = (fn = 'importJobs', model = 'job') => `${fn}() · ${model}.upsert @L`

function selfTest() {
  const cases = [
    {
      name: 'A update 值是常量引用（无字面量可解析）',
      expect: 'throw',
      errRe: /不是对象字面量/,
      src: () =>
        synth('').replace(/update: \{\n\n      \},/, 'update: RESET_FIELDS,'),
    },
    {
      name: 'B 含引号与花括号的正则 + 重置齐全（应通过，防误报）',
      expect: 'pass',
      wantBlocks: 1,
      src: () =>
        synth(`          title: /['"{}]/.test(dto.title) ? 'x' : dto.title,\n${RESET_INLINE}`),
    },
    {
      name: "B′ return /}/ 正则（旧词法版真实绕过：} 被当真闭括号致块截断）",
      expect: 'pass',
      wantBlocks: 1,
      src: () =>
        synth(
          `          title: (() => {\n            return /}/.test(dto.title) ? 'a' : 'b'\n          })(),\n${RESET_INLINE}`
        ),
    },
    {
      name: "B″ return /}/ 正则 + 缺重置（旧词法版此形态被放行 → 必须失败）",
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () =>
        synth(
          `          title: (() => {\n            return /}/.test(dto.title) ? 'a' : 'b'\n          })(),\n          reviewStatus: 'pending',`
        ),
    },
    {
      name: 'C 字符串诱饵冒充字段赋值',
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () =>
        synth(
          `          description: "reviewStatus: 'pending', publishStatus: 'draft', rejectReason: null, reviewedBy: null, reviewedAt: null",`
        ),
    },
    {
      name: 'D 五项重置搬进嵌套子对象（对 Prisma 无效）',
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () => synth(`          meta: {\n${RESET_INLINE}\n          },`),
    },
    {
      name: 'E 嵌套 update 抢位（真 update 在后且为空）',
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () => synth(`          child: { update: {\n${RESET_INLINE}\n          } },`),
    },
    {
      // 五项在展开之**前** → 展开可能把它们覆写回 approved+published → 不可信 → 按缺少处理
      name: 'F 五项重置在展开之前（可能被展开覆写 → 必须失败）',
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () => synth(`${RESET_INLINE}\n          ...payload,`),
    },
    {
      // 与 F 互为对照：展开在**前**、五项在后 → JS 保证后者胜 → 静态可判定为安全 → 必须放行。
      // 若这条被判失败，说明位置判定退化成了"一律拒绝展开"，
      // 那种门禁会因提示一条走不通的路而逼人绕过它。
      name: 'F″ 展开在前、五项重置在后（后者覆盖前者 → 安全，必须放行）',
      expect: 'pass',
      wantBlocks: 1,
      src: () => synth(`          ...payload,\n${RESET_INLINE}`),
    },
    {
      name: 'F‴ upsert 实参层 update 在展开之前（展开可整体替换 update）',
      expect: 'throw',
      errRe: /未找到 `update` 键/,
      src: () => synth(RESET_INLINE).replace('    })', '      ...args,\n    })'),
    },
    {
      name: "G 计算属性名 ['update']:（键名运行时才定）",
      expect: 'throw',
      errRe: /计算属性名/,
      src: () => synth(RESET_INLINE).replace('update: {', "['upd' + 'ate']: {"),
    },
    {
      name: 'G′ 重复 update 键（JS 后者覆盖前者）',
      expect: 'throw',
      errRe: /重复键 `update`/,
      src: () => synth(RESET_INLINE, { argExtra: '\n      update: {},' }),
    },
    {
      name: 'H 值是表达式而非字面量（rejectReason: nullFlag）',
      expect: 'fail',
      caseSite: CASE_SITE(),
      // 只有 rejectReason 该失败：其余四项写法正确。若这里报出多项，
      // 说明正向判据被改宽/改窄，波及了不该动的字段。
      wantMissing: ['rejectReason:null'],
      src: () => synth(RESET_INLINE.replace('rejectReason: null,', 'rejectReason: nullFlag,')),
    },
    {
      // 本用例专测「值内容比对」：五项键全在、类型也对，只是值写错。
      // 若把 isStr 放宽成「是字符串字面量就算」，只有这条会亮。
      name: "H″ 键全在但值写错（reviewStatus:'approved' / publishStatus:'published'）",
      expect: 'fail',
      caseSite: CASE_SITE(),
      // 关键：恰好这两项失败。若把 isStr 放宽成「是字符串字面量就算」，
      // 这条会变成 0 项失败 → 用例转绿，是本用例唯一的检出信号。
      wantMissing: ["reviewStatus:'pending'", "publishStatus:'draft'"],
      src: () =>
        synth(
          RESET_INLINE.replace("'pending',", "'approved',").replace("'draft',", "'published',")
        ),
    },
    {
      name: "H′ 字段名前缀伪装（xreviewStatus: 'pending' 不算)",
      expect: 'fail',
      caseSite: CASE_SITE(),
      src: () => synth(RESET_INLINE.replace('reviewStatus:', 'xreviewStatus:')),
    },
    {
      name: "I as const 包装应放行（reviewStatus: 'pending' as const）",
      expect: 'pass',
      wantBlocks: 1,
      src: () => synth(RESET_INLINE.replace("'pending',", "'pending' as const,")),
    },
    {
      name: 'J 语法错误必须 fail-closed（AST 不可信）',
      expect: 'throw',
      errRe: /语法错误/,
      src: () => synth(RESET_INLINE) + '\nexport class Broken { async x( {\n',
    },
    {
      // codex 复审指出的最后一处静默跳过：只认 `a.b.upsert(...)`，
      // 于是 `prisma[key].upsert({...})` 既不被分析、也不进库存集合 → 完全隐形。
      name: 'L 无法静态归属的 upsert（prisma[key].upsert）必须 fail-closed',
      expect: 'throw',
      errRe: /无法静态归属的 `upsert` 调用/,
      src: () =>
        synth(RESET_INLINE).replace('this.prisma.job.upsert', 'this.prisma[modelKey].upsert'),
    },
    {
      // 反向：`['job']` / `['upsert']` 是可静态求值的，必须照常分析而不是漏过
      name: "L′ 字符串下标形态（prisma['job']['upsert']）须照常分析并判失败",
      expect: 'fail',
      caseSite: `importJobs() · job.upsert @L`,
      src: () =>
        synth('          title: dto.title,').replace(
          'this.prisma.job.upsert',
          "this.prisma['job']['upsert']"
        ),
    },
    {
      name: 'K 自动同步支出现无条件重置（反向断言）',
      expect: 'reverse-fail',
      caseSite: CASE_SITE('upsertJobs'),
      wantMissing: ['reviewStatus', 'publishStatus'],
      src: () => synth(RESET_INLINE, { fn: 'upsertJobs' }),
    },
    // K′/K″/K‴：反向断言的三种实测绕过。原实现用 isStr('pending') 判定，
    // 下面三种写法都不是 StringLiteral 节点 → 被判「重置缺席」→ 静默放行，
    // 即「冻结 P0 缺口」的标记形同虚设。三种均已在真实 job-sync.service.ts 上
    // 复现过门禁 exit 0，故必须各留一条常驻用例。
    {
      name: 'K′ 反向断言：identifier 形态（reviewStatus: PENDING）',
      expect: 'reverse-fail',
      caseSite: CASE_SITE('upsertJobs'),
      wantMissing: ['reviewStatus'],
      src: () =>
        synth('          reviewStatus: PENDING_STATUS,', { fn: 'upsertJobs' }),
    },
    {
      name: 'K″ 反向断言：shorthand 形态（reviewStatus,）',
      expect: 'reverse-fail',
      caseSite: CASE_SITE('upsertJobs'),
      wantMissing: ['reviewStatus'],
      src: () => synth('          reviewStatus,', { fn: 'upsertJobs' }),
    },
    {
      name: 'K‴ 反向断言：模板串形态（reviewStatus: `pending`）',
      expect: 'reverse-fail',
      caseSite: CASE_SITE('upsertJobs'),
      wantMissing: ['reviewStatus'],
      src: () => synth('          reviewStatus: `pending`,', { fn: 'upsertJobs' }),
    },
    {
      // 反向断言必须**无视位置**：展开之前的写入若展开对象不含该键就真的生效，
      // 仍是潜在的无条件重置。这条守住 hasKey 不被误改成 trustedValue。
      //
      // 两个键都写、并用 wantMissing 钉住键集合，是刻意的：判据是
      // `if (!hasR && !hasP)`，只写一个键时把另一个键的 hasKey 改成 trustedValue
      // 仍会因剩下那个键报失败 → verdict 照样是 reverse-fail → 变异逃逸（已实测）。
      // 钉住集合后，任一键被降级都会让 failures 少一项 → 用例转红。
      name: 'K⁗ 反向断言：重置在展开之前也必须报失败（不可按"可能被覆写"放过）',
      expect: 'reverse-fail',
      caseSite: CASE_SITE('upsertJobs'),
      wantMissing: ['reviewStatus', 'publishStatus'],
      src: () =>
        synth(
          `          reviewStatus: 'pending',\n          publishStatus: 'draft',\n          ...syncData,`,
          { fn: 'upsertJobs' }
        ),
    },
  ]

  let leaked = 0
  // ⚠️ 必须统计「实际跑完的用例数」，不能用 cases.length。
  // 退化实测：把循环改成 `for (const c of [])` 时 cases.length 仍是 22、leaked 仍是 0
  // → 与 EXPECTED_SELFTEST_CASES 相符 → 22 条断言全部消失却 exit 0。
  // 这与 codex 指出的 `total: 0` 属同一类 fail-open，只是方向相反：
  // 一个谎报少、一个谎报多，都必须用「跑完才计数」来锁死。
  let executed = 0
  for (const c of cases) {
    let verdict
    let blocks = null
    let result = null
    try {
      blocks = extractBlocks('/synthetic/fixture.ts', c.src())
      if (c.expect === 'reverse-fail') {
        // 必须走真实的 checkMustNotReset，不能在自测里重新实现判定逻辑
        result = withSilencedOutput(() => checkMustNotReset(blocks, 'selftest'))
        verdict = result.fail > 0 ? 'reverse-fail' : 'pass'
      } else {
        result = withSilencedOutput(() => checkMustReset(blocks, 'selftest'))
        verdict = result.fail > 0 ? 'fail' : 'pass'
      }
    } catch (err) {
      verdict = 'throw'
      c._err = err.message
    }

    let ok = verdict === c.expect
    let why = ''
    if (ok && c.expect === 'throw' && c.errRe && !c.errRe.test(c._err)) {
      ok = false
      why = `（抛错原因不符：${String(c._err).split('\n')[0]}）`
    }
    if (ok && c.expect === 'pass' && blocks && blocks.length !== c.wantBlocks) {
      // 防「解析退化成返回空数组 → 没有失败 → 也算 pass」
      ok = false
      why = `（应提取 ${c.wantBlocks} 个块，实际 ${blocks.length}）`
    }
    // 防「因无关块失败而假绿」：失败的必须是本用例那一处，而且缺的必须是预期字段。
    // 只看 blocks 里「存在该 site」是不够的 —— 存在不等于就是它失败的。
    // 必须读 checker 返回的结构化 failures，才能确认失败归属与缺失字段。
    if (ok && (c.expect === 'fail' || c.expect === 'reverse-fail') && result) {
      const sites = result.failures.map((f) => f.site)
      if (sites.length === 0) {
        ok = false
        why = '（判为失败但 failures 为空 —— checker 未回传失败详情）'
      } else if (c.caseSite && !sites.every((s) => s.startsWith(c.caseSite))) {
        ok = false
        why = `（失败 site 为 ${sites.join(',')}，应全部属于 ${c.caseSite}）`
      } else if (c.wantMissing) {
        const got = result.failures
          .flatMap((f) => f.missing ?? f.keys ?? [])
          .sort()
          .join(',')
        const want = [...c.wantMissing].sort().join(',')
        if (got !== want) {
          ok = false
          why = `（失败字段为 [${got}]，期望 [${want}]）`
        }
      }
    }

    if (ok) {
      const how = { throw: '被正确 fail-closed 抛错', pass: '被正确放行（无假阳性）', fail: '被正确判为失败', 'reverse-fail': '反向断言正确报失败' }
      console.log(`  ✅  自测 ${c.name} · ${how[c.expect]}`)
    } else {
      console.error(`  ❌  自测 ${c.name} · 期望 ${c.expect}，实际 ${verdict}${why} —— 门禁已退化，修好后再提交`)
      leaked++
    }
    executed++ // 放在循环末尾：只有真正走完判定才计数
  }
  return { leaked, total: executed }
}

/** 自测用例会触发大量 ✅/❌ 输出，这里静音以免污染真实断言的报告 */
function withSilencedOutput(fn) {
  const log = console.log,
    err = console.error
  console.log = () => {}
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.log = log
    console.error = err
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 主逻辑
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n🔍  verify-import-review-reset — Partner/Excel 强制重审验证（TypeScript AST）\n')

let totalPass = 0,
  totalFail = 0

/**
 * fail-closed 库存核对：站点集合与 EXPECTED_SITES 不一致即失败。
 * 缺失 = 写入点被删/改名/换模型/改写成非 upsert 形式（门禁会失去覆盖）；
 * 多出 = 新增了未登记的写入点，必须显式登记后才放行。
 * 比单纯比数量强：改模型或改函数名时数量不变，但集合会变。
 */
function runFile(fileLabel, filepath, checker, checkerLabel) {
  console.log(`── ${fileLabel}`)
  const expected = EXPECTED_SITES[fileLabel] ?? []
  let blocks
  try {
    blocks = extractBlocksFromFile(filepath)
  } catch (err) {
    console.error(`  ❌  无法解析 ${fileLabel}：${err.message}`)
    totalFail++
    return
  }
  const actual = blocks.map((b) => b.key).sort()
  const want = [...expected].sort()
  if (actual.length !== want.length || actual.some((k, i) => k !== want[i])) {
    const missing = want.filter((k) => !actual.includes(k))
    const extra = actual.filter((k) => !want.includes(k))
    console.error(
      `  ❌  ${fileLabel} · upsert 写入点集合与登记值不符。\n` +
        `      登记：${want.join(', ') || '(空)'}\n` +
        `      实际：${actual.join(', ') || '(空)'}\n` +
        (missing.length ? `      缺失：${missing.join(', ')} —— 写入点被删除/改名/换模型，门禁失去覆盖\n` : '') +
        (extra.length ? `      多出：${extra.join(', ')} —— 新增未登记写入点\n` : '') +
        '      两种情况都必须人工确认后同步更新脚本顶部的 EXPECTED_SITES。'
    )
    totalFail++
    if (blocks.length === 0) return
  }
  const r = checker(blocks, checkerLabel)
  totalPass += r.pass
  totalFail += r.fail
}

// ① Partner 手动 API 导入 / Webhook / 招聘会导入
runFile('jobs-partner.service.ts', resolve(SRC, 'jobs-partner.service.ts'), checkMustReset, 'partner')

// ② Excel 确认导入
console.log('')
runFile('jobs-excel.service.ts', resolve(SRC, 'jobs-excel.service.ts'), checkMustReset, 'excel')

// ③ 反向断言：API 自动拉取不得出现【无条件】重置（已登记 P0 缺口冻结，见文件头 ⚠️）
console.log('')
runFile(
  'job-sync.service.ts',
  resolve(__dir, '../src/job-sync/job-sync.service.ts'),
  checkMustNotReset,
  'sync'
)

// ④ 门禁自测：已知绕过形态必须全被拦住，且不得产生假阳性（全内存，不写盘）
console.log('\n── 门禁自测（对抗用例，全内存合成夹具，不写盘）')
const selfResult = selfTest()
// 返回值形态守卫。三条都是实测出来的 fail-open 路径，不是防御性冗余：
//   · 非整数（如 `return 1` 解构出 undefined）→ NaN → `NaN > 0` 为假 → 真实失败被抹掉；
//   · 负数（`leaked: -1`）→ `totalFail += -1` 会**抵消**真实站点的失败，
//     实测：植入一处真实缺字段后仍输出「总计 24 项 ✅ 24 PASS 0 FAIL」并 exit 0；
//   · total=0（用例数组被清空）→ 20 项断言静默消失，实测输出「总计 7 项 ✅ 7 PASS」exit 0。
// 故不只校验类型，还要校验区间与写死的期望条数。
if (
  !selfResult ||
  typeof selfResult !== 'object' ||
  !Number.isInteger(selfResult.leaked) ||
  !Number.isInteger(selfResult.total)
) {
  console.error('  ❌  selfTest() 返回值形态非法，无法核算自测结果 → 按失败处理')
  totalFail++
} else if (selfResult.leaked < 0 || selfResult.leaked > selfResult.total) {
  console.error(
    `  ❌  selfTest() 计数越界（leaked=${selfResult.leaked} total=${selfResult.total}）——\n` +
      '      负数会抵消真实站点的失败数，须按失败处理。'
  )
  totalFail++
} else if (selfResult.total !== EXPECTED_SELFTEST_CASES) {
  console.error(
    `  ❌  自测用例数为 ${selfResult.total}，登记值为 ${EXPECTED_SELFTEST_CASES}。\n` +
      '      用例被删除或新增都会走到这里 —— 新增用例请同步更新 EXPECTED_SELFTEST_CASES，\n' +
      '      不要靠"总计"数字自证（用例数组被清空时总计会静默变小且仍 exit 0）。'
  )
  totalFail++
} else {
  totalFail += selfResult.leaked
  totalPass += selfResult.total - selfResult.leaked
}

// ──────────────────────────────────────────────────────────────────────────────
// 摘要
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
if (
  !Number.isInteger(totalPass) ||
  !Number.isInteger(totalFail) ||
  totalPass < 0 ||
  totalFail < 0
) {
  // 计数被污染时绝不宣称通过
  console.error(`⛔  计数异常（pass=${totalPass} fail=${totalFail}）——按失败处理\n`)
  process.exit(1)
}
// 总项数必须等于登记值：任何"断言静默消失"都在这里现形，
// 不能只靠 totalFail>0 判定（少跑断言不会产生 fail，只会让总数变小）。
if (totalPass + totalFail !== EXPECTED_TOTAL) {
  console.error(
    `⛔  汇总检查项数为 ${totalPass + totalFail}，登记值为 ${EXPECTED_TOTAL} —— 有断言未执行或被跳过，按失败处理。\n`
  )
  process.exit(1)
}
console.log(
  `总计  ${totalPass + totalFail} 项  ✅ ${totalPass} PASS  ${totalFail > 0 ? '❌' : ''} ${totalFail} FAIL`
)
if (totalFail > 0) {
  console.error('\n⛔  verify-import-review-reset FAILED — Partner/Excel 导入存在审核绕过风险\n')
  process.exit(1)
} else {
  console.log('\n✅  verify-import-review-reset ALL PASS\n')
}
