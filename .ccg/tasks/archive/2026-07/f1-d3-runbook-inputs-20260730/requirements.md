# F1 D3 runbook 与 managed 输入清单需求

## 目标

- 修正 `production-deployment-runbook.md` 中 future-only `release:activate` 示例与当前 20 参数 CLI 的漂移。
- 为下一次 D3 只读预检提供正式、可审核、无秘密的 managed 拓扑输入清单；任何字段未填写或未批准都必须保持 NO-GO。
- 同步正式进度入口，但不改变 D3/D4/D5/D6 当前授权与完成状态。

## 文件预算

允许新增或修改：

- `docs/device/production-deployment-runbook.md`
- `docs/device/f1-d3-managed-topology-inputs.md`
- `docs/superpowers/plans/2026-07-30-f1-d3-runbook-inputs.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/f1-d3-runbook-inputs-20260730/*`

禁止修改应用代码、release provenance 实现、CI、依赖、schema、migration 和其他文档。

## 内容边界

- runbook 的 activation 示例必须精确使用代码定义的 10 个 flag：candidate root、current link、artifact root、PM2 name、health URL、launcher cwd/path/SHA、runtime-env contract path/SHA。
- D3 输入清单只允许记录非秘密标识、绝对路径标识、文件摘要、账户角色、权限/保留证明、零流量证明和锁恢复 SOP 引用；不得记录环境变量值、凭据、连接串、token、日志正文或业务数据。
- 输入模板使用明确的 `UNSET` / `NOT_VERIFIED` 状态；任一未关闭项都必须输出 NO-GO，不得以 legacy 主机、PM2 online、HTTP 200、本地 fixture 或 D2 演练代替。
- 不新增可执行 D4/D5/D6 自动化，不给出真实生产命令，不连接生产环境。

## 验证

- 对照 `release-activation.ts` 与 `release-genesis-cli.ts` 核验 flag 名称、数量和差异。
- 校验文档链接、必填字段、禁止项、D3 九类门槛与 fail-closed 语义。
- 运行 API `verify:release-provenance`、`verify:release-genesis` 作为代码契约基线；文档改动不得声称改变运行时。
- `git diff --check`、敏感信息扫描、变更范围检查。
- Claude + antigravity 双模型分析与终审均需形成有效报告。
