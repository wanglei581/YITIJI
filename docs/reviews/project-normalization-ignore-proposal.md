# 项目规范化 T2：E 类本地工具状态 ignore 提案

> 生成时间：2026-06-20
> 分支：`codex/normalization-ignore-proposal`
> 范围：只输出 E 类本地工具状态处理提案，不修改 `.gitignore`，不删除、不移动、不归档主工作区文件。

## 结论

T2 不应直接改 `.gitignore`。当前应先把 E 类本地工具目录分成“可 ignore 的运行状态”“需要本地保留的工具壳”“需要先抽取的产品/设计草稿”“需要用户确认的个人或商业记忆”四类。

本轮建议路线：

1. 先保留现有主工作区文件，不删除、不移动。
2. 先抽取或确认 `.product-pm/prd/print-material-pack.md` 与 `.superpowers/brainstorm/**/content/*.html` 的价值。
3. 用户确认后，下一任务再写 `.gitignore`。
4. 即使未来写 ignore，也不能写裸 `.ccg/`，只能限定 `.ccg/commander/` 或其运行状态子目录。

## 当前事实

主工作区：`/Users/wanglei/AI求职打印服务终端`。

当前 `.gitignore` 尚未覆盖以下路径，`git check-ignore` 对这些路径无输出：

- `.ccg/commander/`
- `.product-pm/`
- `.workbuddy/`
- `.superpowers/`

目录体积：

| 路径 | 体积 | 当前判断 |
| --- | ---: | --- |
| `.superpowers/` | 12K | C/E 混合：含设计预览和运行状态 |
| `.ccg/commander/` | 16K | E 类：本地 Claude -> Codex 指挥桥 |
| `.workbuddy/` | 16K | E 类：个人/工具记忆 |
| `.product-pm/` | 36K | C/E 混合：产品工具工作区，含 PRD 草稿 |

敏感词扫描只命中：

- `.workbuddy/memory/MEMORY.md` 中的 `OCR` 文本。
- `.ccg/commander/README.md` 中的 `appSecret` 机制说明。

本轮没有证明存在真实生产密钥。后续抽取或入库前仍需逐文件人工复核。

## 逐目录处理矩阵

| 路径 | 内容 | 本轮处理 | 后续建议 | 禁止事项 |
| --- | --- | --- | --- | --- |
| `.ccg/commander/` | `README.md`、`codex-bridge.sh`、`inbox/`、`outbox/_heartbeat.json` | 不入库，仅记录提案 | 若继续使用桥，保留本地；若需沉淀协作规则，抽取摘要到 `docs/reviews/project-normalization-codex-claude-collaboration.md` 或独立协作文档；用户确认后 ignore 运行状态或整个子目录 | 禁止 ignore 裸 `.ccg/`；禁止删除仍在使用的桥脚本 |
| `.product-pm/` | `README.md`、`prd/print-material-pack.md`、`.DS_Store` | 不入库，仅记录提案 | 先把 `print-material-pack.md` 评估并抽取到 `docs/product/` 或 `docs/reviews/`；抽取后再 ignore 工具工作区 | 禁止在 PRD 去向未确认前直接 ignore 或删除 |
| `.workbuddy/` | `memory/MEMORY.md`、按日工作日志 | 不入库，仅记录提案 | 本地保留并 ignore；如有已确认项目阶段或商业结论，只抽取摘要到正式 docs；商业策略默认不进公共仓库 | 禁止把个人记忆整目录作为项目事实来源；禁止直接删除 |
| `.superpowers/` | `brainstorm/**/content/*.html`、`state/server.pid`、`state/server-stopped` | 不入库，仅记录提案 | `state/` 可 ignore；HTML 设计/IA 预览先判断是否已被 `docs/design/` 覆盖，未覆盖则抽取或外部归档 | 禁止因 ignore 掩盖唯一设计预览 |

## 候选 ignore 模式

本节只作为后续任务候选，不在 T2 写入 `.gitignore`。

### 方案 A：保守模式，优先 ignore 运行状态

```gitignore
# CCG Commander runtime state only
.ccg/commander/inbox/
.ccg/commander/outbox/
.ccg/commander/processed/

# Superpowers runtime state
.superpowers/**/state/

# Local personal/tool memory
.workbuddy/
```

适用条件：

- 仍希望保留 `.ccg/commander/README.md` 与 `codex-bridge.sh` 的可见性。
- `.product-pm/prd/print-material-pack.md` 尚未抽取，不应先 ignore `.product-pm/`。
- `.superpowers/brainstorm/**/content/*.html` 尚未确认去向。

### 方案 B：抽取后整子目录 ignore

```gitignore
# Local collaboration/tool workspaces
.ccg/commander/
.product-pm/
.workbuddy/
.superpowers/
```

适用条件：

- `.product-pm/prd/print-material-pack.md` 已抽取或明确放弃。
- `.superpowers/brainstorm/**/content/*.html` 已抽取、外部归档或明确放弃。
- `.ccg/commander/` 的桥接协议已抽取摘要，或确认只是个人本地工具。

硬性规则：

- 绝不能写 `.ccg/`。
- 绝不能写会覆盖 `.ccg/spec/` 或 `.ccg/tasks/` 的模式。
- 写入 ignore 后必须运行 `git check-ignore -v` 验证只命中预期路径。

## 必须先确认或抽取的内容

| 优先级 | 内容 | 建议去向 | 阻塞关系 |
| --- | --- | --- | --- |
| P0 | `.product-pm/prd/print-material-pack.md` | `docs/product/` 或 `docs/reviews/` | 抽取或明确放弃前，不建议 ignore `.product-pm/` |
| P1 | `.superpowers/brainstorm/**/content/campus-fair-visibility-structure.html` | `docs/design/`、`docs/reviews/` 或仓库外归档 | 确认去向前，不建议整目录 ignore `.superpowers/` |
| P1 | `.ccg/commander/README.md` 与桥接规则 | 归并到协作规则文档，或确认仅本地使用 | 不阻塞 ignore 运行状态，但阻塞整目录删除 |
| P2 | `.workbuddy/memory/*.md` 中的阶段/商业结论 | 只抽取摘要到正式 docs；商业策略默认不入库 | 不阻塞 ignore，但阻塞删除 |

## T3 / T4 / T5 分界

T3：E 类本地工具落地，执行必要抽取与 ignore。

- 用户确认候选模式后再改 `.gitignore`。
- 改 `.gitignore` 前先抽取 P0/P1 内容，或记录“用户确认放弃入库”。
- 只用显式 `git add <path>`。
- 验证 `git check-ignore -v` 只命中预期路径。

T4：C 类任务与审查证据筛选。

- 只新增筛选清单，不整包提交 `.ccg/tasks/`。
- 优先保留 plan / review / verify / deploy / audit。
- ack / advise / explain 等低价值记录不入库需用户确认。

T5：D 类外部材料和本地文件归档。

- `docs/business/`、`deliverables/`、`opc-doc/` 属 D 类，不并入 T2。
- 删除本地工具目录、移动 PDF/PNG/PPT/DOCX/ZIP、外部归档大文件，都必须另起任务并再次确认。

## 验收条件

- T2 只新增/修改提案和任务状态文档，不改 `.gitignore`。
- 提案列出每个 E 类目录的处理建议和风险。
- 提案明确 `.product-pm/prd/print-material-pack.md` 与 `.superpowers` HTML 预览不能被静默掩盖。
- 提案明确禁止裸 `.ccg/` ignore。
- 后续 T3/T4/T5 边界清晰。

## 双模型分析摘要

Claude 结论：

- 同意“先提案，不改 `.gitignore`”。
- `.product-pm/prd/print-material-pack.md` 是 P0 抽取项。
- `.superpowers` HTML 预览和 `.ccg/commander` 协作协议需先评估价值。
- `.workbuddy` 默认本地保留并 ignore，商业策略由用户裁决。

Antigravity 结论：

- 同意“先提案，不改 `.gitignore`”。
- 不能 ignore 裸 `.ccg/`，必须采用 granular subdirectory strategy。
- 建议保留运行状态与正式治理内容的边界；PRD 和设计预览应先抽取或明确放弃。

## 给用户的确认项

1. 是否同意 T3 采用“先抽取 P0/P1 内容，再写 `.gitignore`”。
2. `.product-pm/prd/print-material-pack.md` 放入 `docs/product/`、`docs/reviews/`，还是暂不入库。
3. `.superpowers/brainstorm/**/content/*.html` 是否保留为设计证据，还是仓库外归档。
4. `.ccg/commander/` 是否仍在使用；若仍使用，优先采用方案 A，只 ignore 运行状态。
5. `.workbuddy/` 是否允许整目录 ignore 并本地保留。
