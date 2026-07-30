# P0-2 / F1 D3 需求与边界

## 目标

- 以 PR #436 合并后的 `origin/main` 精确提交作为本轮源码候选基线。
- 只读核验 F1 D3 所需的生产新链前置条件，并给出逐项 PASS / BLOCKED / NOT PRESENT 证据。
- 产出明确的 GO / NO-GO 结论；D3 未全部满足时不得进入 D4。

## 允许范围

- 本地读取 Git、GitHub CI、仓库内 F1 规格、实现、verify 和部署文档。
- 本地执行 frozen install、离线 provenance / Genesis verify、typecheck、lint、build 与哈希计算。
- 对已配置生产主机执行无副作用只读命令，且只读取批准的路径标识、账户角色、PM2 元数据、文件类型/权限/摘要、端点监听和 health 状态。
- 记录脱敏证据，不记录环境变量值、凭据、连接串、token、用户数据、日志正文或业务数据。

## 禁止范围

- 不创建、删除或修改生产目录、文件、链接、锁、control record、PM2 进程、Nginx/负载层、环境变量、数据库、Redis、COS、账号、终端或打印机状态。
- 不运行 `release:genesis`、`release:activate`、部署、reload、restart、migration、切流、故障注入或历史来源回填。
- 不读取或输出 `.env` 内容、环境变量值、密钥、日志正文、用户文件或业务记录。
- 不把旧 PM2 `online`、HTTP 200、本地 fixture 或 D2 镜像演练当成 production F1 来源一致性通过。

## 文件预算

允许新增或修改：

- `.ccg/tasks/p0-2-f1-d3-precheck-20260730/*`
- `docs/reviews/f1-d3-production-readonly-precheck-2026-07-30.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

禁止修改应用代码、部署脚本、CI、依赖、schema、migration 和其他文档。

## 验收标准

- 精确记录候选 commit、相关 CI 状态及本地离线验证结果。
- D3 九类门槛逐项有证据：独立主机/端点、PM2 名称、managed current、control root、长期保留边界、launcher 摘要、runtime-env contract 摘要、零流量条件、权限分离与残留锁恢复流程。
- 任何缺项均输出 NO-GO，并停止在 D3。
- Claude、antigravity 与 Cursor 均完成只读分析或如实记录工具失败；最终再由 Claude + antigravity 双模型复核。
