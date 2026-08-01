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

// 期望库存：数量变化即失败，避免"删掉一处 upsert 后剩余块仍全部通过"的漏网
const EXPECTED = {
  'jobs-partner.service.ts': 3, // importJobs / importJobsFromWebhook / importFairs
  'jobs-excel.service.ts': 2, // confirmExcelImport: tx.job + tx.jobFair
  'job-sync.service.ts': 2, // upsertJobs / upsertFairs（反向断言）
}

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

/** 剥掉不影响运行时值的包装：`as const` / `satisfies X` / `(expr)` */
function unwrap(node) {
  let n = node
  for (;;) {
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) n = n.expression
    else if (ts.isSatisfiesExpression?.(n)) n = n.expression
    else if (ts.isNonNullExpression(n)) n = n.expression
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
  for (const prop of objLit.properties) {
    if (ts.isSpreadAssignment(prop)) {
      throw new Error(
        `${where} 第一层出现展开运算符 \`...\`。\n` +
          '      展开对象可能把 reviewStatus/publishStatus 覆写回已审已发布，静态无法判定 → 按失败处理。\n' +
          '      请把重置五项写成字面量并放在展开之后，或改为不使用展开。'
      )
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
    map.set(key, ts.isPropertyAssignment(prop) ? unwrap(prop.initializer) : null)
  }
  return map
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
function upsertModelOf(call) {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return null
  if (callee.name.text !== 'upsert') return null
  const owner = callee.expression
  if (!ts.isPropertyAccessExpression(owner)) return null
  const model = owner.name.text
  return model === 'job' || model === 'jobFair' ? model : null
}

function extractBlocks(filepath, source) {
  const short = filepath.split('/').pop()
  const sf = parse(short, source)
  const blocks = []

  const visit = (node) => {
    const model = ts.isCallExpression(node) ? upsertModelOf(node) : null
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
      const updateNode = argProps.get('update')
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
  for (const b of blocks) {
    // 只认第一层字段：搬进嵌套子对象的重置对 Prisma 无效，不能算通过
    const missing = REQUIRED.filter((f) => !f.ok(b.props.get(f.key))).map((f) => f.label)
    if (missing.length === 0) {
      console.log(`  ✅  ${label} · ${b.site} · update 块含 pending+draft 退审 & 已清空审核元数据`)
      pass++
    } else {
      console.error(`  ❌  ${label} · ${b.site} · update 块缺少 ${missing.join(', ')}`)
      fail++
    }
  }
  return { pass, fail }
}

function checkMustNotReset(blocks, label) {
  let pass = 0,
    fail = 0
  for (const b of blocks) {
    // 反向断言同样只看第一层：嵌套里的字段对 Prisma 无效，不构成"无条件重置"
    const hasR = isStr('pending')(b.props.get('reviewStatus'))
    const hasP = isStr('draft')(b.props.get('publishStatus'))
    if (!hasR && !hasP) {
      console.log(
        `  ⚠️  ${label} · ${b.site} · 无条件重置缺席（符合断言）` +
          ' —— 注意这是【已登记 P0 缺口冻结态】，不代表当前实现无问题'
      )
      pass++
    } else {
      const unexpected = [hasR && "reviewStatus:'pending'", hasP && "publishStatus:'draft'"]
        .filter(Boolean)
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
  return { pass, fail }
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
      name: 'F update 第一层出现展开运算符',
      expect: 'throw',
      errRe: /展开运算符/,
      src: () => synth(`          ...payload,\n${RESET_INLINE}`),
    },
    {
      name: 'F′ upsert 实参第一层出现展开（可注入 update）',
      expect: 'throw',
      errRe: /展开运算符/,
      src: () => synth(RESET_INLINE, { argExtra: '\n      ...args,' }),
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
      src: () => synth(RESET_INLINE.replace('rejectReason: null,', 'rejectReason: nullFlag,')),
    },
    {
      // 本用例专测「值内容比对」：五项键全在、类型也对，只是值写错。
      // 若把 isStr 放宽成「是字符串字面量就算」，只有这条会亮。
      name: "H″ 键全在但值写错（reviewStatus:'approved' / publishStatus:'published'）",
      expect: 'fail',
      caseSite: CASE_SITE(),
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
      name: 'K 自动同步支出现无条件重置（反向断言）',
      expect: 'reverse-fail',
      src: () => synth(RESET_INLINE, { fn: 'upsertJobs' }),
    },
  ]

  let leaked = 0
  for (const c of cases) {
    let verdict
    let blocks = null
    try {
      blocks = extractBlocks('/synthetic/fixture.ts', c.src())
      if (c.expect === 'reverse-fail') {
        // 必须走真实的 checkMustNotReset，不能在自测里重新实现判定逻辑
        const r = withSilencedOutput(() => checkMustNotReset(blocks, 'selftest'))
        verdict = r.fail > 0 ? 'reverse-fail' : 'pass'
      } else {
        const r = withSilencedOutput(() => checkMustReset(blocks, 'selftest'))
        verdict = r.fail > 0 ? 'fail' : 'pass'
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
    if (ok && c.expect === 'fail' && c.caseSite && blocks) {
      // 防「因无关块失败而假绿」：失败的必须是本用例那一处
      const hit = blocks.some((b) => b.site.startsWith(c.caseSite))
      if (!hit) {
        ok = false
        why = `（失败块 site 不匹配 ${c.caseSite}）`
      }
    }

    if (ok) {
      const how = { throw: '被正确 fail-closed 抛错', pass: '被正确放行（无假阳性）', fail: '被正确判为失败', 'reverse-fail': '反向断言正确报失败' }
      console.log(`  ✅  自测 ${c.name} · ${how[c.expect]}`)
    } else {
      console.error(`  ❌  自测 ${c.name} · 期望 ${c.expect}，实际 ${verdict}${why} —— 门禁已退化，修好后再提交`)
      leaked++
    }
  }
  return { leaked, total: cases.length }
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
 * fail-closed 库存核对：块数与 EXPECTED 不一致即失败。
 * 少于预期 = 有 upsert 被删/改写成别的调用形式，剩余块全过也不能算通过；
 * 多于预期 = 新增了未登记的写入点，必须显式登记后才放行。
 */
function runFile(fileLabel, filepath, checker, checkerLabel) {
  console.log(`── ${fileLabel}`)
  const expected = EXPECTED[fileLabel]
  let blocks
  try {
    blocks = extractBlocksFromFile(filepath)
  } catch (err) {
    console.error(`  ❌  无法解析 ${fileLabel}：${err.message}`)
    totalFail++
    return
  }
  if (blocks.length !== expected) {
    console.error(
      `  ❌  ${fileLabel} · 提取到 ${blocks.length} 个 upsert update 块，登记值为 ${expected}。\n` +
        '      少于登记值 = 写入点被删除或改写成非 upsert 形式（门禁会失去覆盖），\n' +
        '      多于登记值 = 新增了未登记的导入写入点。\n' +
        '      两种情况都必须人工确认后同步更新脚本顶部的 EXPECTED。'
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
// 返回值形态守卫：任何非法返回都必须计为失败，不能让 NaN 把真实失败抹掉后 exit 0
if (
  !selfResult ||
  typeof selfResult !== 'object' ||
  !Number.isInteger(selfResult.leaked) ||
  !Number.isInteger(selfResult.total)
) {
  console.error('  ❌  selfTest() 返回值形态非法，无法核算自测结果 → 按失败处理')
  totalFail++
} else {
  totalFail += selfResult.leaked
  totalPass += selfResult.total - selfResult.leaked
}

// ──────────────────────────────────────────────────────────────────────────────
// 摘要
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
if (!Number.isInteger(totalPass) || !Number.isInteger(totalFail)) {
  // 防御性兜底：计数被污染时绝不宣称通过
  console.error(`⛔  计数异常（pass=${totalPass} fail=${totalFail}）——按失败处理\n`)
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
