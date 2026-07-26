# 审查需求

## Git 范围

- Base: `origin/main@e53c1d1e9f7b2489adf8d2c7ea5d6c7df908178f`
- Head: `d8b68de13043137d312e7f2feefd3723e0e4ce8a`
- 范围：`origin/main..HEAD` 共 5 个本地提交。

## 目标

1. 核对 Node 22 / pnpm 11.2.2 仓库契约、依赖安全门禁、部署 Runbook 与进度文档是否一致。
2. 检查五个提交是否夹带业务逻辑、凭据、生产写操作或不应入库的本机状态。
3. 执行与变更相关的冻结安装、安全、类型、lint、构建和专项 verify，不执行部署、migration、seed 或外部写操作。
4. Antigravity 与 Claude 并行独立审查，合并去重后给出是否可推送 / 创建 PR 的结论。

## 授权边界

- 本轮只审查、运行本地验证并写审查记录。
- 不修改业务代码、不修复发现的问题，除非用户后续明确授权。
- 不 push、不创建 PR、不部署、不修改远程或预生产状态。
