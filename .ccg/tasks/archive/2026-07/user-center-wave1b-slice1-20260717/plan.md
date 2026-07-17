# Slice 1 实施计划

权威产品计划：[`docs/superpowers/plans/2026-07-17-user-center-wave1b-reversible-data-rights.md`](../../../../docs/superpowers/plans/2026-07-17-user-center-wave1b-reversible-data-rights.md) 的 **Slice 1**。

1. 审查现有请求、Step-up、Prisma 与验证真相，完成双模型分析尝试。
2. 先加入独立的状态机验证：注销零副作用、导出重放不重复消费授权、同用户键冲突拒绝。
3. 扩展共享/API 契约和双 schema/migration；将请求职责从同意服务移到专职服务。
4. 收紧用户与管理端控制器，保证所有未实现执行能力都不可被路由触发。
5. 运行验证、审查差异与密钥，更新正式进度文档。
6. 进行双模型代码审查；修正 Critical 问题后再次验证，归档任务并本地提交。
