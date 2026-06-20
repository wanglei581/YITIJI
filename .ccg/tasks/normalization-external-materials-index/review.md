# T5 D 类外部材料索引审查记录

审查时间：2026-06-21

审查范围：

- `docs/reviews/project-normalization-external-materials-index.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/normalization-external-materials-index/task.json`

## 本地验证

- `git diff --cached --check`：通过。
- `git diff --cached --name-only | grep -E '^(apps|services|packages|docs/business|deliverables|opc-doc)/' || true`：无输出。
- 暂存二进制与交付物扫描：无 PDF、PNG、PPT、DOCX、ZIP、`.DS_Store` 命中。
- 暂存敏感残留扫描：无预生产主机、本机绝对路径、工具临时日志路径或 file URL 命中。
- 凭证形态扫描：无 AK、私钥或可直接使用密钥值命中。

## 双模型分析

### Claude

结论：`APPROVE_PLAN`。

关键要求：

- 必须记录 1 个旧方案 PDF 已被 Git 跟踪。
- T5 只能做索引，不能执行 `git rm`、移动、删除或归档原始文件。
- `opc-doc/outputs/` 和 `.DS_Store` 已被 ignore；`opc-doc/state/*.json` 仍是未跟踪过程态文件。

处理：

- T5 报告新增“Git 状态事实”表，单列已跟踪旧方案 PDF。
- PDF 清理被拆为 D1 派生任务。
- OPC 输出、状态 JSON 和 `.DS_Store` 均只登记处置规则，不入库。

### Antigravity

结论：`APPROVE_PLAN`。

要点：

- 同意用索引替代原始外部材料入库。
- 同意 Markdown 仅作为后续正式文档候选。
- 同意 PDF、OPC 输出、状态 JSON 和 `.DS_Store` 不在 T5 直接提交。

## 双模型复审

### Claude

结论：`APPROVE`。

Info：

- 快照统计来源为主工作区，已补充采样命令。
- 报告存在重复 `## 结论` 标题，已将末尾标题改为 `## 最终口径`。

### Antigravity

结论：`APPROVE`。

要点：

- 报告如实记录已跟踪旧 PDF。
- 清理动作拆到后续独立任务。
- 暂存范围不含原始外部材料、二进制或运行时代码。

## 结论

T5 可提交。本轮只提交外部材料索引、进度文档和 T5 任务记录；不提交 `docs/business/`、`deliverables/`、`opc-doc/` 原始材料，不移动、不删除主工作区文件。
