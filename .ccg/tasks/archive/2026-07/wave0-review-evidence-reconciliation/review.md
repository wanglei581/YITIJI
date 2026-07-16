# 审查异步日志事实校正

## Failure Capture

- 目标：取得 Wave 0 增量有效双模型审查。
- 首次症状：Claude wrapper 先返回 session 标识，早期读取到的日志只有启动行；Antigravity 返回“not logged in”。
- 最后成功步骤：本地 diff、SQLite/PostgreSQL 验证均通过。

## Root Cause

- Claude wrapper 的完整模型输出异步追加到同一日志文件；等待 wrapper 进程退出并不能保证日志已写完。后续读取到 4,646 字节完整报告，结论为 `APPROVE（Critical 0 / Warning 0）`。
- Antigravity 在 wrapper 启动期显示 token source 为“not logged in”，但 `agy models` 随后证明 keyring token 有效；实际根因是 wrapper 在认证/输出完成前读取结果，加上 headless 项目上下文落到旧 worktree，初次报告无效。

## Recovery

- 只校正正式文档和已归档审查记录，不重新修改运行时代码。
- 保留 Claude 有效批准；Antigravity 改为 `--new-project`、`Gemini 3.5 Flash (High)`、内联精确代码 diff、无工具的只读审查，得到 `APPROVE（Critical 0 / Warning 0）`。
- Claude 报告的终态幂等和撤回创建期审计已补入 Wave 1 待办。

## Verification

- `git diff --check` 通过。
- 已检查正式进度、验收和归档审查文件无冲突标记。
- 只修改文档和任务归档；未修改运行时代码、依赖、数据库、生产配置或审查器凭据。
- 两份有效模型审查均已取得；本任务不执行 push、PR、GitHub CI 或部署。
