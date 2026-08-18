// ============================================================================
// 项目图谱 · 渲染
//
// 分册输出，不出巨型单文件：一份几万行的 markdown 和没有图谱是一个效果。
// 每册回答一个具体问题，README 只做入口和规模概览。
//
// mermaid 图一律做聚合（按路由首段、按关系度数取 Top N），不画全量节点 ——
// 136 个路由节点的图人是读不了的，读不了就等于没画。
// ============================================================================

import { groupByRisk } from './orphans.mjs'

const BAR = '─'.repeat(70)

function table(headers, rows) {
  if (rows.length === 0) return '_（空）_\n'
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}\n`
}

function code(value) {
  return value ? `\`${value}\`` : '—'
}

function mermaidId(value) {
  return value.replace(/[^\w]/g, '_').replace(/^(\d)/, 'n$1')
}

const AUTOGEN_BANNER = [
  '<!-- 本文件由 scripts/generate-project-graph.mjs 自动生成，请勿手改。 -->',
  '<!-- 手改会在下次 `node scripts/generate-project-graph.mjs` 时被覆盖。 -->',
  '',
].join('\n')

// ---------------------------------------------------------------------------

export function renderReadme(graph) {
  const gateStats = {
    total: graph.gates.length,
    helper: graph.gates.filter((g) => g.helper).length,
    wired: graph.gates.filter((g) => g.wired).length,
    inCi: graph.gates.filter((g) => g.inCi).length,
    unwired: graph.gates.filter((g) => !g.wired && !g.helper).length,
  }
  const orphanCounts = Object.fromEntries(
    Object.entries(groupByRisk(graph.orphans.entries)).map(([risk, list]) => [risk, list.length]),
  )

  const appRows = Object.entries(graph.apps).map(([key, app]) => [
    key,
    code(app.root),
    String(app.routes.length),
    String(app.sourceFileCount),
    String(app.reachableFileCount),
  ])

  return `${AUTOGEN_BANNER}# 项目图谱

> **这份文件是从代码算出来的，不是写出来的。**
>
> 每一条边都来自解析源码：路由表、import 图、NestJS 装饰器、Prisma schema、
> 门禁脚本里的路径断言。没有任何一条是人手抄的结论，因此它不会像手写文档那样
> 慢慢和代码脱节 —— 代码变了，重跑一次，diff 就是这段时间的真实变化。
>
> 重新生成：\`node scripts/generate-project-graph.mjs\`
> 只检查不写盘：\`node scripts/generate-project-graph.mjs --check\`

## 先看这里：图谱主要是拿来「查」的

三个每天都会遇到、翻文档翻不出来的问题，直接命令行问：

\`\`\`bash
# 1. 我改了这个文件，会红哪条门禁？（今天多次踩到）
node scripts/project-graph-query.mjs file apps/kiosk/src/pages/print/PrintConfirmPage.tsx

# 2. 这个路由背后到底调了哪些接口、落到哪些表？
node scripts/project-graph-query.mjs route /print/confirm

# 3. 这个端点是谁在实现、动了哪些 Prisma 模型？
node scripts/project-graph-query.mjs endpoint /api/v1/print-jobs

# 4. 这个 Prisma 模型被哪些代码读写？
node scripts/project-graph-query.mjs model PrintTask
\`\`\`

## 规模

${table(['应用', '目录', '路由数', '源文件', '入口可达'], appRows)}
${table(
  ['维度', '数量'],
  [
    ['HTTP 端点（services/api）', String(graph.api.endpointCount)],
    ['Prisma 模型', String(graph.dataModel.modelCount)],
    ['门禁脚本文件', String(gateStats.total)],
    ['├ 其中辅助库（被别的门禁 import）', String(gateStats.helper)],
    ['├ 已在 package.json 里有脚本名', String(gateStats.wired)],
    ['├ 在 CI 执行闭包里', String(gateStats.inCi)],
    ['└ **无脚本名，从未被执行**', String(gateStats.unwired)],
    ['被至少一条门禁断言的文件', String(Object.keys(graph.fileToGates).length)],
    ['孤儿候选 · protected（不得删）', String(orphanCounts.protected ?? 0)],
    ['孤儿候选 · high（仍被 CI/门禁引用）', String(orphanCounts.high ?? 0)],
    ['孤儿候选 · medium（仅文档提及）', String(orphanCounts.medium ?? 0)],
    ['孤儿候选 · low（全仓零提及）', String(orphanCounts.low ?? 0)],
  ],
)}
## 分册

| 文件 | 回答什么问题 |
| --- | --- |
| [routes.md](routes.md) | 三端每个路由对应哪个页面文件、调哪些端点、用哪些样式 |
| [api.md](api.md) | 每个 HTTP 端点由哪个 controller 方法实现、经过哪些 service、落到哪些 Prisma 模型 |
| [data-model.md](data-model.md) | Prisma 模型之间的关系，以及每个模型被哪些代码读写 |
| [gates.md](gates.md) | 每条 verify 门禁断言哪些文件；以及**文件 → 门禁**反向索引 |
| [orphans.md](orphans.md) | 零引用候选清单，按风险分级。**只出清单，不删任何东西** |
| [graph.json](graph.json) | 上面全部数据的机器可读版本，稳定排序，可直接 diff |

## 总体结构

\`\`\`mermaid
flowchart LR
  kiosk["apps/kiosk<br/>一体机前台<br/>${graph.apps.kiosk?.routes.length ?? 0} 路由"]
  admin["apps/admin<br/>管理员后台<br/>${graph.apps.admin?.routes.length ?? 0} 路由"]
  partner["apps/partner<br/>合作机构后台<br/>${graph.apps.partner?.routes.length ?? 0} 路由"]
  api["services/api<br/>NestJS<br/>${graph.api.endpointCount} 端点"]
  db[("Prisma<br/>${graph.dataModel.modelCount} 模型")]
  gates{{"verify 门禁<br/>${gateStats.total} 个脚本"}}

  kiosk -->|"/api/v1"| api
  admin -->|"/api/v1"| api
  partner -->|"/api/v1"| api
  api --> db
  gates -.->|"断言 ${Object.keys(graph.fileToGates).length} 个文件"| kiosk
  gates -.-> admin
  gates -.-> partner
  gates -.-> api
\`\`\`

${BAR}

## 这份图谱不保证什么（读之前先知道边界）

写在最前面，是因为**一份被过度信任的自动产物，比一份没人读的文档更危险**。

1. **只解析静态结构。** 运行时才决定的跳转（\`navigate(变量)\`）、条件挂载的路由、
   反射式的 service 调用，图谱看不见。
2. **端点归属是 import 可达性，不是实际调用。** 页面 import 到了某个 service 模块，
   就算它「可能调用」该模块的全部端点；实际是否在某个分支里调用，图谱不判断。
   宁可多一条边，也不要漏 —— 但读的时候要知道这是上界不是精确值。
3. **后端 service → 模型走的是受限闭包**（只沿 \`.service.ts\` 和同目录文件，深度 2）。
   跨目录的间接数据访问会漏。放开成全量闭包的结果是几乎每个端点都连上全部
   ${graph.dataModel.modelCount} 个模型，那样的图没有分辨力。
4. **孤儿清单是候选，不是删除许可。** 判定用的是 CLAUDE.md §8 的五条证据；
   \`protected\` 名单里的目录即使五条全中也不得删除（原因见 orphans.md）。
5. **\`apps/miniapp\` 不在解析范围内**，只在门禁清单里只读引用它的 package.json 脚本名。
6. **门禁的「在 CI 里」是尽力而为的推断**，权威仍是 \`scripts/verify-ci-gate-coverage.mjs\`。
7. **自动产物会污染它自己的输入 —— 这不是假设，是本工具开发时真踩到的。**
   图谱产物列举了仓库里几乎每一个路径。第一版把 \`docs/graph/\` 也算进「提及索引」，
   于是「全仓没有任何其它文件提到它」这条判据对所有文件恒假：孤儿候选从 161 条
   塌到 45 条，\`protected\` 一条不剩 —— 而且**塌下来的那一版看起来完全正常**，
   没有报错、没有警告，只是安静地少报了 116 条。现已排除自身产物（见
   \`scripts/project-graph/orphans.mjs\` 的 \`GRAPH_OUTPUT_DIR\`），但同类盲区必然还有。
   这就是为什么本节排在最前面：**一份被过度信任的自动产物，比一份没人读的文档更危险。**

发现图谱和代码对不上，**以代码为准，并且这是脚本的 bug** —— 请修脚本，不要手改产物。
`
}

// ---------------------------------------------------------------------------

export function renderRoutes(graph) {
  let out = `${AUTOGEN_BANNER}# 路由图谱

三端每个路由 → 页面组件文件 → 该页面 import 闭包内触达的 API 端点。

「端点」是 **import 可达性上界**：页面能通过 import 链走到那个 service 模块，
不代表每次渲染都会调用它。用它回答「改这个接口会影响哪些页面」是可靠的；
用它回答「这个页面一定会发这些请求」不可靠。
`

  for (const [key, app] of Object.entries(graph.apps)) {
    out += `\n${BAR}\n\n## ${key}（${app.root}）\n\n`
    out += `路由表：\`${app.router}\`　入口：\`${app.entry}\`\n\n`

    // 按首段聚合的 mermaid 概览
    const groups = new Map()
    for (const route of app.routes) {
      const segment = route.path.split('/')[1] || '(root)'
      if (!groups.has(segment)) groups.set(segment, [])
      groups.get(segment).push(route)
    }
    const groupRows = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))

    out += '```mermaid\nflowchart LR\n'
    out += `  app["${key}"]\n`
    for (const [segment, routes] of groupRows) {
      const endpointCount = new Set(routes.flatMap((r) => r.endpoints)).size
      out += `  app --> ${mermaidId(segment)}["/${segment === '(root)' ? '' : segment}<br/>${routes.length} 页 · ${endpointCount} 端点"]\n`
    }
    out += '```\n\n'

    out += table(
      ['路由', '页面组件', '页面文件', '端点数', '样式'],
      app.routes.map((route) => [
        code(route.path),
        route.component ?? '—',
        route.file ? code(route.file) : '— _(重定向)_',
        String(route.endpoints.length),
        route.styles.length > 0 ? String(route.styles.length) : '—',
      ]),
    )

    const withEndpoints = app.routes.filter((route) => route.endpoints.length > 0)
    if (withEndpoints.length > 0) {
      out += `\n<details>\n<summary>展开：每个路由触达的端点（${withEndpoints.length} 个路由）</summary>\n\n`
      for (const route of withEndpoints) {
        out += `**\`${route.path}\`** → ${route.endpoints.map((e) => `\`${e}\``).join('、')}\n\n`
      }
      out += '</details>\n'
    }
  }

  return out
}

// ---------------------------------------------------------------------------

export function renderApi(graph) {
  const byController = new Map()
  for (const endpoint of graph.api.endpoints) {
    if (!byController.has(endpoint.controller)) byController.set(endpoint.controller, [])
    byController.get(endpoint.controller).push(endpoint)
  }

  let out = `${AUTOGEN_BANNER}# API 端点图谱

\`${graph.api.endpointCount}\` 个端点，全局前缀 \`${graph.api.globalPrefix}\`（\`services/api/src/main.ts\` 的 \`setGlobalPrefix\`）。

端点来自 \`@Controller\` / \`@Get\` / \`@Post\` 等装饰器的**剥注释后**解析。
本仓库多数 controller 顶部有一整块历史路由清单注释；那些注释不参与本表，
所以**本表和注释不一致时，以本表为准**（本表反映装饰器，注释可能已过期）。

模型列 = 该端点调用的 service 在受限闭包内触达的 Prisma 模型（见 README 的边界说明）。

`

  for (const [controller, endpoints] of [...byController.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    out += `\n## \`${controller}\`\n\n`
    out += table(
      ['方法', '路径', 'handler', '角色', 'Service', 'Prisma 模型'],
      endpoints.map((endpoint) => [
        endpoint.method,
        code(endpoint.path),
        endpoint.handler,
        endpoint.roles.length > 0 ? endpoint.roles.join('/') : '—',
        endpoint.services.length > 0 ? endpoint.services.join('<br/>') : '—',
        endpoint.models.length > 0 ? endpoint.models.join('<br/>') : '—',
      ]),
    )
  }

  return out
}

// ---------------------------------------------------------------------------

export function renderDataModel(graph) {
  const models = graph.dataModel.models
  const topConnected = [...models]
    .sort((a, b) => b.relations.length - a.relations.length || (a.name < b.name ? -1 : 1))
    .slice(0, 18)
  const topNames = new Set(topConnected.map((m) => m.name))

  let out = `${AUTOGEN_BANNER}# 数据模型图谱

\`${graph.dataModel.modelCount}\` 个 Prisma 模型，来源 \`${graph.dataModel.schema}\`。

下图只画**关系度数最高的 ${topConnected.length} 个模型**：全量 ${graph.dataModel.modelCount} 个节点的
ER 图人是读不了的。全量关系见下方表格和 \`graph.json\`。

\`\`\`mermaid
flowchart TD
`
  for (const model of topConnected) {
    out += `  ${mermaidId(model.name)}["${model.name}<br/><small>${model.fieldCount} 字段</small>"]\n`
  }
  const drawn = new Set()
  for (const model of topConnected) {
    for (const target of model.relations) {
      if (!topNames.has(target)) continue
      const key = [model.name, target].sort().join('::')
      if (drawn.has(key)) continue
      drawn.add(key)
      out += `  ${mermaidId(model.name)} --- ${mermaidId(target)}\n`
    }
  }
  out += '```\n\n'

  out += '## 全部模型\n\n'
  out += table(
    ['模型', '字段数', '关联模型', '被哪些文件读写'],
    models.map((model) => [
      `**${model.name}**`,
      String(model.fieldCount),
      model.relations.length > 0 ? model.relations.join('、') : '—',
      model.usedBy.length > 0
        ? `${model.usedBy.length} 个文件<br/>${model.usedBy.slice(0, 3).map((f) => `\`${f.replace('services/api/src/', '')}\``).join('<br/>')}${model.usedBy.length > 3 ? '<br/>…' : ''}`
        : '**无代码读写**',
    ]),
  )

  const unused = models.filter((model) => model.usedBy.length === 0)
  if (unused.length > 0) {
    out += `\n## 没有任何代码读写的模型（${unused.length}）\n\n`
    out += '> 注意：这里的判定只看 \\`this.prisma.<model>.<op>\\` 形式的调用。\n'
    out += '> 通过关系字段级联读写、raw SQL 或迁移脚本访问的模型不会被计入，**不能据此删表**。\n\n'
    out += unused.map((model) => `- \`${model.name}\``).join('\n')
    out += '\n'
  }

  return out
}

// ---------------------------------------------------------------------------

export function renderGates(graph) {
  const unwired = graph.gates.filter((g) => !g.wired && !g.helper)
  const notInCi = graph.gates.filter((g) => g.wired && !g.inCi)
  const missingPaths = graph.gates.filter((g) => g.asserts.missing.length > 0)

  let out = `${AUTOGEN_BANNER}# 门禁图谱

## 为什么要有这一册

「门禁存在」「门禁有名字」「门禁在 CI 里跑」是三件不同的事，任何一层都可能断：

| 层 | 断了会怎样 | 谁在守 |
| --- | --- | --- |
| 脚本文件存在 → package.json 里有脚本名 | 门禁写完就从没跑过，**零信号** | 本册（下方「无脚本名」表） |
| 有脚本名 → 进 CI 执行闭包 | 本地能跑、CI 不跑 | \`scripts/verify-ci-gate-coverage.mjs\`（权威） |
| 断言的路径 → 文件真实存在 | 断言恒真，门禁形同虚设 | 本册（下方「断言路径不存在」表） |

\`verify:ci-gate-coverage\` 枚举的是 package.json 里**已声明**的脚本名。
一个 \`.mjs\` 文件如果压根没被起过名字，它连枚举入口都进不去 —— 那一层只有本册能看见。

${BAR}

## 无脚本名：文件存在，但从未被执行（${unwired.length}）

判定：文件在 \`scripts/\` 下、不是被别的门禁 import 的辅助库、且没有任何
workspace 包的 \`package.json\` scripts 指向它。

${table(
  ['门禁脚本', '断言文件数'],
  unwired.map((gate) => [code(gate.file), String(gate.asserts.files.length)]),
)}
${BAR}

## 有脚本名但不在 CI 执行闭包里（${notInCi.length}）

这一栏是**尽力而为的推断**，权威是 \`verify:ci-gate-coverage\` 加
\`scripts/ci-gate-exemptions.json\`。已在豁免清单里登记的（需要真实凭证 / 真机 /
本地服务）出现在这里是正常的。

${table(
  ['门禁脚本', '脚本名'],
  notInCi.map((gate) => [code(gate.file), gate.scriptNames.map((n) => `\`${n}\``).join('<br/>')]),
)}
${BAR}

## 断言了不存在的路径（${missingPaths.length}）

门禁里写着某个仓库路径，但该路径在 git 里不存在。可能是文件被移动/删除后门禁
没跟着改 —— 这类断言往往已经恒真或恒假，需要人确认。

${table(
  ['门禁脚本', '找不到的路径'],
  missingPaths.map((gate) => [
    code(gate.file),
    gate.asserts.missing.map((p) => `\`${p}\``).join('<br/>'),
  ]),
)}
${BAR}

## 反向索引：文件 → 断言它的门禁

**改文件前查这里**，就知道会红哪条门禁。共 ${Object.keys(graph.fileToGates).length} 个文件被至少一条门禁断言。

命令行版本（推荐，支持前缀匹配）：
\`\`\`bash
node scripts/project-graph-query.mjs file <路径>
\`\`\`

`

  const byDir = new Map()
  for (const [file, gates] of Object.entries(graph.fileToGates)) {
    const dir = file.split('/').slice(0, 3).join('/')
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push([file, gates])
  }

  for (const [dir, entries] of [...byDir.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out += `\n<details>\n<summary><code>${dir}/</code> — ${entries.length} 个文件</summary>\n\n`
    out += table(
      ['文件', '被这些门禁断言'],
      entries.map(([file, gates]) => [
        code(file),
        gates.map((g) => `\`${g.split('/').pop()}\``).join('<br/>'),
      ]),
    )
    out += '\n</details>\n'
  }

  return out
}

// ---------------------------------------------------------------------------

const RISK_TITLE = {
  protected: 'protected — 硬名单，即使零引用也不得删除',
  high: 'high — 仍被 CI / 门禁 / 包脚本引用',
  medium: 'medium — 只被文档或其它文件提及',
  low: 'low — 全仓零提及',
}

const KIND_LABEL = {
  component: '页面/组件',
  style: '样式',
  gate: '门禁脚本',
  doc: '文档',
  test: '测试',
}

/**
 * 自相矛盾的门禁对。
 *
 * 单独成节、排在孤儿清单之前，因为它不是同一类问题：孤儿是「没人用了」，
 * 矛盾是「两个人各写了一条，互相不知道对方存在，而且只有一条在跑」。
 * 前者是代码信号，后者是流程信号 —— 混在一起会让后者被当成又一条待删项。
 */
function renderContradictions(graph) {
  const conflicts = graph.gateContradictions ?? []
  if (conflicts.length === 0) return ''

  let out = `\n${BAR}\n\n## ⚠ 自相矛盾的门禁（${conflicts.length}）\n\n`
  out += '同一个路径，一条门禁断言它**必须存在**，另一条断言它**必须不存在**。\n\n'
  out += '**这不只是「该删一条」。** 它说明这两条门禁的作者互相不知道对方存在——\n'
  out += '是流程信号，不是代码信号。而且因为其中一条通常没接线，矛盾不会以 CI 红的\n'
  out += '形式暴露，只会在某天有人把它接上时才炸。\n\n'

  for (const conflict of conflicts) {
    out += `### \`${conflict.target}\`\n\n`
    out += `该路径在仓库中**不存在**。\n\n`
    out += table(
      ['断言方向', '门禁', '是否会执行'],
      [
        ...conflict.requiredBy.map((file) => {
          const gate = graph.gates.find((g) => g.file === file)
          return ['必须存在', code(file), gate?.wired ? (gate.inCi ? 'CI 会跑' : '有脚本名') : '**无脚本名，不会执行**']
        }),
        ...conflict.forbiddenBy.map((file) => {
          const gate = graph.gates.find((g) => g.file === file)
          return ['必须不存在', code(file), gate?.wired ? (gate.inCi ? 'CI 会跑' : '有脚本名') : '**无脚本名，不会执行**']
        }),
      ],
    )
    out += '\n'
  }

  return out
}

export function renderOrphans(graph) {
  const groups = groupByRisk(graph.orphans.entries)

  let out = `${AUTOGEN_BANNER}# 孤儿候选清单

> **本清单不删任何东西，也不构成删除许可。**
> 删除必须由产品负责人逐条确认后，另开 PR 执行。

## 判定标准

照 CLAUDE.md §8「删除旧代码必须有证据」的五条，全部满足才进 \`low\`：

1. 无路由引用 —— 不在任何 \`createBrowserRouter\` 路由表里
2. 无 import 引用 —— 不在应用入口 \`main.tsx\` 的 import 闭包内
3. 无测试 / verify 依赖 —— 没有门禁脚本断言它
4. 无当前文档声明 —— 全仓没有任何 \`.md\` 提到它
5. 不会被生产部署或硬件链路使用 —— 不在 \`.github/\`、\`scripts/\`、package.json 的引用里

任何一条不满足就降级到 \`medium\` / \`high\`，并写出是哪条引用拦住的。

## ⚠ 已知局限：本清单不看时间

**「零引用」对一份新写的文档，很可能只是「还没来得及被链接」，不是「过时」。**

检测器只问「有没有人提到它」，不问「它是什么时候写的」。一份昨天刚落地的
runbook、刚写完的评审结论、刚起草的方案，天然还没有人引用 —— 它会和三个月前
真正废弃的任务单一起出现在同一个桶里，而且看不出区别。

所以**拿这份清单批量删文档之前，先按修改时间过一遍**：

\`\`\`bash
# 列出清单里最近 14 天动过的文件，这些优先人工确认
git log --since="14 days ago" --name-only --pretty=format: -- docs/ | sort -u
\`\`\`

同样的道理也适用于代码：一个刚拆出来、还没接线的模块，和一个死了半年的模块，
在「零引用」这个判据下长得一模一样。**图谱能证明「现在没人用」，证明不了「以后
也不会用」** —— 后者只有人知道。

## 分级汇总

${table(
  ['风险', '含义', '数量'],
  ['protected', 'high', 'medium', 'low'].map((risk) => [
    `**${risk}**`,
    RISK_TITLE[risk].split(' — ')[1],
    String(groups[risk].length),
  ]),
)}
${renderContradictions(graph)}`

  for (const risk of ['low', 'medium', 'high', 'protected']) {
    const entries = groups[risk]
    out += `\n${BAR}\n\n## ${RISK_TITLE[risk]}（${entries.length}）\n\n`

    if (risk === 'low') {
      out += '五条证据全部满足。**仍需人确认**：脚本看不见运行时动态引用，也不知道\n'
      out += '某个文件是不是刻意保留的下一步入口。\n\n'
    }
    if (risk === 'protected') {
      out += '这些路径即使零引用也**不得删除**。它们的价值不在「被代码引用」，\n'
      out += '而在作为回归基线、目标设计或产权归属。\n\n'
    }

    const byKind = new Map()
    for (const entry of entries) {
      if (!byKind.has(entry.kind)) byKind.set(entry.kind, [])
      byKind.get(entry.kind).push(entry)
    }

    for (const [kind, list] of [...byKind.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out += `### ${KIND_LABEL[kind] ?? kind}（${list.length}）\n\n`
      out += table(
        ['路径', '判定依据'],
        list.map((entry) => [code(entry.file), `${entry.detail}<br/>→ ${entry.why}`]),
      )
      out += '\n'
    }
  }

  return out
}
