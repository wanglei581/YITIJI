# 开发任务书 · Codex 终审原始论证（设计难题出处）

> 审查对象：`docs/api/console-ai-dev-spec-2026-08.md`
> 审查方：Codex gpt-5.6-sol / xhigh，2026-08-11
> **原结论：规格不能直接开工，需系统性返工。**

## 本文件的定位已变更（2026-08-11）

**返工方式不是逐条打补丁，而是改变规格文件的职责边界。**

原规格试图把 Prisma 字段、API 路径、状态机转移、迁移脚本写死到可直接抄写的程度。
78 条问题中 **50 条集中在数据模型 / API 契约 / 状态机 / 迁移四章**——
根因不是个别笔误，而是**这些内容不该由未逐行核对代码的一方写死**。

因此规格文件已重新定位为 **[开发任务书](./console-ai-dev-spec-2026-08.md)**：

| 78 条问题的去向 | 条数 | 处理 |
| --- | :---: | --- |
| **事实性错误**（端点、字段、取值、行号写错） | 25 | → 全部沉淀为任务书 **§2 已验证事实基线**，可直接引用 |
| **Prisma 可行性**（关系缺失、精度、索引、唯一约束） | 17 | → 任务书 **§2.6**（可采信结论）+ **P-1～P-9 建表必解决项** |
| **API 契约冲突**（语义重叠、错误格式、DTO 形态） | 9 | → 任务书 **§5.4 语义冲突**（列出必须决定的事，不预设答案） |
| **状态机完备性**（死锁、竞态、双真相） | 14 | → 任务书 **§5.1 / §5.3 设计难题**——**承认是未解决的工程问题**，不再假装已定稿 |
| **迁移可行性**（多实例分叉、回滚丢配置、切流无共享开关） | 10 | → 任务书 **§5.2**，含 Codex 给出的安全滚动顺序（可直接采用） |
| **第一天卡住** | 3 | → 任务书 **§4 S0**，逐条标注真实前置条件 |

**本文件保留为原始出处**：任务书 §5 的每个难题都能在这里找到 Codex 的原始论证与代码行号。
**不再作为「待修 bug 列表」**——那个框架本身就是错的。

## 另一份复核：方案的否定性断言（2026-08-11）

Codex 无范围限制地复核了方案里 **49 条否定性断言**：

| 结论 | 条数 | 说明 |
| --- | --- | --- |
| ✅ 属实 | 39 | 含 X1–X10、Y1–Y10 全部，以及 6 个共用 key、三个空壳页、命名不统一等 |
| ⚠️ 部分属实 | 8 | 现有能力比断言的多，缺口比断言的小 —— **已全部在方案里更正** |
| ❌ 完全错 | 2 | 企业链断点、account-settings 手机绑定 —— **已全部撤回** |

**规律**：Claude 自己读过一手代码的断言全部属实；错误集中在采信受限范围审查结论的地方。

---

审查基于当前 **1212 行**快照（SHA-256 `fbcb69…92bf`）；文件在审查期间由用户所述 1136 行发生了并发修改，以下以当前版本为准，未改仓库。

## 一｜事实性错误

1. **S0 企业链断点已经修过。** 规格仍称 Admin 全页只调列表、机构资料会卡住；实际页面已挂详情与新建抽屉，审核、发布、岗位关联均已接线，且正式进度已记录完成。`docs/api/console-ai-dev-spec-2026-08.md:49-61`；`apps/admin/src/routes/companies/index.tsx:175-189`；`apps/admin/src/routes/companies/components/ReviewPublishSection.tsx:47-72`；`docs/progress/current-progress.md:1415`

2. **companiesAdmin 方法并不缺。** HTTP 与 mock 双轨已包含 review、publish、候选岗位、关联、解绑；规格步骤 2 会重复实现。`docs/api/console-ai-dev-spec-2026-08.md:57-60`；`apps/admin/src/services/api/companiesAdmin.ts:123-132`；`apps/admin/src/services/api/companiesAdmin.ts:186-202`；`apps/admin/src/services/api/companiesAdmin.ts:288-325`

3. **企业页面行数错误。** 规格称该 Admin 页面 631 行；当前 Admin 页面约 192 行，631 行对应的是 Partner 企业页。`docs/api/console-ai-dev-spec-2026-08.md:61`；`apps/admin/src/routes/companies/index.tsx:175-192`；`docs/api/console-ai-dev-spec-2026-08.md:204`

4. **企业接口存在，但 DTO 不是规格中隐含的自由形态。** 审核必须传 `{action:'approve'|'reject', rejectReason?}`，发布传 `{publish:boolean}`，关联传 `{jobIds:string[]}`。`services/api/src/companies/companies.controller.ts:133-165`；`services/api/src/companies/dto/company.dto.ts:102-117`

5. **AuditLog action 与规格不一致。** 当前写的是 `company.review`、`company.publish`，不是四个 `company.review.approve/.reject/.publish/.unpublish`；这应作为迁移决策，不能当成已有契约。`docs/api/console-ai-dev-spec-2026-08.md:68`；`services/api/src/companies/companies.service.ts:380-416`

6. **“批量通过并发布”没有后端契约。** 现有接口都是单条操作，§7 也没有批量端点、部分失败格式或幂等规则。`docs/api/console-ai-dev-spec-2026-08.md:59`；`services/api/src/companies/companies.controller.ts:133-145`；`docs/api/console-ai-dev-spec-2026-08.md:742-875`

7. **`PATCH /admin/ai/config` 不存在。** 当前是 `PUT /admin/ai-config` 和 `PUT /admin/ai-configs/:featureKey`，测试端点分别是 `/test` 与 `/:featureKey/test`。`docs/api/console-ai-dev-spec-2026-08.md:105`；`services/api/src/ai/llm/ai-config.controller.ts:36-76`；`services/api/src/ai/llm/ai-config.controller.ts:79-124`

8. **影子测试问题属实，但现有测试 DTO 不是运行时 DTO。** Controller 使用 TypeScript interface，无法被全局 ValidationPipe 做白名单和字段校验；新端点必须另建 class-validator DTO。`apps/admin/src/routes/ai-config/index.tsx:139-150`；`services/api/src/ai/llm/ai-config.controller.ts:19-34`；`services/api/src/main.ts:82-100`

9. **`AiOperation` 不是 enum。** 它是字符串联合类型；新增 operation 还必须同步 operation 列表和前端映射，不是只补两项类型。`docs/api/console-ai-dev-spec-2026-08.md:142`；`services/api/src/ai/ai-log.service.ts:15-41`；`services/api/src/ai/ai-log.service.ts:119-136`

10. **ASR/TTS 的 `tokenUsageJson=null` 断言错误。** 字段非空且默认 `"{}"`，日志写入也把缺失 usage 序列化为 `{}`。`docs/api/console-ai-dev-spec-2026-08.md:148`；`services/api/prisma/schema.prisma:1540-1557`；`services/api/src/ai/ai-log.service.ts:291-305`

11. **自我探索降级不只是 catch 分支。** JSON 解析失败也返回 `completed`；规格只覆盖了模型不可用。`docs/api/console-ai-dev-spec-2026-08.md:122-136`；`services/api/src/ai/resume/llm-self-assessment.service.ts:106-130`

12. **`status:'degraded'` 当前类型不接受。** 服务、共享类型和前端契约只允许 `completed|rejected`，因此该 S0 不是单文件独立修复。`docs/api/console-ai-dev-spec-2026-08.md:125-136`；`services/api/src/ai/resume/llm-self-assessment.service.ts:86-93`

13. **配置文件引用行号不准确。** 第 175 行只构造路径，实际读写在 181–213 行；更重要的是现有配置还包含 systemPrompt、roleScope、forbiddenWords、enabled，新模型和迁移步骤没有保存它们。`docs/api/console-ai-dev-spec-2026-08.md:542-543`；`services/api/src/ai/llm/llm-config.service.ts:18-37`；`services/api/src/ai/llm/llm-config.service.ts:175-213`

14. **“附录 C.1 的 19 条能力”不存在。** 当前附录只有开工提示，无法确定 19 个 key，也无法解释“第 6–12 条”。`docs/api/console-ai-dev-spec-2026-08.md:549-550`；`docs/api/console-ai-dev-spec-2026-08.md:1203-1212`

15. **`assistant_chat` 不是流式链路。** 当前上游明确 `stream:false`，Controller 也是普通 POST 返回；“保留原流式传输”没有真实基线。`docs/api/console-ai-dev-spec-2026-08.md:568`；`services/api/src/ai/llm/llm-chat.service.ts:265-272`；`services/api/src/ai/ai.controller.ts:379-401`

16. **PostgreSQL schema 的修改规则写反了。** PG schema 是由 SQLite 单一事实源生成，不能要求人工同时编辑两份。`docs/api/console-ai-dev-spec-2026-08.md:219-221`；`services/api/scripts/sync-postgres-schema.ts:4-6`；`services/api/scripts/sync-postgres-schema.ts:20-23`

17. **当前规格实际是 8 张新表，不是 7 张。** `ContentEffectDaily` 已加入正文，却没有进入汇总和文件预算。`docs/api/console-ai-dev-spec-2026-08.md:456-476`；`docs/api/console-ai-dev-spec-2026-08.md:517-532`

18. **Qualification 新增字段数量错误。** 标题称 5 个，实际列了 6 个。`docs/api/console-ai-dev-spec-2026-08.md:482-508`

19. **Qualification 状态机仍使用错误词汇和字段名。** 现有状态是 `pending|valid|expired|revoked|rejected`，有效期字段是 `validUntil`；状态机却写 `reviewing|approved` 与 `expiresAt`。`docs/api/console-ai-dev-spec-2026-08.md:954-961`；`services/api/src/recruitment-content/dto/admin-recruitment-content-query.dto.ts:54-57`；`services/api/src/recruitment-content/recruitment-content-read.service.ts:366-377`；`services/api/prisma/schema.prisma:2241-2273`

20. **统计口径引用了不存在的字段和值。** BrowseLog 没有 `type`，PrintTask 成功态是 `completed` 而非 `done`，PrintTask 也没有内容/会话归因关系。`docs/api/console-ai-dev-spec-2026-08.md:1092-1097`；`services/api/prisma/schema.prisma:121-154`；`services/api/prisma/schema.prisma:1970-1987`；`services/api/prisma/schema.prisma:2461-2471`

21. **现有去重口径不是 30 秒/5 分钟。** BrowseLog 当前按 30 分钟去重，外跳每次都落记录。`docs/api/console-ai-dev-spec-2026-08.md:1103-1107`；`services/api/src/activity/activity.service.ts:32-37`；`services/api/src/activity/activity.service.ts:124-188`

22. **`GET /partner/stats` 不是“前端一行没调”。** 已有前端 service，但它额外发送未声明的 timezone，并把原始响应当 `{data}` 解包，直接接页面很可能 400 或取错结果。`docs/api/console-ai-dev-spec-2026-08.md:831-835`；`apps/partner/src/services/api/stats.ts:141-157`；`services/api/src/orgs/partner-stats.controller.ts:16-35`；`services/api/src/main.ts:82-100`

23. **统一错误响应格式与现状不符。** 实际错误是 `{success:false,error:{code,message,details},requestId}`，不是规格中的平铺结构。`docs/api/console-ai-dev-spec-2026-08.md:730-735`；`services/api/src/common/filters/http-exception.filter.ts:75-80`

24. **规格要求的 422 不是 ValidationPipe 默认行为。** 当前 DTO 校验失败返回 400；所有写接口若要求 422，必须显式转换。`docs/api/console-ai-dev-spec-2026-08.md:292-294`；`docs/api/console-ai-dev-spec-2026-08.md:769-770`；`services/api/src/main.ts:82-100`

25. **“所有写操作都有 AuditLog”不能靠现有默认写法保证。** `AuditService.write` 吞掉数据库失败；关键事务必须使用 `writeRequired`。`docs/api/console-ai-dev-spec-2026-08.md:735`；`services/api/src/audit/audit.service.ts:45-76`；`services/api/src/audit/audit.service.ts:80-105`

## 二｜Prisma 可行性

1. **SQLite 类型总体可用。** 7 张原计划表及新增的 ContentEffectDaily 只用了 String/Int/Float/Boolean/DateTime，没有 enum、array、native JSON；87 个现有 model 中也没有同名模型。`services/api/prisma/schema.prisma:15-17`；`docs/api/console-ai-dev-spec-2026-08.md:223-433`；`docs/api/console-ai-dev-spec-2026-08.md:461-476`

2. **AiCapability：不能原样算完整。** `promptTemplate` 双向关系完整，但 `activeVersionId`、`canaryVersionId` 只是裸 String，能指向不存在或属于其他模板的版本；应定义两个具名关系及反向字段。`docs/api/console-ai-dev-spec-2026-08.md:244-247`；`docs/api/console-ai-dev-spec-2026-08.md:299-328`

3. **AiCapability 索引偏重。** 预计仅 19–30 行时，单列 status、tier 索引收益极低；`[domain,enabled]` 和唯一 key 已足够主要读取。`docs/api/console-ai-dev-spec-2026-08.md:285-287`

4. **AiPromptTemplate：可建且关系完整。** `capabilities` 和 `versions` 都有反向声明，无命名冲突。`docs/api/console-ai-dev-spec-2026-08.md:299-315`

5. **AiPromptVersion：唯一约束不足以保证单 active/canary。** `[templateId,version]` 合理，但 `[templateId,status]` 不是唯一；并发发布仍可产生两个 active 或 canary，必须用模板指针加 CAS/事务锁约束。`docs/api/console-ai-dev-spec-2026-08.md:316-333`

6. **AiUsageLedger：字段可建，账务类型不合格。** `costCny Float` 会产生累计精度误差，应使用整数最小计费单位或经双库验证的 Decimal。`docs/api/console-ai-dev-spec-2026-08.md:340-366`

7. **AiUsageLedger：所谓关联全是裸 ID。** capabilityKey、orgId、terminalId、endUserId 没有 relation 或反向数组；Prisma 能编译，但数据库不保证引用完整性。`docs/api/console-ai-dev-spec-2026-08.md:340-366`

8. **AiUsageLedger：配额索引不够。** per-org/per-user、按能力按日统计需要 `[orgId,capabilityKey,createdAt]` 和 `[endUserId,capabilityKey,createdAt]`；现有两个单维复合索引不能覆盖。`docs/api/console-ai-dev-spec-2026-08.md:356-365`

9. **AiQualitySample：可建但关联和索引不足。** ledgerId 不是 FK且没索引，promptVersion 只有数字无法唯一定位模板版本；待审核队列还缺 `[reviewStatus,createdAt]`。`docs/api/console-ai-dev-spec-2026-08.md:377-397`

10. **AiIncident：可建但契约自相矛盾。** kind 列表没有 `manual`，状态机却写 `kind=manual`；多个未恢复事故也没有防重复约束。`docs/api/console-ai-dev-spec-2026-08.md:399-414`；`docs/api/console-ai-dev-spec-2026-08.md:900-904`

11. **AiComplianceHit：可建但 ruleId、ledgerId 无关系。** 规格没有 ComplianceRule model，ledgerId 也无索引；单列 falsePositive 索引选择性过低。`docs/api/console-ai-dev-spec-2026-08.md:416-433`；`docs/api/console-ai-dev-spec-2026-08.md:819-822`

12. **ContentEffectDaily：不能原样建成可靠聚合表。** 唯一键包含 nullable terminalId，SQLite/PG 都允许多条 NULL 组合，所谓“全部点位合计行”可重复。`docs/api/console-ai-dev-spec-2026-08.md:461-475`

13. **ContentEffectDaily 的 targetType 不覆盖现有类型。** 现有活动归因还有 `company_profile`、`fair_company`，规格枚举没有。`docs/api/console-ai-dev-spec-2026-08.md:465`；`services/api/src/activity/activity.types.ts:9-10`

14. **BrowseLog 加列是安全的，但写链必须同步。** 现有模型字段均为显式 select，nullable 加列不会破坏查询；当前创建逻辑不写 sourceOrgId，迁移后会持续产生空值。`services/api/prisma/schema.prisma:1970-1987`；`services/api/src/activity/activity.service.ts:124-150`；`services/api/src/activity/activity.service.ts:196-239`

15. **ExternalJumpLog 加列同样是安全但不自动生效。** 当前写入没有 sourceOrgId；索引会增加高频写成本，应在查询需求确认后以第二个迁移建立。`services/api/prisma/schema.prisma:1989-2007`；`services/api/src/activity/activity.service.ts:154-188`；`docs/api/console-ai-dev-spec-2026-08.md:574-581`

16. **QualificationRecord 六个 nullable 字段不会直接破坏现有查询。** 但现有 `[organizationId,status,validUntil]` 不能高效支持不限定 organizationId 的全局到期扫描，规格“无需新索引”错误。`services/api/prisma/schema.prisma:2241-2273`；`docs/api/console-ai-dev-spec-2026-08.md:499-512`

17. **AiServiceLog 加列定义没写全。** 规格只写字段名，没有 Prisma 类型、索引、FK、默认值；当前日志写入接口也没有这些参数，按规格开工无法得到非空归因数据。`docs/api/console-ai-dev-spec-2026-08.md:530`；`services/api/prisma/schema.prisma:1540-1557`；`services/api/src/ai/ai-log.service.ts:291-305`

## 三｜API 契约冲突

1. **新 AI 路由大多无精确重名，但与现有 AI 管理面语义重叠。** 当前已有 `/admin/ai/usage`、`/admin/ai/logs` 和两套 ai-config Controller；切流期会出现两套配置写入口和两套成本口径。`docs/api/console-ai-dev-spec-2026-08.md:737-823`；`services/api/src/ai/ai.controller.ts:407-420`；`services/api/src/ai/llm/ai-config.controller.ts:36-124`

2. **Partner 数据源没有精确重名，但生命周期语义冲突。** 当前已有 GET/POST、capabilities 和 `PATCH :id/toggle`；新 PATCH、archive、sync 必须指定 toggle 与 archive 后谁是最终状态权威。`docs/api/console-ai-dev-spec-2026-08.md:858-862`；`services/api/src/jobs/jobs.controller.ts:311-343`

3. **Admin 资质端点形成第二套语义路由。** 当前已有嵌套在 recruitment-content 下的资质查询和证件访问，新 `/admin/qualifications` 若并存会产生两套鉴权、DTO 和审计入口。`docs/api/console-ai-dev-spec-2026-08.md:869-875`；`services/api/src/recruitment-content/admin-recruitment-content.controller.ts:22-24`；`services/api/src/recruitment-content/admin-recruitment-content.controller.ts:56-90`

4. **Controller 守卫写法可以直接套用，但只能做粗角色。** `@Roles('admin')` 可落地；RolesGuard 只检查 admin/partner/kiosk，不支持超管、受限管理员或机构子角色。`docs/api/console-ai-dev-spec-2026-08.md:990-1031`；`services/api/src/common/decorators/roles.decorator.ts:3-19`；`services/api/src/common/guards/roles.guard.ts:15-36`

5. **现有 User/JWT 没有子角色载体。** org_admin/org_editor/org_viewer 的接口与验收无法直接套用。`docs/api/console-ai-dev-spec-2026-08.md:1062-1079`；`services/api/prisma/schema.prisma:500-533`；`services/api/src/common/decorators/current-user.decorator.ts:13-18`

6. **DTO 必须使用 class-validator class。** 规格只有 JSON 示例，没有字段长度、数字范围、互斥条件和嵌套 DTO 契约，无法直接获得现有 whitelist/forbidNonWhitelisted 行为。`docs/api/console-ai-dev-spec-2026-08.md:742-823`；`services/api/src/main.ts:82-100`

7. **统一 Idempotency-Key 不能直接套用。** 项目没有全局幂等拦截器、存储、响应重放和过期规则；该要求必须先补基础设施契约。`docs/api/console-ai-dev-spec-2026-08.md:734`

8. **前端 router 技术上兼容，但不会自动匹配子路由。** 两端当前都是静态、顶层、同步 import；必须显式新增 route object、lazy/Suspense、无效 tab 和关闭抽屉后的 URL 行为。`docs/api/console-ai-dev-spec-2026-08.md:160-195`；`apps/admin/src/routes/index.tsx:39-86`；`apps/partner/src/routes/index.tsx:18-38`

9. **`/jobs/:tab` 与 `/jobs/detail/:id` 可由 React Router 排序正确匹配，但规格缺少默认重定向和非法 tab 处理。** `docs/api/console-ai-dev-spec-2026-08.md:178`；`apps/partner/src/routes/index.tsx:18-38`

## 四｜状态机完备性

1. **Prompt 状态机有滞留路径。** draft 没有取消/archive；回滚没有规定 active/canary 指针如何原子更新，也没有版本 CAS。`docs/api/console-ai-dev-spec-2026-08.md:887-894`；`docs/api/console-ai-dev-spec-2026-08.md:246-247`

2. **能力状态有互相矛盾的双真相。** status 与 enabled 可组成 `disabled+enabled=true`；运行态 degraded/circuit_open 又没有模型或共享存储，实例间无法一致。`docs/api/console-ai-dev-spec-2026-08.md:234-235`；`docs/api/console-ai-dev-spec-2026-08.md:278-280`；`docs/api/console-ai-dev-spec-2026-08.md:896-904`

3. **账本步骤顺序自相矛盾。** 网关先 reserve、后查缓存，但缓存路径声明不 reserve；L1/L2 也在 reserve 后提前返回，而验收要求没有账本记录。`docs/api/console-ai-dev-spec-2026-08.md:610-624`；`docs/api/console-ai-dev-spec-2026-08.md:910-918`；`docs/api/console-ai-dev-spec-2026-08.md:1164`

4. **幂等键只能防同键重复行，不能防不同请求并发超额。** 两个不同 idempotencyKey 可同时读到余额充足并各自 reserve；需要原子预算计数/CAS、Serializable 重试或按预算主体加锁。`docs/api/console-ai-dev-spec-2026-08.md:340-366`；`docs/api/console-ai-dev-spec-2026-08.md:610-624`

5. **清理与 commit 存在竞态。** 过期任务 release 后，模型请求仍可能 commit；必须用 `UPDATE ... WHERE state='reserved'` 的状态 CAS，并定义失败后的调用结果。`docs/api/console-ai-dev-spec-2026-08.md:910-914`

6. **“账本不可变”与 reserve→commit 更新矛盾。** 退款记录也没有 entryType、parentLedgerId、退款幂等键，无法审计重复退款。`docs/api/console-ai-dev-spec-2026-08.md:910-915`；`docs/api/console-ai-dev-spec-2026-08.md:340-366`

7. **内容审核不是定稿契约。** “开发时二选一”会改变字段、API、UI 和并发行为；而 reviewerId、claimedAt、认领/释放端点均未进入 schema 和 §7。`docs/api/console-ai-dev-spec-2026-08.md:925-938`；`docs/api/console-ai-dev-spec-2026-08.md:742-875`

8. **审核通过后编辑自动回 pending 与现有企业逻辑不一致。** 当前 Admin 更新企业不会重置 reviewStatus。`docs/api/console-ai-dev-spec-2026-08.md:933`；`services/api/src/companies/companies.service.ts:368-377`

9. **资质过期不能直接批量覆盖 publishStatus。** 这会把 draft、expired、运营主动 unpublished 全部压成同一状态，续期时无法知道哪些内容应恢复；应独立保存 visibility suspension/reason 或逐内容保存先前状态并 CAS。`docs/api/console-ai-dev-spec-2026-08.md:940-961`

10. **QualificationRecord 上的 degradedAt/restoredAt 不能表达逐内容恢复。** 一个资质可能影响多条不同发布状态的内容，也可能多次过期，两个单值时间戳不足。`docs/api/console-ai-dev-spec-2026-08.md:503-508`；`docs/api/console-ai-dev-spec-2026-08.md:948-961`

11. **资质状态机缺少 revoked，也缺 rejected/expired 后重新上传进入待审的明确路径。** 使用 approved 还会被现有 readiness 当作无效资质。`docs/api/console-ai-dev-spec-2026-08.md:950-961`；`services/api/src/recruitment-content/recruitment-content-read.service.ts:366-377`

12. **工单状态机无数据模型支撑。** 87 个现有模型及 §4 都没有 Ticket、reopenCount、slaBreached 字段，无法实现一次重开和 SLA 状态。`docs/api/console-ai-dev-spec-2026-08.md:963-972`；`services/api/prisma/schema.prisma:1-2535`

13. **事故恢复没有唯一目标。** 同一 capability 可有多个 open incident，恢复动作没有 incidentId 或唯一 open 约束；演练和真实事故也可能互相关闭。`docs/api/console-ai-dev-spec-2026-08.md:974-984`；`docs/api/console-ai-dev-spec-2026-08.md:399-414`

14. **通用并发验收没有实现基础。** schema 与 PATCH API 都没有 version/etag/If-Match，无法提示后写覆盖。`docs/api/console-ai-dev-spec-2026-08.md:1142`；`docs/api/console-ai-dev-spec-2026-08.md:223-433`；`docs/api/console-ai-dev-spec-2026-08.md:742-823`

## 五｜迁移方案可行性

1. **多实例下迁移源不唯一。** JSON 是每个实例的本地文件，各主机内容可能不同；独立脚本必须先指定权威实例、校验 checksum，不能任意读取一份后 upsert。`docs/api/console-ai-dev-spec-2026-08.md:540-554`；`services/api/src/ai/llm/llm-config.service.ts:175-213`

2. **“计数即迁移标记”不安全。** 部分导入、并发导入或将来新增能力都可能误判；应使用带版本和源 checksum 的迁移记录，并在单事务/数据库锁内完成。`docs/api/console-ai-dev-spec-2026-08.md:549-552`

3. **DB-first 双读不能直接替换当前同步 API。** `getConfig/getApiKey/isReady` 都是同步读内存缓存，Prisma 是异步；规格没有定义初始化预热、缓存刷新、跨实例失效和 DB 故障策略。`docs/api/console-ai-dev-spec-2026-08.md:552`；`services/api/src/ai/llm/llm-config.service.ts:266-333`

4. **双读只处理读，不处理双写。** 滚动升级期间旧实例仍写 JSON、新实例写 DB，会立即分叉；必须先发布兼容双写版本、冻结配置写入或用事务 outbox，再统一切读。`docs/api/console-ai-dev-spec-2026-08.md:545-556`；`services/api/src/ai/llm/llm-config.service.ts:302-333`

5. **DB 无记录回退与 DB 故障回退没有区分。** 切流后若 DB 超时仍回退 JSON，会悄悄恢复旧配置；只有明确 not-found 才可回退，数据库错误应失败或使用带版本缓存。`docs/api/console-ai-dev-spec-2026-08.md:552-554`

6. **第 6 步归档文件不适合滚动升级。** 仍运行的旧实例依赖原文件；必须等所有旧实例退出且确认无旧 writer 后再按实例归档。`docs/api/console-ai-dev-spec-2026-08.md:554`

7. **回滚路径会丢迁移后的配置修改。** 保留旧 JSON 不等于能回滚，DB 期间的修改不会反写 JSON；回滚前必须冻结写入并执行 DB→JSON 导出或全程双写。`docs/api/console-ai-dev-spec-2026-08.md:556`

8. **“第 4 步前删表”违反本规格自己的 additive 原则，也不适用于滚动实例。** 已部署但尚未切流的表应保留，回滚应用而非 drop。`docs/api/console-ai-dev-spec-2026-08.md:556`；`docs/api/console-ai-dev-spec-2026-08.md:583-586`

9. **逐能力六批切流缺少跨实例切换机制。** 不同版本实例会分别走旧配额和新账本，同一重试可能调用两次、扣两套额度；需要共享 feature flag、稳定路由或按能力版本门控。`docs/api/console-ai-dev-spec-2026-08.md:558-572`；`docs/api/console-ai-dev-spec-2026-08.md:610-624`

10. **安全滚动顺序应固定为 expand schema → 全实例兼容部署/暗读比对 → 共享开关切流 → 等待在途 reservation 清空 → 至少两个发布周期后 contract。** 当前步骤缺暗读一致性、在途请求处理和最终 contract 条件。`docs/api/console-ai-dev-spec-2026-08.md:538-587`

## 六｜S0/S1 第一天会卡住的地方

1. **S0-2.1 会先发现任务已经完成，而“批量通过并发布”又没有 API 契约。** `docs/api/console-ai-dev-spec-2026-08.md:47-69`；`apps/admin/src/routes/companies/components/ReviewPublishSection.tsx:47-72`

2. **S0-2.4 改成 degraded 会立即触发共享 DTO/前端类型错误，且解析失败分支仍会伪装 completed。** `docs/api/console-ai-dev-spec-2026-08.md:120-136`；`services/api/src/ai/resume/llm-self-assessment.service.ts:86-130`

3. **S0-2.5 不知道 terminalId 从哪里传入。** 当前面试日志 helper 参数中没有 terminalId，不能把固定 null 改成“真实值”就结束。`docs/api/console-ai-dev-spec-2026-08.md:146`；`services/api/src/ai/mock-interview.service.ts:404-424`

4. **S1 没有 19 条 capability seed 清单、旧 featureKey→新 key 映射和完整配置字段映射。** `docs/api/console-ai-dev-spec-2026-08.md:542-554`；`docs/api/console-ai-dev-spec-2026-08.md:1203-1212`

5. **S1 schema 还缺 active/canary FK、AiServiceLog 完整加列、PII policy、全局预算、合规规则和 feature flag 的存储契约。** `docs/api/console-ai-dev-spec-2026-08.md:244-247`；`docs/api/console-ai-dev-spec-2026-08.md:709`；`docs/api/console-ai-dev-spec-2026-08.md:811-822`；`docs/api/console-ai-dev-spec-2026-08.md:1173-1187`

6. **S1 无法决定同步 LlmConfigService 如何接异步数据库与多实例缓存失效。** `docs/api/console-ai-dev-spec-2026-08.md:552-554`；`services/api/src/ai/llm/llm-config.service.ts:266-333`

7. **S1 账本没有可实现的并发配额算法、release/commit CAS、重试和退款契约。** `docs/api/console-ai-dev-spec-2026-08.md:340-372`；`docs/api/console-ai-dev-spec-2026-08.md:906-918`

8. **S1 验收所称 5 个 active 能力与迁移批次没有权威清单，self-assessment 还隐式复用 resume optimizer。** `docs/api/console-ai-dev-spec-2026-08.md:1154`；`services/api/src/ai/resume/llm-self-assessment.service.ts:196-197`

9. **S2/S3 也会提前阻塞：审核状态机仍要求“开发时二选一”，并发验收没有 version 字段。** `docs/api/console-ai-dev-spec-2026-08.md:935-938`；`docs/api/console-ai-dev-spec-2026-08.md:1142`

**总判断：这份规格目前不能照着开工；必须先修正 S0 事实基线、19 条配置迁移清单与双写/回滚协议、账本并发算法、Qualification/发布双状态、Prisma 缺失关系和 API 错误/幂等/版本契约，修完后才能启动 S0、S1。**
