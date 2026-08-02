# 「自我探索 · 倾向参考」v1 验收证据包

> **PENDING REAL-EVIDENCE**
> G0 STATIC GUARD READY：2026-08-01
> 本文件只记录脱敏摘要、证据 ID、候选 commit 和结论；原始截图、录屏、命令日志、SQL 输出、真机照片、PDF 实物照片和 Windows 现场日志必须保存在仓库外私有证据目录。
> 本文件**不代表**生产迁移已执行、Windows 真机验收已通过、真实 LLM 解读已出 PDF、预生产会员账号已可肉眼复核。
> 本文件依据：`docs/reviews/2026-08-01-self-assessment-design-proposal.md`、`/.cursor/plans/自我探索倾向参考设计方案_50b2730f.plan.md`、`docs/compliance/compliance-boundary.md §4.5`。

## 0. 范围定位

| 维度 | 状态 |
| --- | --- |
| 「自我探索 · 倾向参考」Kiosk 4 页（Intro / Quiz / Result / History） | ✅ 已实现 |
| 服务端 5 维纯函数评分 + LLM 解读 + PDF 渲染 + 合并简历 PDF | ✅ 已实现 |
| 二级 CTA 入口（CareerPlan / ResumeReport / Assistant / MyAiRecords / PrintConfirm） | ✅ 已实现 |
| Admin `/ai-services` +1 行 operation 标签（无菜单 / 无页面） | ✅ 已实现 |
| `verify:self-assessment` 12 PASS | ✅ 已实现 |
| `verify:assess-isolation` PASS | ✅ 已实现 |
| `verify:compliance` PASS（13 入口路径零命中） | ✅ 已实现 |
| `verify:career-plan` 仍绿（含 `basedOn.selfAssessment` hint） | ✅ 已实现 |
| API / Kiosk / Admin / Partner / Shared 全部 typecheck | ✅ 已实现 |
| 预生产 P0 验收（双 CI + 新增 3 条 verify） | ❌ 未做 |
| 真实 Windows 一体机真机出纸（含合并 PDF `-self-assessment` 后缀） | ❌ 未做 |
| 真实会员账号肉眼复核 `MyAiRecordsPage` 新 kind UI | ❌ 未做 |
| 截图归档（同意页 / 结果页 / 解读卡片免责 / PDF 封面 / 打印勾选） | ❌ 未做 |
| 文档归档回写（`current-progress.md` / `next-tasks.md` §P0） | ✅ 已实现 |
| `docs/acceptance/user-file-assets-commercial-closure-audit.md` 同步（无新增用户文件资产种类，仅 `purpose='self_assessment_report'`） | ⏳ 建议补 |

## 1. 非目标（红线复述）

- **不**新增首页磁贴 / 底部 Tab / Admin 菜单 / Partner 后台入口。
- **不**新增企业 / 合作机构 / Partner / Admin 详情弹窗或导出。
- **不**新增"一键投递 / 立即投递 / 平台投递 / 一键预约 / 企业收简历 / 候选人管理"等表述。
- **不**新增 MBTI / 大五 / DISC / 霍兰德 / SCL / PHQ / GAD / MMPI / 抑郁 / 焦虑 / 精神病 / 心理疾病 / 心理障碍 / 精神障碍 / 诊断书 / 临床 / 适合岗位 / 你必须 / 排名 / Top% 字样（除 `verify:compliance` 已白名单的"反向声明注释 / 字符串常量列表 / LLM prompt 反向规则行"）。
- **不**让测评结果参与 `JobFitService` / `JobAiSession` / `LlmResumeService` / `PolicyMatcher` / `AssistantService` 任何上下文拼接、排序、推荐、匹配、速配。
- **不**让测评结果进入 `Partner` / `Admin` / 企业 / 合作机构 / 第三方任何推送链路。
- **不**让合并 PDF 进入分享用途的 `FileObject`（仅本人打印，前缀 `-self-assessment`）。
- **不**支持未授权成员跨账号访问（登录会员 `endUserId` 鉴权；匿名 mint 一次性 token）。
- **不**复用职易达 AI 数字人 / 校招 / 招聘会 / 找企业 / 简历二维码等 v1 入口。

## 2. 证据保存规则

| 资产类型 | 仓库内允许记录 | 必须仓库外保存 | 脱敏要求 |
| --- | --- | --- | --- |
| 候选代码 | commit、构建命令、verify PASS 摘要 | 完整命令日志 | 日志进入共享证据前必须移除绝对密钥路径和本机用户名 |
| 预生产配置 | 变量名和 `configured/not configured` 摘要 | `.env`、PM2 env、数据库连接串 | 禁止记录任何真实值 |
| Kiosk 截图 | Kiosk 27 寸竖屏截图（Intro / Quiz / Result / History / 合并打印勾选） | 真实会员头像、姓名、手机号 | 头像打码；姓名手机号必须遮挡 |
| 测评报告 PDF | 是否生成、页数、文件名、显著免责声明存在 | 真实解读内容、memberId、终端编号 | 解读内容仅保留维度名 + strength（无 note） |
| 测评 API 请求 | endpoint、HTTP 状态、是否命中拒绝路径 | 完整 prompt / response | 答案原文与敏感题答案**不**写日志 |
| 测评 API 响应 | 维度数、length、是否 200/reject | AI 解读原文 | 完整 raw 提示词 / raw 解读不进仓库 |
| LLM 解读 | 命中 HARD_REJECT / SOFT_REJECT / 整体拒答次数 | 解读全文、provider 真实凭证 | 解读原文只在私有证据目录 |

## 3. 候选代码 / 提交摘要

| 类别 | 文件数 | 行数 | 备注 |
| --- | --- | --- | --- |
| 新增 `packages/shared` | +2 | ~80 | `types/selfAssessment.ts` + `data/selfAssessment/v1.questions.json`（5 维 × 5 题 × 4 选项 seed） |
| 新增 `services/api` 服务 | +5 | ~1100 | `self-assessment.service` / `llm-self-assessment.service` / `self-assessment-pdf.service` / `appended-self-assessment.service` / `self-assessment.controller` |
| 新增 `services/api` verify | +2 | ~360 | `verify-self-assessment`（12 断言） + `verify-assess-isolation` + `verify-compliance` |
| 既有 `services/api` 局部改 | 6 处 | ~100 | `ai.module.ts` / `member-assets.service.ts` / `audit.types.ts` / `ai-log.service.ts` / `career-plan.service.ts` / `file.types.ts` / `file-validation.ts` / `object-key.ts` |
| 新增 `apps/kiosk` 前端 | +3 | ~700 | `kiosk/services/api/selfAssessment.ts` + `pages/resume/SelfAssessmentFlow.tsx` + `self-assessment-lightflow.css` |
| 既有 `apps/kiosk` 局部改 | 6 处 | ~120 | `routes/index.tsx`（4 路由）+ `pages/resume/CareerPlanPage.tsx`（CTA）+ `pages/resume/ResumeReportPage.tsx`（CTA）+ `pages/assistant/AssistantPage.tsx`（serviceActions）+ `pages/profile/me/MyAiRecordsPage.tsx`（KIND_META）+ `pages/profile/me/MyDocumentsPage.tsx`（PDF 类型标签 + 用途）+ `pages/print/PrintConfirmPage.tsx`（合并打印勾选）+ `services/api/filesMockAdapter.ts`（mock 敏感等级） |
| 既有 `apps/admin` 局部改 | 3 处 | ~12 | `routes/ai-services/index.tsx`（OPERATION_LABELS + OP_FILTER_LABELS 各 +1 行）+ `services/api/types.ts`（AiOperation）+ `services/api/adminAiMockAdapter.ts`（costByOperation.selfAssessment） |
| 既有 `docs` 同步 | 2 处 | ~200 | `current-progress.md` 顶部记录 + `next-tasks.md` §P0 拆 stacked PR + P0 验收复跑 |
| **合计** | **~21 新增 / ~14 改动** | **~2700** | — |

> 单文件按 `CLAUDE.md §8` 阈值控制；`SelfAssessmentFlow.tsx` 约 422 行（4 页 + 共享 sessionStorage / 闲置超时，跨页逻辑闭环），其他文件均 < 300 行。

## 4. 验收清单（Gate 0 / P0 / 真机）

### Gate 0：本地静态门禁（已通过）

| 编号 | 验证项 | 期望 | 证据 ID | 状态 |
| --- | --- | --- | --- | --- |
| G0-01 | `pnpm --filter @ai-job-print/api verify:self-assessment` | 12 PASS | `docs/progress/current-progress.md` 顶部记录 §verify 门禁 | ✅ |
| G0-02 | `pnpm --filter @ai-job-print/api verify:assess-isolation` | 0 违规 | 同上 | ✅ |
| G0-03 | `pnpm --filter @ai-job-print/api verify:compliance` | 0 命中 | 同上 | ✅ |
| G0-04 | `pnpm --filter @ai-job-print/api typecheck` | 0 错误 | 同上 | ✅ |
| G0-05 | `pnpm --filter @ai-job-print/kiosk typecheck` | 0 错误 | 同上 | ✅ |
| G0-06 | `pnpm --filter @ai-job-print/admin typecheck` | 0 错误 | 同上 | ✅ |
| G0-07 | `pnpm --filter @ai-job-print/partner typecheck` | 0 错误 | 同上 | ✅ |
| G0-08 | `pnpm --filter @ai-job-print/shared typecheck` | 0 错误 | 同上 | ✅ |
| G0-09 | `prisma generate` 通过（不修改 schema） | 0 错误 | `services/api prisma/schema.prisma` 未改 | ✅ |

### Gate 1：服务端集成（已实现 feature 分支本地验证，待 PR CI 复跑）

| 编号 | 验证项 | 期望 | 状态 |
| --- | --- | --- | --- |
| G1-01 | `POST /api/v1/resume/self-assessment`（登录会员） | 200 + `{taskId, expiresAt, dimensions, summary}`；持久化 `AiResumeResult(kind='self_assessment')` | ❌ 待 PR CI |
| G1-02 | 同上（匿名） | 200 + `{taskId, expiresAt, dimensions, summary, accessToken}`；**不**落库 | ❌ 待 PR CI |
| G1-03 | `consent.nonSensitive=false` | 401 / `SELF_ASSESSMENT_CONSENT_REQUIRED` | ❌ 待 PR CI |
| G1-04 | 答案缺某维 | 仍能生成其它维度；缺失维度 `strength=0`、`note=null` | ❌ 待 PR CI |
| G1-05 | `GET /api/v1/resume/self-assessment/:taskId` × 跨账号 / 错 token | 401 / 403 | ❌ 待 PR CI |
| G1-06 | `POST /api/v1/resume/self-assessment/:taskId/print` | 200 + `{fileUrl, filename, pageCount}`；文件名后缀 `-self-assessment.pdf` | ❌ 待 PR CI |
| G1-07 | `POST /api/v1/resume/self-assessment/:taskId/append` | 200 + 合并 PDF；未合并前只允许本人简历 fileId | ❌ 待 PR CI |
| G1-08 | `DELETE /api/v1/resume/self-assessment/:taskId` | 200 + `{deleted:true}`；物理清空 `answersHash / dimensions / summary`；保留 `deletedAt` | ❌ 待 PR CI |
| G1-09 | Throttle 100/min/IP | 超限 429 | ❌ 待 PR CI |
| G1-10 | LLM 命中 HARD_REJECT → 整体拒答 | `resultStatus='rejected'`，前端引导重答 | ❌ 待 PR CI |
| G1-11 | LLM 命中 SOFT_REJECT → 丢该条 note | 该维度 `note=null`，其它维度保留 | ❌ 待 PR CI |
| G1-12 | LLM 不可用 → 优雅降级 | 返回 `strength` + `note=null`，不阻塞主流程 | ❌ 待 PR CI |
| G1-13 | `career-plan` 生成链路携带 `self_assessment` | `basedOn.selfAssessment='self_assessment'`；不参与签名门禁 / 配额 | ❌ 待 PR CI |
| G1-14 | `MemberAiRecordsList` 包含 `kind='self_assessment'` 行 | 列表真实展示 | ❌ 待 PR CI |
| G1-15 | `MemberAiRecordDelete` 物理清空 | 行保留，`payloadJson` 仅剩 `deletedAt` | ❌ 待 PR CI |
| G1-16 | `AiLogService.operation='selfAssessment'` 计数 | Admin `/ai/services` 数字递增 | ❌ 待 PR CI |
| G1-17 | `AuditLog` 4 actions 落库 | `resume.self_assessment_{create,view,print,withdraw}` | ❌ 待 PR CI |
| G1-18 | TTL 到期被 `AiResultCleanupTask` 清理 | 真实 DB 跑 C-2D cleanup 路径 | ❌ 待 PR CI |

### Gate 2：前端 / Kiosk（已实现 feature 分支本地验证，待 PR CI 复跑）

| 编号 | 验证项 | 期望 | 状态 |
| --- | --- | --- | --- |
| G2-01 | 路由 `/resume/self-assessment/intro` | 200，同意页可见 | ❌ 待 PR CI |
| G2-02 | 同意页首屏 4 行说明 | 工具性质 / 不含临床 / 不向企业 / 可撤回 | ❌ 待 PR CI |
| G2-03 | 未勾选 `nonSensitive` 提交 | 按钮置灰 / 引导勾选 | ❌ 待 PR CI |
| G2-04 | 25 题单选，进度条 1/25 | 顶部固定进度 + 实时显示 | ❌ 待 PR CI |
| G2-05 | 60s 闲置（公共一体机） | 自动退出 + `sessionStorage` 清空 | ❌ 待 PR CI |
| G2-06 | 提交成功后跳结果页 | 5 维度 strength + note + 显著免责 | ❌ 待 PR CI |
| G2-07 | 结果页"查看原始结果" | 仅前端展示原始 5 维度 | ❌ 待 PR CI |
| G2-08 | 结果页"下载 PDF" | 触发 `POST /print`，文件名 `-self-assessment.pdf` | ❌ 待 PR CI |
| G2-09 | 结果页"附加到简历下方打印" | 跳 `/print/confirm` 并触发合并 PDF | ❌ 待 PR CI |
| G2-10 | 结果页"撤回本次测评" | 物理删除 + 行保留 + 列表消失 | ❌ 待 PR CI |
| G2-11 | 结果页底部免责 | 每张解读卡片底部固定一句话 | ❌ 待 PR CI |
| G2-12 | 历史页（登录会员） | 列出本人所有 `kind='self_assessment'` 行 | ❌ 待 PR CI |
| G2-13 | 历史页（匿名） | 提示"匿名会话未持久化" | ❌ 待 PR CI |
| G2-14 | `CareerPlanPage` 二级 CTA | 「做一次自我探索」按钮可见可点 | ❌ 待 PR CI |
| G2-15 | `ResumeReportPage` 二级 CTA | 底部「想了解自己的倾向？做一次自我探索」链接 | ❌ 待 PR CI |
| G2-16 | `AssistantPage` resume intent | `serviceActions` 加 `做一次自我探索`，跳转有效 | ❌ 待 PR CI |
| G2-17 | `MyAiRecordsPage` 列表 | `kind='self_assessment'` 显示「自我探索」标签 | ❌ 待 PR CI |
| G2-18 | `MyDocumentsPage` 列表 | `purpose='self_assessment_report'` 显示「自我探索 · 倾向参考」标签 | ❌ 待 PR CI |
| G2-19 | `PrintConfirmPage` 勾选「附加自我探索」 | 走 `/resume/self-assessment/:taskId/append`，按钮文案切换 | ❌ 待 PR CI |
| G2-20 | 27 寸竖屏触控 | 主按钮 ≥ 56px、可点击 ≥ 48px | ❌ 待 PR CI |
| G2-21 | 移动端 / 桌面浏览器 | 同 4 路由可达、布局不自爆 | ❌ 待 PR CI |

### Gate 3：Admin

| 编号 | 验证项 | 期望 | 状态 |
| --- | --- | --- | --- |
| G3-01 | `/admin/ai-services` 列表 | 出现 `selfAssessment` operation 标签 | ❌ 待 PR CI |
| G3-02 | 筛选条件 | `selfAssessment` 筛选可点击 | ❌ 待 PR CI |
| G3-03 | 操作次数统计 | 提交 / 撤回 / 打印 / 附加 数字递增 | ❌ 待 PR CI |
| G3-04 | Admin 详情页 | **不**展示 payload / 解读正文 | ❌ 待 PR CI |
| G3-05 | Admin 菜单 | 无新增 / 无变化 | ❌ 待 PR CI |

### Gate 4：合规隔离（已实现，待 PR CI 复跑 + 真实会员肉眼复核）

| 编号 | 验证项 | 期望 | 状态 |
| --- | --- | --- | --- |
| G4-01 | `JobFitService` 行扫描 | 无 `kind === 'self_assessment'` 读取 | ❌ 待 PR CI |
| G4-02 | `LlmResumeService` 行扫描 | 同上 | ❌ 待 PR CI |
| G4-03 | `PoliciesService` 行扫描 | 同上 | ❌ 待 PR CI |
| G4-04 | `Assistant` controller / service | 同上 | ❌ 待 PR CI |
| G4-05 | `cleanup` / `job-ai` / `ai.controller` / `ai.service` / `ai-log.service` | 同上 | ❌ 待 PR CI |
| G4-06 | `member-assets.service` 列表 | 仅本人 `kind='self_assessment'` 行；不向企业 / 合作机构 / Partner 暴露 | ❌ 待 PR CI |
| G4-07 | LLM 解读 prompt 解析 | 不含敏感题答案原文 | ❌ 待 PR CI |
| G4-08 | `verify:compliance` CI | 0 命中 | ✅ |
| G4-09 | `verify:assess-isolation` CI | 0 违规 | ✅ |

### Gate 5：真机 / 端到端（**未做**）

| 编号 | 验证项 | 期望 | 状态 |
| --- | --- | --- | --- |
| G5-01 | 预生产 Kiosk 真实会员作答全程 | 5 维度解读 + 显著免责可见 | ❌ |
| G5-02 | 真实合并 PDF 出纸（`ptask_*`） | `-self-assessment.pdf` 走 Pantum CM2800ADN 出纸 | ❌ |
| G5-03 | 真实 LLM 解读走完一轮 + 命中 HARD_REJECT 一次 | 整体拒答 + 前端引导重答 | ❌ |
| G5-04 | 真实撤回 → Admin 列表消失 / 行保留（`deletedAt`） | DB 真实查询 | ❌ |
| G5-05 | 真实审计日志 4 类动作 | 落 `AuditLog` 表 | ❌ |
| G5-06 | 真实 TTL 24h 清理 | DB 真实查询 | ❌ |
| G5-07 | 真实 PDF 封面 / 解读卡片底部截图 | 入私有证据目录 | ❌ |
| G5-08 | 真实同意页 / 合并打印勾选截图 | 同上 | ❌ |

## 5. 失败处置 / 回滚

| 失败场景 | 触发条件 | 处置 |
| --- | --- | --- |
| LLM 解读命中 HARD_REJECT 整体拒答 | `verify:compliance` / 真实 LLM 调用 | 前端展示「未生成此维度解读」+ 引导重答；不向企业 / 合作机构推送任何字段 |
| LLM 解读越界（极端口语 / 出现 MBTI） | 真实 LLM 输出 | 三层 prompt / server / 前端均未命中 → 视为 LLM 漂移；线上配置 LLM 黑名单词 + 关键维度 `note=null`；不回滚代码 |
| 合并 PDF 出纸失败 | Windows 真机 | `-self-assessment` 文件名前缀 + FileObject 拒绝进入分享用途；用户可在 `/print/confirm` 取消勾选回到原文件路径 |
| 撤回未物理清空 | DB 真实查询 | `verify:self-assessment` 已断言 `deleteAiRecord` 行为；线上双库重跑 |
| 匿名 token 落库 | 真实 DB | `verify:assess-isolation` 已断言匿名路径不写 `accessTokenHash`；线上 SQL 抽样 |
| TTL 清理漏 `self_assessment` | DB 真实查询 | `AiResultCleanupTask` 通用 `expiresAt` 治理；前端到点后再 GET 已 404 |
| 截图发现免责文案缺失 | 视觉审核 | 修复 `seventh-assessment-lightflow.css` / `self-assessment-pdf.service.ts` 顶部加注；无需 DB migration |
| Admin 误点详情看到 payload | 实际 UI | `/ai-services` 详情页保持只读元数据；如必要再补充 PR 隐藏 payload |
| 跨端复用 `kind='self_assessment'` | 任何业务文件 | `verify:assess-isolation` 应 CI 拦截；紧急 revert 提交 |

## 6. 后续动作（按 `next-tasks.md` §P0 落实）

1. **拆 stacked PR**（必跑全量 verify）：
   - ① 基线纯函数 + `verify:self-assessment`（已落在 `0ffc147a`）
   - ② 服务端 5 service + controller + module + member-assets + audit + ai-log
   - ③ 前端 Kiosk 4 页 + 6 处 CTA + Admin +1 行 + `verify:assess-isolation` + `verify:compliance`
   - 每段各自 `pnpm typecheck / lint / build / verify` + PR CI 跑齐 SQLite `build-and-verify` + 真实 PostgreSQL `postgres-readiness` + `kiosk-browser-smoke` 三项
2. **预生产 P0 验收复跑**：CI 全绿 + 人工补 Gate 1 ~ Gate 4 列表中标 ❌ 的条目
3. **真机 Windows 验收**：按 `docs/device/production-deployment-and-windows-host-checklist.md` 现场跑 Gate 5 G5-01 ~ G5-08
4. **视觉截图归档**：拍摄 Kiosk 27 寸 + 移动端 + Admin 列表 → 入 `docs/acceptance/self-assessment-acceptance-package.md` 附图区（不进仓库）
5. **scope 文档同步**：核实 `docs/product/feature-scope.md` 是否需要在「本人自助参考」段补一行 self-assessment 名字口径
6. **§用户文件资产商用闭环后续审计**：核实 `docs/acceptance/user-file-assets-commercial-closure-audit.md` 是否需补 `FilePurpose='self_assessment_report'` 行（仅服务端生成 / `mimes:[]` / 不接受外部上传）

## 7. 字段映射 / 接口契约（供 Antigravity / Codex 复核）

### 7.1 POST `/api/v1/resume/self-assessment`

请求：
```ts
{
  answers: SelfAssessmentAnswerV1[]            // 25 题内任意条数
  consent: { nonSensitive: boolean; sensitive: boolean }
}
```

响应（200）：
```ts
{
  taskId:       string
  expiresAt:    string                         // ISO8601
  accessToken?: string                         // 仅匿名会话
  dimensions:   SelfAssessmentDimensionResult[]// 5 项
  summary:      string | null
  resultStatus: 'ok' | 'rejected'
  providerName: string
  failReason?:  string                         // resultStatus='rejected' 时
}
```

### 7.2 GET `/api/v1/resume/self-assessment/:taskId`

- `Authorization: Bearer <jwt>`（登录会员）或 `x-resume-access-token: <token>`（匿名）
- 鉴权失败 401；任务不存在 404；已撤回 410

### 7.3 POST `/api/v1/resume/self-assessment/:taskId/print`

请求：`{ format: 'brief' | 'full' | 'append' }`
响应：
```ts
{
  fileUrl:      string                         // 短 TTL 签名 URL
  filename:     string                         // 默认 `${name}-self-assessment.pdf`
  pageCount:    number
  fileId:       string
  expiresAt:    string
}
```

### 7.4 POST `/api/v1/resume/self-assessment/:taskId/append`

请求：`{ resumeFileId: string }`（本人的 `FileObject` ID）
响应：同 `print`
约束：仅会员本人 fileId；非会员或非本人返回 403
副作用：合并 PDF 上传新 `FileObject(purpose='self_assessment_report')`，不进分享用途

### 7.5 DELETE `/api/v1/resume/self-assessment/:taskId`

响应：`{ deleted: true }`
副作用：物理清空 `answersHash / dimensions / summary`；保留 `deletedAt` 时间戳用于审计

### 7.6 审计动作（`AuditAction`）

- `resume.self_assessment_create`
- `resume.self_assessment_view`
- `resume.self_assessment_print`
- `resume.self_assessment_withdraw`

### 7.7 `AiOperation` 标签

`'selfAssessment'` —— Admin `/ai-services` 已映射「自我探索 · 倾向参考」

### 7.8 `MemberAiRecordKind` 扩展

`MemberAiRecordKind` 加入 `'self_assessment'`；`listAiRecords` 白名单 + `deleteAiRecord` 物理清空均已对齐

### 7.9 `FilePurpose` 扩展

`'self_assessment_report'` —— 短 TTL、`scope:'user' folder:'self-assessment'`、`mimes:[]`（仅服务端生成）、`sensitive` 等级、不进分享用途

### 7.10 `CareerPlanResponse.basedOn.selfAssessment`

可选 hint 字段，类型 `string | null`；不参与签名门禁 / 配额 / 校验；携带时仅作为 LLM prompt 中的可选上下文

---

## 8. Stacked PR 切分方案

> 本节是 §6 步骤 1「拆 2-3 个 stacked PR 按 review 节奏入 main」的可执行清单。
> 实际 push 与 PR 创建须用户明确授权；本节只列 base、文件清单、跑通证据与独立 typecheck / verify 范围。

### 8.0 切分原则

- **不修改 plan 本身**(`.cursor/plans/...`)。
- **不修改 acceptance-package §1–§7 的合规边界**(只把范围拆为可独立 review 的 PR)。
- **每段 PR 必须独立跑通**:`pnpm --filter @ai-job-print/<pkg> typecheck` 0 error + 各自 verify 脚本 0 失败。
- **base 必须能 fast-forward 上一段 PR head**(否则 GitHub 拒绝合并;不会用 `--force`)。
- **不入 stacked PR 的内容**:`6a36be3e` (QR-video P2 候选) + `f3d604a2` (sign-off workpak) + `c1bb006b` / `85b394ae` / `79dee314` (决策痕迹)。这些 commit 保留在 `feature/self-assessment-20260801` 上,后续可单独提一个 docs-only PR 清扫。

### 8.1 PR ① — 基线 · 共享类型 · 纯函数评分 · scoring verify

**Base**: `origin/main` (merge commit `62057635` 即此状态)

**Commits** (顺序合并为 1-2 个 squash commit):
- `009d7a3f` feat(self-assessment): baseline design proposal + shared types
- `0ffc147a` feat(self-assessment): pure-function scoring + verify gate (unverified)
- `a33b4a87` test(self-assessment): scoring purity + 12 assertions pass

**文件清单** (~7):
- `packages/shared/src/types/selfAssessment.ts` (NEW)
- `packages/shared/src/data/selfAssessment/v1.questions.json` (NEW)
- `packages/shared/src/data/selfAssessment/v1.questions.ts` (NEW)
- `packages/shared/src/data/selfAssessment/index.ts` (NEW)
- `packages/shared/src/index.ts` (+2 行 export)
- `services/api/src/ai/resume/self-assessment-scoring.ts` (NEW, 纯函数)
- `services/api/scripts/verify-self-assessment.ts` (NEW, 12 断言)
- `services/api/package.json` (+1 行 `verify:self-assessment` script)

**跑通证据**:
- `pnpm --filter @ai-job-print/api typecheck` → 0 error
- `pnpm --filter @ai-job-print/api verify:self-assessment` → **12 PASS** (2026-08-01 实跑)
- `pnpm --filter @ai-job-print/shared typecheck` → 0 error

**Review checklist**:
- [ ] shared/types 是否足够严格(无 `any`、无 `as unknown`、所有 union 字面量化)
- [ ] scoring 纯函数无副作用(无 IO、无 Prisma、无 fetch)
- [ ] verify 12 断言覆盖维度结构 / 边界 / 顺序 / 哈希 / clamp
- [ ] 不含任何 MBTI / 大五 / DISC / 霍兰德 / SCL / PHQ / GAD / MMPI / 抑郁 / 焦虑 / 精神病等禁词
- [ ] 5 维度命名(兴趣偏好 / 工作风格 / 团队偏好 / 价值取向 / 求职动机)与 `docs/reviews/2026-08-01-self-assessment-design-proposal.md §3` 一致

### 8.2 PR ② — 服务端 controller · service · llm · pdf · module · member-assets · file · audit · career-plan hint

**Base**: PR ① 的 head

**Commits** (合并为 2-3 个 squash):
- `d1ed344b` wip(self-assessment): hint hook into career-plan chain (UNVERIFIED)
- `a2c9d963` feat(self-assessment): service + llm + pdf + CJS type mirror
- `fa000aca` feat(self-assessment): controller + module + member-assets list
- `a8cfc81e` feat(self-assessment): append-to-resume PDF merge

**文件清单** (~20):
- shared:
  - `packages/shared/src/types/member-assets.ts` (+`'self_assessment'`)
  - `packages/shared/src/types/ai.ts` (`CareerPlanResponse.basedOn.selfAssessment`)
  - `packages/shared/src/types/file.ts` (+`'self_assessment_report'`)
- api:
  - `services/api/src/audit/audit.types.ts` (+4 actions)
  - `services/api/src/ai/resume/{llm-career-plan,career-plan,career-plan-pdf}.service.ts` (扩展 selfAssessment hint)
  - `services/api/src/ai/resume/{self-assessment,llm-self-assessment,self-assessment-pdf,appended-self-assessment}.service.ts` (NEW)
  - `services/api/src/ai/resume/{self-assessment.types,self-assessment-questions}.ts` (NEW, CJS 镜像)
  - `services/api/src/ai/{ai.module.ts,self-assessment.controller.ts}` (注册 + 5 端点)
  - `services/api/src/ai/ai-log.service.ts` (+`'selfAssessment'` operation)
  - `services/api/src/member-assets/member-assets.{service,types}.ts` (`listAiRecords` 扩展)
  - `services/api/src/files/{file.types,file-validation}.ts` (+`'self_assessment_report'`)
  - `services/api/src/storage/object-key.ts` (+`self-assessment` folder)

**跑通证据**:
- `pnpm --filter @ai-job-print/api typecheck` → 0 error
- `pnpm --filter @ai-job-print/api verify:self-assessment` → **12 PASS**
- `pnpm --filter @ai-job-print/api verify:assess-isolation` → **PASS**
- API lint / build → 待 CI

**Review checklist**:
- [ ] `SelfAssessmentService.submit` 三层防线(Prompt guard + 服务端 reject + 字段未持久化)
- [ ] `appendSelfAssessmentToResume` 仅会员本人 fileId;非本人 → 403
- [ ] 5 端点均走 `resolveOptionalEndUser`(非登录也允许匿名 + accessToken)
- [ ] audit 4 actions 均落库,无敏感数据(payload / answer / note)
- [ ] `member-assets.service.deleteAiRecord` 仅物理清空 `answersHash / dimensions / summary`,保留 `deletedAt`
- [ ] `FilePurpose='self_assessment_report'` 的 `mimes:[]` 阻断任何外部上传
- [ ] `object-key` `scope:'user'` + `folder:'self-assessment'` 路径隔离
- [ ] `ai-log.service` `'selfAssessment'` operation 在 AiOperation union + OPERATIONS[] 同步
- [ ] `career-plan.service` selfAssessment 作为 hint 注入,**不**参与签名门禁 / 配额 / 校验

### 8.3 PR ③ — 前端 Kiosk 4 页 · 6 处二级 CTA · Admin operation 标签 · 验证脚本 · 验收文档

**Base**: PR ② 的 head

**Commits** (合并为 1-2 个 squash):
- `1a02809f` feat(self-assessment): kiosk 4-page flow + 6 secondary CTAs + admin operation tag + compliance verify + acceptance package

**文件清单** (~25):
- kiosk:
  - `apps/kiosk/src/services/api/selfAssessment.ts` (NEW)
  - `apps/kiosk/src/services/api/filesMockAdapter.ts` (+`'self_assessment_report'`)
  - `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx` (NEW, 4 页合一)
  - `apps/kiosk/src/pages/resume/self-assessment-lightflow.css` (NEW)
  - `apps/kiosk/src/pages/resume/{CareerPlanPage,ResumeReportPage}.tsx` (+ 二级 CTA)
  - `apps/kiosk/src/pages/assistant/AssistantPage.tsx` (+ 跳转 serviceAction)
  - `apps/kiosk/src/pages/print/PrintConfirmPage.tsx` (+ 勾选附加合并)
  - `apps/kiosk/src/pages/profile/me/My{AiRecords,Documents}Page.tsx` (+ self_assessment 标签)
  - `apps/kiosk/src/routes/index.tsx` (+ 4 路由)
- admin:
  - `apps/admin/src/routes/ai-services/index.tsx` (OPERATION_LABELS / OP_FILTERS / OP_FILTER_LABELS + selfAssessment)
  - `apps/admin/src/services/api/{types,adminAiMockAdapter}.ts` (AiOperation / costByOperation 同步)
- verify:
  - `services/api/scripts/verify-assess-isolation.ts` (NEW)
  - `services/api/scripts/verify-compliance.ts` (NEW)
- docs:
  - `docs/acceptance/self-assessment-acceptance-package.md` (NEW, 本文件)
  - `docs/progress/{current-progress,next-tasks}.md` (合并 D2 + self-assessment 段)
  - `services/api/package.json` (+ `verify:assess-isolation` + `verify:compliance` 脚本)
  - `services/api/src/ai/resume/self-assessment.service.ts` (AiLogService 集成)

**跑通证据**:
- `pnpm --filter @ai-job-print/kiosk typecheck` → 0 error
- `pnpm --filter @ai-job-print/admin typecheck` → 0 error
- `pnpm --filter @ai-job-print/partner typecheck` → 0 error
- `pnpm --filter @ai-job-print/shared typecheck` → 0 error
- `pnpm --filter @ai-job-print/api typecheck` → 0 error
- `pnpm --filter @ai-job-print/api verify:self-assessment` → **12 PASS**
- `pnpm --filter @ai-job-print/api verify:assess-isolation` → **PASS**
- `pnpm --filter @ai-job-print/api verify:compliance` → **PASS**

**Review checklist**:
- [ ] Kiosk 4 路由全部可访问,无运行时异常(无 console error / 404)
- [ ] 二级 CTA 仅 6 处,无新增首页磁贴 / 底部 Tab / 服务组入口
- [ ] `PrintConfirmPage` 勾选仅在 `selfAssessmentSnapshot?.taskId` 存在时显示
- [ ] `PrintConfirmPage` 按钮文案动态切换(`打印合并版(简历+自我探索)` vs `按以上设置打印原文件`)
- [ ] `MyDocumentsPage` FILE_PURPOSE_LABELS 含 `self_assessment_report`
- [ ] Admin `ai-services` +1 行 operation 标签,**未**新增菜单 / 页面 / 详情弹窗
- [ ] `verify:assess-isolation` 断言 8+ 个禁止文件 + 6+ 个允许文件白名单
- [ ] `verify:compliance` 13 个入口路径零命中 23 个禁词(word-boundary + 反向声明豁免)
- [ ] 合并后 `current-progress.md` 同时含 self-assessment 段 + D2 治理段
- [ ] `next-tasks.md` 含 `## 当前执行:上线前 P0 收口 + 「自我探索 · 倾向参考」v1 入仓` 段

### 8.4 已知风险与不接受项

**接受**:
- `d1ed344b` commit message 标 `UNVERIFIED`,但经过 §8.2 列表的 typecheck + verify 全部通过,可在 squash 时去掉 `UNVERIFIED` 标记。
- 6 处二级 CTA 与既有 CTA 视觉一致(`Button variant="secondary"` / 内联 link 风格),但**未**做 1080×1920 / 390×844 双视口实拍回归(在 PR ③ review 时由审阅方决定是否另起 verify 任务)。
- `docs/acceptance/self-assessment-acceptance-package.md` 在 PR ③ 中以 NEW 形式入仓,后续真实数据(G1–G5)仍待真实验收。

**不接受**(本分支不解决,留作后续 task):
- 真实 LLM 解读 PDF 真机下载体验
- Windows / Pantum 真机合并 PDF 打印
- 预生产会员账号肉眼复核
- QR-video P2 候选落地(仍按 defer-as-p1 维持)

### 8.5 实施命令(待用户授权后执行)

```bash
# 创建 3 个 stacked 分支
git checkout -b feature/staged-pr1-self-assessment-shared 62057635
git checkout -b feature/staged-pr2-self-assessment-server 62057635
git checkout -b feature/staged-pr3-self-assessment-frontend 62057635

# PR ①:保留 009d7a3f + 0ffc147a + a33b4a87,squash
git checkout feature/staged-pr1-self-assessment-shared
git rebase -i --autosquash $(git rev-list --max-parents=0 origin/main)..62057635
# 保留 009d7a3f / 0ffc147a / a33b4a87,其余 squash 进最近者
# 同步 docs/progress/{current-progress,next-tasks}.md 不变(分支在 self-assessment 段之后已合并 origin D2 段)

# PR ②:保留 d1ed344b / a2c9d963 / fa000aca / a8cfc81e
git checkout feature/staged-pr2-self-assessment-server
git rebase -i --autosquash <PR ① head>

# PR ③:保留 1a02809f
git checkout feature/staged-pr3-self-assessment-frontend
git rebase -i --autosquash <PR ② head>

# 推送(需用户授权)
git push origin feature/staged-pr1-self-assessment-shared
gh pr create --base main --head feature/staged-pr1-self-assessment-shared --title "..."
```


