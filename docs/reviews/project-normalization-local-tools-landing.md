# 项目规范化 T3：E 类本地工具落地报告

> 生成时间：2026-06-21
> 分支：`codex/normalization-local-tools-landing`
> 范围：抽取 E 类目录中的 P0/P1 价值内容，写入确认后的 ignore 规则；不删除、不移动、不归档主工作区本地文件。

## 结论

T3 完成 E 类本地工具落地：

- `.product-pm/prd/print-material-pack.md` 已抽取为正式产品草案：[print-material-pack-prd.md](../product/print-material-pack-prd.md)。
- `.superpowers/brainstorm/66602-1781578016/content/campus-fair-visibility-structure.html` 已抽取为设计决策摘要：[campus-fair-visibility-structure.md](../design/campus-fair-visibility-structure.md)。
- `.ccg/commander/` 的本地桥工具边界已写入 [project-normalization-codex-claude-collaboration.md](./project-normalization-codex-claude-collaboration.md)。
- `.workbuddy/` 暂不抽取商业策略或个人记忆，按本地保留处理。
- `.gitignore` 已新增根路径锚定规则，只 ignore E 类本地工具工作区，不 ignore 裸 `.ccg/`。

## 抽取来源

本轮源文件来自主工作区 `/Users/wanglei/AI求职打印服务终端`，不是当前治理 worktree 内部文件：

| 源路径 | 处理 | 目标 |
| --- | --- | --- |
| `.product-pm/prd/print-material-pack.md` | 机械复制为正式产品草案，修正相对链接并保留 Draft 状态 | `docs/product/print-material-pack-prd.md` |
| `.superpowers/brainstorm/66602-1781578016/content/campus-fair-visibility-structure.html` | 抽取为 Markdown 设计摘要，不保留交互 HTML | `docs/design/campus-fair-visibility-structure.md` |
| `.ccg/commander/README.md`、`codex-bridge.sh` | 只沉淀本地桥工具边界，不跟踪脚本和消息队列 | `docs/reviews/project-normalization-codex-claude-collaboration.md` |
| `.workbuddy/memory/*.md` | 本地保留，不作为正式项目事实来源 | T2/T3 仅识别到个人记忆、OPC 工作日志和商业策略，没有 P0/P1 级必须立即入库内容；后续如需抽取商业策略，另起任务 |

## ignore 规则

`.gitignore` 新增：

```gitignore
# Local collaboration/tool workspaces (keep locally, do not track)
/.ccg/commander/
/.product-pm/
/.workbuddy/
/.superpowers/
```

设计原则：

- 使用根路径锚定，避免误伤未来嵌套同名目录。
- 只 ignore `.ccg/commander/` 子目录，绝不 ignore `.ccg/`。
- `.ccg/spec/`、`.ccg/tasks/` 继续可跟踪。
- ignore 只影响 Git 状态，不删除本地文件。

## 验证口径

提交前必须验证：

- `git diff --cached --check` 通过。
- `git diff --cached --name-only` 只包含 T3 允许文件。
- `git check-ignore -v .product-pm/README.md .workbuddy/memory/MEMORY.md .superpowers/brainstorm/66602-1781578016/state/server.pid .ccg/commander/codex-bridge.sh` 命中新增规则。
- `git check-ignore -v .ccg/spec/guides/index.md .ccg/tasks/project-normalization-p0/task.json` 无输出。
- `git ls-files .product-pm .workbuddy .superpowers .ccg/commander` 无输出。
- 抽取文档敏感密钥扫描无输出。

## 后续任务

T4 继续处理 C 类任务证据筛选：只新增清单，优先保留 plan / review / verify / deploy / audit，不整包提交 `.ccg/tasks/`。

T5 继续处理 D 类外部材料索引：为 `docs/business/`、`deliverables/`、`opc-doc/` 建摘要索引，PDF/PNG/PPT/DOCX/ZIP 是否入库先确认仓库外备份。
