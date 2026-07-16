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
