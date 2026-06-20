# T3 E 类本地工具落地审查记录

审查时间：2026-06-21

审查范围：

- `.gitignore`
- `docs/product/print-material-pack-prd.md`
- `docs/design/campus-fair-visibility-structure.md`
- `docs/reviews/project-normalization-codex-claude-collaboration.md`
- `docs/reviews/project-normalization-local-tools-landing.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/normalization-local-tools-landing/task.json`

## 本地验证

- `git diff --cached --check`：通过。
- `git diff --cached --name-only | grep -E '^(apps|services|packages)/' || true`：无输出。
- 暂存白名单扫描：无输出。
- 正向 `git check-ignore -v`：`.product-pm/`、`.workbuddy/`、`.superpowers/`、`.ccg/commander/` 均命中根路径锚定规则。
- 负向 `git check-ignore -v`：`.ccg/spec/guides/index.md`、`.ccg/tasks/project-normalization-p0/task.json` 无输出。
- `git ls-files .product-pm .workbuddy .superpowers .ccg/commander`：无输出。
- 敏感密钥模式扫描：无输出。

## 双模型分析

### Claude

结论：`CHANGES_REQUESTED` 后已处理。

要求：

- 明确源文件来自主工作区，不在治理 worktree 内，不能凭记忆抽取。
- `.gitignore` 规则必须根路径锚定，避免误伤嵌套同名目录。
- 补齐正向/负向 `git check-ignore` 和 `git ls-files` 验证。

处理：

- `docs/reviews/project-normalization-local-tools-landing.md` 已记录源文件来自主工作区。
- `.gitignore` 使用 `/.ccg/commander/`、`/.product-pm/`、`/.workbuddy/`、`/.superpowers/`。
- 已补齐验证并记录。

### Antigravity

结论：`APPROVE_PLAN`。

要点：

- 同意先抽取 PRD 和设计预览，再 ignore 本地工具目录。
- 建议修正 PRD 关联文档相对链接。
- 强调不能写裸 `.ccg/`。

## 双模型复审

### Claude

结论：`APPROVE`。

先前 Warning / Info：

- `.workbuddy/` 未抽取即 ignore：已补充 T2/T3 判断，没有 P0/P1 级必须立即入库内容，商业策略后续另起任务。
- PRD 草案 `fileMd5` 与 `SHA-256` 不一致：已改为 `fileSha256`。

最终复审结果：无 Critical / Warning。

### Antigravity

结论：`APPROVE`。

要点：

- `.gitignore` 根路径锚定规则正确。
- P0/P1 内容已先抽取到正式 docs。
- 正向/负向 ignore 验证与敏感扫描均通过。

## 结论

T3 可提交。本轮不删除、不移动、不归档主工作区本地文件，不触碰运行时代码。下一步进入 T4：C 类任务证据筛选。
