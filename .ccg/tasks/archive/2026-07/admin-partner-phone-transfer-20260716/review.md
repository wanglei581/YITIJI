# Admin–Partner 手机号安全转移：设计初审记录

## 范围

本轮只审查 `requirements.md`、设计规格和实施计划，未实现业务代码、未连接生产、未发送短信、未执行真实手机号转移。

## 模型路由诊断

- Antigravity CLI `1.1.3` 的默认 CCG wrapper 未透传模型参数，默认 Gemini 路由因个人额度耗尽不可用。
- 显式 `Claude Opus 4.6 (Thinking)` 的最小请求可成功，但长审查返回服务端 `503 no capacity`，不适合作为当前稳定门禁。
- 用户同意切换可用模型后，`--backend antigravity` 通过临时、非项目 shim 显式路由到 `Claude Sonnet 4.6 (Thinking)`；串行鉴权预热后完成有效长文审查。
- 临时 shim 不属于仓库，不改变项目或全局默认模型配置。

## 双模型结果

### Antigravity

- 实际模型：Claude Sonnet 4.6 (Thinking)
- 结论：`84/100 REQUEST_CHANGES`
- 主要意见：密码预约额度成功释放必须写清；四个审计动作必须都有写入点；事务第二步失败测试必须真实可触发；旧版本会话缓存并发回填必须有原子防线。

### Claude

- 实际模型：Claude Opus 4.8 (1M context)
- 结论：`READY`，但列出同样四项实现前收紧要求。
- 补充意见：Partner release 审计可通过 actor/target 列追溯，payload 可保持为空；PostgreSQL 非延迟唯一约束应描述为逐语句检查。

## 代码事实核验

- `AdminInitialPhoneBindService` 的真实顺序是 `reserve → bcrypt → 成功或 bcrypt 异常 release`；密码不匹配保留失败额度，短信发生在释放之后。
- `JwtAuthGuard` 在缓存命中时比较 `JWT payload.ver` 与缓存 `state.tokenVersion`，但不每次回源数据库；仅删除缓存存在旧版本在途回填的最多 60 秒窗口。
- `RedisService.setJsonIfVersionNotOlder` 已能原子拒绝较旧版本覆盖较新缓存，可直接用于本功能。

## 采纳后的收紧方案

1. 转移 start 精确镜像严格初绑的密码额度预约/释放语义，并测试成功 start 不消耗额度。
2. start/complete/cancel/released_by_admin 四个动作全部写入；start/cancel 为 best-effort，complete/release 位于事务内。release 使用 `actorId=Admin`、`targetId=Partner`、空 payload。
3. 隔离 SQLite verifier 使用无插值静态 trigger：Partner 第一步释放后递增未绑定 Admin 版本，真实触发第二步 CAS 为 0，并证明整个事务回滚；直接在 verify 前改 Admin 版本不可用，因为会被事务前复核短路。
4. 事务返回 Partner 新版本会话状态；提交后使用 `setJsonIfVersionNotOlder` 写入新缓存，而不是只删除。测试新版本覆盖、旧版本并发回填拒绝、旧 JWT 立即失败，以及缓存刷新失败时的 TTL 收敛。
5. `JwtAuthGuard` 仅导出既有 60 秒 TTL 常量，行为不变；不新增另一套缓存标准。

## 针对性复审

- Antigravity：实际模型 Claude Sonnet 4.6 (Thinking)，`READY 96/100`。四个核心问题全部关闭；补充的事务内 `findUniqueOrThrow` 读取方式与 cancel 审计失败日志脱敏已并入最终文档。
- Claude：实际模型 Claude Opus 4.8 (1M context)，`READY`，Critical 0、Warning 0，明确允许进入 TDD。
- Claude 的实现期 Minor：SQLite trigger 可能同时递增夹具中的另一 Admin，测试必须断言目标 Admin 与 Partner 均完整回滚；Partner 机构在极端并发删除时按既有会话状态口径处理，不在本任务扩域。

## 当前结论

设计分析门禁已通过，允许按计划 Task 1 从后端 RED verifier 进入 TDD。代码完成后仍需对真实 diff 执行 Antigravity Sonnet 4.6 + Claude 双模型终审；未通过前不得推送、部署、发真实短信或执行真实转移。

## 最终实现与验证

- 最新 `origin/main` 已通过普通 merge 集成；唯一文档冲突已按正式进度记录合并，运行时代码和 CI 无冲突。
- API 专项覆盖：角色限制、共享密码失败额度、OTP purpose 隔离、ticket 严格解析、验证锁、双 CAS、单事务先清后绑、四类审计、禁用 Partner、旧 JWT 失效、缓存版本不倒退、取消/未知结果保守恢复、Partner 用户名密码登录保留。
- Admin 专项覆盖：严格响应 shape、三态内存状态机、四项影响说明、确认框门控、未知发送冷却、远端 cancel、成功后只合并脱敏手机号字段。
- 本地 HTTP mock 浏览器冒烟完成：默认首次绑定 → 切换安全转移 → 来源摘要与四项影响 → 未勾选不可提交 → 勾选后验证成功只显示脱敏手机号；另一路确认返回首次绑定会调用远端 cancel。全部业务请求仅指向 localhost，没有生产请求、真实短信或真实转移。

### Fresh 验证结果

以下命令均退出 0：

- `INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:admin-phone-transfer`
- `INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone`
- `pnpm --filter @ai-job-print/api verify:internal-auth-phone:target-guard`
- `pnpm --filter @ai-job-print/api verify:admin-orgs`
- `pnpm --filter @ai-job-print/admin verify:admin-phone-transfer-ui`
- `pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui`
- `pnpm --filter @ai-job-print/shared typecheck`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/api lint`
- `pnpm --filter @ai-job-print/admin lint`
- `pnpm --filter @ai-job-print/api build`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build`
- `pnpm --filter @ai-job-print/api db:pg:sync:check`
- `git diff --check`

Admin build 仅有既有 500 kB chunk 警告。`pnpm audit --audit-level high` 按预期退出 1，基线仍有 `shell-quote` critical，以及 `hono`、`multer`、`vite` high；本任务未修改依赖，故代码候选完成但部署继续 blocked。

## 最终双模型终审

- Antigravity 实际模型：`Claude Sonnet 4.6 (Thinking)`；完整 diff 终审 `APPROVE`，Critical 0。其建议保留 cancel 未确认时的保守失败语义，符合既定规格；另建议裁剪 Admin 查询字段。
- Claude 实际模型：`Claude Opus 4.8 (1M context)`；完整 diff 终审 `APPROVE`，Critical 0。其建议补事务异常的脱敏分类日志。
- 两项可采纳建议均按 RED→GREEN 完成：事务基础设施异常只记录 Admin ID、Partner ID 与错误类名，预期 `HttpException` 状态冲突不告警；start 只额外读取密码摘要，verify 不读取密码摘要或其他非必要字段。
- 加固补丁再次由 Antigravity Sonnet 4.6 Thinking 与 Claude Opus 4.8 只读复审，结论均为 `APPROVE`；专项 verify、认证回归、API lint/build/typecheck 与 `git diff --check` 再次通过。

## 交付边界

本地候选已完成；未 push、未创建 PR、未运行远程 GitHub CI、未部署、未发送真实短信、未执行真实手机号转移。下一步只能在用户明确授权后推送并创建 PR；生产执行还需独立授权、已部署版本、依赖 P0 清零和本人真实 OTP 验证。

## 授权后的集成状态

用户随后明确同意继续，分支已推送并创建 [PR #266](https://github.com/wanglei581/YITIJI/pull/266)。首轮 GitHub Actions `29501185035` 的 `build-and-verify`（7m22s）与 `postgres-readiness`（2m58s）均通过。PR 仍为 open/mergeable；未合并、未部署、未发送真实短信、未执行真实手机号转移。
