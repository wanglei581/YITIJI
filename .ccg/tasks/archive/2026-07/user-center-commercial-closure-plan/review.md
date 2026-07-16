# 用户中心商用级闭环方案复审

## 复审范围

- `docs/reviews/user-center-commercial-closure-audit-2026-07-16.md`
- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/progress/current-progress.md` 的 2026-07-16 用户中心条目
- `docs/progress/next-tasks.md` 的用户中心分波任务

## 模型执行情况

- Claude：方案审计阶段结论为 `APPROVE（附强制修订项）`；精确计划首轮提出 4 个实现级 Warning，修订后最终复审为 `APPROVE`，无 Critical/Warning。
- Antigravity：早期分析与复审曾因 `RESOURCE_EXHAUSTED` / 个人额度耗尽失败；额度恢复后的最终精确计划复审有效返回 `APPROVE`（99/100），无 Critical/Warning。早期失败证据保留，但不再代表最终状态。
- Codex：基于 1080×1200 运行态截图、DOM、源码、最新 `origin/main` 事实和 Product Design 审计规范完成触控/信息架构复审及最终计划归并。

## Critical

### C1 phoneHash 非空唯一约束与注销后重新注册冲突

原方案把手机号匿名化写成“清空或不可逆替换”，但 `EndUser.phoneHash` 为非空唯一字段。若保留原 hash，会永久占用手机号；若清空，会违反非空约束。

已修订：

- `phoneHash` 必须替换为不可逆随机墓碑值。
- `phoneEnc` 替换为不含原号码的随机墓碑密文，昵称清空。
- 原手机号 hash 不再存在，同一号码可以注册为全新 EndUser，且不继承旧资产。
- W1-A 必须补匿名账户不命中原手机号登录查询的集成测试。

## Warning

### W1 enabled/status 双轨鉴权空窗

已修订：迁移期 status 与 enabled 同事务双写；disabled/closing/anonymized 必须同时 `enabled=false`；鉴权切换和回填完成前不能关闭旧门禁。

### W2 SQLite 验证库与权威 schema 表述不精确

已修订：明确 `Order.refundedAmountCents` 和 `RedemptionRecord` 已存在于权威 schema，失败是本地 SQLite 验证库未重放正式 migration；禁止重复建迁移。

### W3 导出单次下载与多次下载策略冲突

已修订：统一为 step-up 后签发 10 分钟一次性应用 ticket，不向客户端下发对象存储 URL；一体机仅展示手机领取二维码，ticket 只经 URL fragment/header 交付。下载先原子获取有租约的 claim，对象至少保留到 HTTP response `finish`；随后异步物理删除并由 reconciler 幂等收口账本。中断/租约超时可重新 step-up 领取，成功交付或自然过期后拒绝重复下载。

### W4 现有 export/delete 可产生虚假 completed 审计

已修订：Wave 0 增加临时防线，真实执行链完成前不得把 export/delete 工单标为 completed；export 只能处理中或被明确拒绝，delete 只能保持处理中/失败并走重试或人工升级，不能普通拒绝、取消或恢复 active。

## Info

- step-up 的 deviceId 已降级为审计/风险信号，不作为公共一体机的强身份边界。
- 收费模式明确复用 `PRINT_REQUIRE_PAID_BEFORE_CLAIM=true`，不建平行出纸门禁。
- 临期权益只在 `BenefitGrant.validUntil` 有真实值时计算。
- “身份切换”在最新 `origin/main` 已不存在，Wave 0 只补防回归断言，不再制造无效删除 diff。
- 最新 `origin/main` 的二维码守卫已与现行降级文案一致并通过；Wave 0 只复验，不无故修改实现或守卫。
- 方案补充「青序 LightFlow」现行设计目标与 27 寸触控/手机/桌面适配约束。

## 复审结论

方案与精确实施计划中的 Critical/Warning 已全部吸收。Antigravity 重新授权后的最新聚焦复审为 `APPROVE`（98/100），Claude 给出 `WAVE0_READY: YES` 与 `WAVE1_PLAN_READY: YES`；两边均无 Critical，所有可执行 Warning 已写回计划，可以进入 Wave 0。这不代表法务门禁已满足，也不代表运行时代码、数据库迁移、预生产或真机验收已经完成。

## 详细实施计划复审（2026-07-16）

- 用户已批准先做 Wave 0 / Wave 1。
- 新增总控计划和四份按分支拆分的 TDD 详细计划，覆盖 Wave 0 真实基线、账户安全、数据权利、Kiosk/Admin 运营 UI。
- Claude 对方案阶段 5 个强制修订点（phoneHash 墓碑与同号重注册、enabled/status 双写、SQLite 迁移表述、单次导出、防虚假 completed）均评为 PASS。
- Claude 对精确计划首轮提出的 4 个实现级 Warning 已全部落盘：step-up grant 在幂等/active preflight 之后才消费；统一 API error union；JWT `jti → sessionId → logout` 撤销链；Wave 0 Task 7 纳入 `verify-job-ai-privacy.ts` 文件预算。
- 详细计划进一步补齐 `member:user-step-up-grants:{endUserId}` 原子索引/撤销、PostgreSQL 完整 migration SQL、`revoke_consent` 同步原子创建、会员级 export/delete 互斥、一次性 ticket 的 fragment/header 交付、有租约下载 claim、HTTP `finish` 后清理与 reconciler、`expired` 终态、closing 弱网最小回执、存储 at-rest 加密验收和对象上传补偿。
- 不可逆注销以 `MEMBER_ACCOUNT_CLOSURE_EXECUTION_ENABLED=false` 默认 fail closed；法务版本化分类留存矩阵、冷静期、财务/审计期限和最小审计字段未签字时，API、Kiosk 与 worker 都不能开放执行。
- Antigravity 重新授权后的首轮聚焦复审发现下载 `finish/close` 悬空 Promise、注销回执路由表达和手机号精确搜索等计划细节；Claude 同轮发现 Profile 姊妹守卫标题、Wave 0 `delete→rejected` 口径、policy mapper 与法务门禁粒度等问题。有效项均已逐条写回计划；Antigravity 对两条已存在内容的误报未采纳，并保留核对证据。
- 最终复审：Antigravity `APPROVE`（98/100），Claude 同时给出 `WAVE0_READY: YES` / `WAVE1_PLAN_READY: YES`。Claude 最后指出 `verify-profile-inkpaper-home.mjs` 的精确标签与 `finishDownload` 单参签名措辞，两项也已修订；当前无未处理 Critical/Warning。
- Claude 最终窄范围复审唯一 Info 指出纯函数 `ALLOWED` 未显式表达 enqueue 失败的 `pending→failed` 补偿路径；现已同时补入总控状态表和 data-rights 状态机，并限定为 queue/session-revoke 失败的服务端补偿 CAS，Admin/API 仍不得直接写 failed。
