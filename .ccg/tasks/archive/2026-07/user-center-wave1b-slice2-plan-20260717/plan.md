# 方案编写步骤

1. 从 `origin/main@0ae51289` 读取 Slice 1、审计、BullMQ、文件与存储实现。
2. 对 Slice 2 做 Antigravity 与 Claude 并行架构审查；以有效报告中的 Critical/Major 修正方案。
3. 更新总计划的当前事实和 Slice 2 强制恢复要求。
4. 新增可独立执行的 Slice 2 详细计划，列出文件预算、接口、状态机、RED→GREEN 步骤与门禁。
5. 同步 `current-progress.md`、`next-tasks.md`，验证无运行时代码差异，记录审查结果后归档并本地提交。
