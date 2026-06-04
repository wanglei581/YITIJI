# 第三方招聘链接 AI 企业信息参考 / 风险提示（设计文档）

> 创建：2026-06-04　|　状态：设计稿（实现前定稿，未写功能代码）
> 关联：[CLAUDE.md §2/§10/§18](../../CLAUDE.md) · [compliance-boundary.md](../compliance/compliance-boundary.md) · [kiosk-login-center.md](./kiosk-login-center.md) · [kiosk-cloud-agent-launch-checklist.md](../deployment/kiosk-cloud-agent-launch-checklist.md)
> 评审来源：2026-06-04 七专家并行评审（架构/Agent/后端/前端UX/合规/QA/进度），结论与设计依据见 [next-tasks.md](../progress/next-tasks.md) 同期记录。

---

## 0. 一句话定位

用户在第三方平台看到岗位 → **手机扫一体机二维码 → 在手机上提交该岗位链接 → 一体机自动收到 → 后端抓取公开信息 → AI 输出「企业信息参考 / 求职风险提示」**。

这是「第三方信息入口 + AI 求职服务」，**不是**招聘闭环、不投递、不收简历、不做企业认证或背调。

---

## 1. 合规红线（最高优先，开发全程不可越界）

### 1.1 命名白名单（只能用）

- 企业信息参考
- 公开信息分析
- 求职风险提示
- 求职避坑参考

### 1.2 命名黑名单（禁止出现在任何文案/字段/接口名）

- 推荐投递 / 帮你投递 / 一键投递 / 立即投递 / 平台投递
- 企业背调 / 企业背调保证 / 资信认证 / 企业资质核验 / 信用评级 / 官方认证企业

### 1.3 强制免责声明（必须随每次 AI 输出展示，落入 `complianceCopy.ts` SSOT）

> 以下内容由 AI 基于用户提供链接及公开信息生成，仅供求职参考，不构成投递建议、录用承诺或企业信用保证。请以官方渠道核实。

### 1.4 数据与输出口径

- 只抓取**公开或已授权**的展示信息，遵守目标站点 robots / ToS；**不抓登录墙/付费墙后的非公开数据**。
- **不长期存储第三方完整页面**；抓取正文仅作为本次分析输入，短 TTL 后清理。
- AI **不得输出绝对结论**（如「这家是骗子，别去」「保证靠谱」），一律用风险**提示**口径（info / 关注 / 警示三级）。
- **不形成企业评分库对外提供，不回流给企业**，不记录可标识求职者个人偏好画像。
- 与 §18 一致：本功能不接收简历、不同步候选人数据、不提供筛选/面试/Offer。

---

## 2. 结论：是否适合现在做

**适合做 P0 设计 + P1 最小实现，但不应作为「上线首发」的关键路径，须挂在已有阻塞项之后并行推进。**

理由（取自七专家评审）：

- 合规专家：功能本身**不踩红线**，只要遵守 §1。是「第三方信息入口 + AI 服务」的合法延伸。
- 后端专家：抓取 + AI 分析在服务端实现，技术上可行；**但真实 AI Provider 全部为 stub（NotImplementedException），只有 mock 可用**——本功能依赖真实 LLM，必须先接通至少一个真实 Provider。
- UX 专家：一体机触控现实下，**手机扫码回传（方案B）** 体验与第三方登录墙兼容性最佳；粘贴绝不能作为主路径。
- 进度/架构专家：当前真实上线阻塞项（PostgreSQL 迁移、求职者登录后端、扫描真机、AI Provider 接通）优先级高于本功能。本功能可在 AI Provider 接通后并行开发。

**前置依赖（必须先满足才能真正可用）：**

1. 接通至少一个真实 AI Provider（当前 `services/api/src/ai/providers/*.stub.ts` 全抛 NotImplemented；`AI对话` 已走真实 OpenAI 兼容接口，可复用 `LlmConfigService`/`llm-chat.service.ts` 的凭证与调用骨架）。
2. （若需登录态保存历史）求职者登录后端端点 —— 见登录中心待办。**P1 可先做免登录的一次性会话分析，不依赖登录。**

---

## 3. 方案对比（三选一）

| 维度（10 分制） | A 一体机大输入框粘贴/输入 | B 手机扫码回传链接 | C Kiosk 内置浏览第三方页 |
|---|---|---|---|
| 一体机触控体验 | 6（屏上键盘逐字输长 URL 很痛苦） | **9**（一体机零输入，手机端自然粘贴） | 3（触屏滚动/登录第三方页极差） |
| 实现复杂度（低=易） | **8**（纯前端输入框） | 5（需二维码 + 会话回传通道，可复用扫码上传/登录承接端） | 2（内置浏览器/iframe + 跨域 + 登录态） |
| 合规风险（高=安全） | 8 | **8** | 3（内置代访问/抓取逼近灰区） |
| 稳定性 | 8 | 7 | 2（第三方页改版即崩） |
| 第三方反爬/登录墙兼容 | 7（靠用户自带链接） | **9**（用户已在手机端登录，看到/回传的就是其有权访问的真实页） | 2（iframe 被 X-Frame-Options 拒，过不了登录墙） |
| 上线速度 | **9**（最快） | 6 | 1 |

**结论：B 为目标主路径，A 为兜底（屏上键盘 readOnly 输入），C 直接否决。**

---

## 4. 推荐方案

**主路径 = 方案 B（手机扫码回传）+ 兜底 = 方案 A（大输入框 + 自绘屏上键盘）。**

入口页并列两种方式：
- 上方「手机扫码回传链接」：一体机展示二维码 → 手机打开 H5 → 粘贴/分享岗位链接 → 提交 → 一体机自动收到。
- 下方「或手动输入链接」：大输入框，`readOnly` + 自绘含字母/数字/符号的屏上键盘（复用 `KioskNumPad` 思路），**绝不唤起系统键盘**（CLAUDE.md §17）。

**严禁把系统剪贴板「粘贴」作为主路径**（一体机无自然剪贴板，§17）。

### 4.1 端到端数据流（主路径 B）

```
[一体机] 创建分析会话 ──POST /job-link/sessions──▶ {sessionId, handoffToken(短期), qrUrl}
   │ 渲染二维码（qrUrl = H5地址?token=handoffToken）
   │ 开始轮询 GET /job-link/sessions/:id
   ▼
[手机H5] 打开 qrUrl → 粘贴岗位链接 → POST /job-link/sessions/:id/submit {url, token}
   │ 后端校验 token + URL 白名单/格式 → 写入会话 → 触发分析任务
   ▼
[后端] 抓取公开正文（超时/robots/UA）→ 正文提取 → 调真实 LLM（结构化 schema）
   │ 落 JobLinkAnalysis（含短 TTL）→ 审计
   ▼
[一体机] 轮询到 status=done → GET /job-link/analyses/:id → 渲染「企业信息参考/风险提示」+ 免责声明
```

### 4.2 兜底（A）

无手机/不便扫码：屏上键盘输入 URL → `POST /job-link/analyses`（直接提交，不经会话）→ 轮询结果。

### 4.3 抓取失败兜底（关键）

第三方登录墙/反爬/403/超时是常态，必须优雅降级，**不可静默失败**：

1. 抓不到正文 → 明确提示「无法访问该页面正文（可能需要登录或对方限制访问）」。
2. 提供两条恢复路径：
   - 「手机端把岗位**文字内容**复制回传」（H5 文本框，比 URL 更可靠）；
   - 仅基于 **URL 域名 + 公开工商信息**做有限分析，并在结果里标注 `confidence: low` 与「仅基于域名/公开登记信息」。
3. 永远展示免责声明。

---

## 5. API 设计（`/api/v1`，命名遵守 §1 黑名单）

> 命名一律用 `job-link` / `analysis`，禁止 `apply`/`deliver`/`background-check`。

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| POST | `/api/v1/job-link/sessions` | 一体机创建扫码会话，返回 `sessionId`+`handoffToken`+`qrUrl` | 终端/匿名（限流） |
| GET | `/api/v1/job-link/sessions/:id` | 一体机轮询会话是否已收到链接 | 同上 |
| POST | `/api/v1/job-link/sessions/:id/submit` | 手机 H5 提交链接（校验 `handoffToken`），触发分析 | token 校验 |
| POST | `/api/v1/job-link/sessions/:id/submit-text` | 手机 H5 回传岗位**文字**（抓取失败兜底） | token 校验 |
| POST | `/api/v1/job-link/analyses` | 直接提交 URL 分析（方案 A 兜底路径） | 匿名（限流） |
| GET | `/api/v1/job-link/analyses/:id` | 轮询/获取分析结果 | 创建者会话 |

安全要求（沿用既有模式）：

- `handoffToken`：短 TTL（如 10 分钟）、一次性、与 `sessionId` 绑定、限流，防他人猜测向会话注入链接。
- 提交 URL 做**协议白名单**（仅 http/https）+ 长度限制 + **SSRF 防护**（拒绝内网/本地地址，复用 files 模块 SSRF 思路）。
- 全端点限流（参考 `print/jobs` 的 IP 限流），抓取并发与频次限制。
- 凭证（如 LLM key）只在服务端，复用 `secret-cipher.ts` / `LlmConfigService`。
- DTO 全局 `whitelist + forbidNonWhitelisted`，禁止候选人/简历字段注入。

---

## 6. 数据模型（Prisma，新增 `JobLinkAnalysis` + `JobLinkSession`）

> 待 PostgreSQL 迁移就绪后落库；字段遵守「不长期存第三方完整页面 + 短 TTL + 不存 PII」。

```prisma
model JobLinkSession {
  id            String   @id @default(cuid())
  handoffToken  String   @unique          // 一次性短期 token（hash 存储更佳）
  status        String   @default("waiting") // waiting | received | expired
  submittedUrl  String?                    // 手机回传的链接
  analysisId    String?                    // 关联分析
  createdAt     DateTime @default(now())
  expiresAt     DateTime                   // 短 TTL（如 10min）
  @@index([expiresAt])
}

model JobLinkAnalysis {
  id            String   @id @default(cuid())
  sourceUrl     String
  sourceHost    String                     // 仅域名，便于统计/风控
  fetchStatus   String                     // ok | login_wall | blocked | timeout | error
  status        String   @default("pending") // pending | analyzing | done | failed
  riskLevel     String?                    // info | attention | warning（整体）
  resultJson    String?                    // 结构化 AI 输出（见 §7）
  confidence    String?                    // low | medium | high
  errorCode     String?
  createdAt     DateTime @default(now())
  expiresAt     DateTime                   // 短 TTL，cron 清理（参考 AiResultCleanupTask）
  @@index([expiresAt])
  @@index([sourceHost])
}
```

- **不**存储抓取到的完整页面正文（仅作为内存中的分析输入用后即弃；若必须临时落盘，单独短 TTL + 审计）。
- 复用现有每小时 cron 清理模式（`files.cleanup.task.ts` / `ai-result.cleanup.task.ts`）按 `expiresAt` 硬删。
- 审计：提交、抓取结果、分析完成各写 `AuditLog`（仅元数据 + sourceHost，不记完整正文/PII）。

---

## 7. AI 输出结构（强制 schema，LLM 必须按此返回）

```jsonc
{
  "companyName": "string｜null",
  "summary": "对岗位/企业公开信息的中性概述",
  "basics": [                       // 可得的公开基本信息，缺则省略，标 source
    { "label": "成立时间", "value": "...", "source": "公开登记｜页面" }
  ],
  "riskFlags": [                    // 风险「提示」，非结论
    { "level": "info|attention|warning", "title": "...", "detail": "...", "basis": "依据（公开信息/常识规则）" }
  ],
  "questionsToAsk": ["面试/沟通时建议向企业核实的问题"],
  "checklist": ["求职避坑核对清单项"],
  "confidence": "low|medium|high",
  "sourcesUsed": [ { "type": "page|registry|domain", "note": "..." } ],
  "disclaimer": "见 §1.3，由后端注入固定文案，不由模型自由发挥"
}
```

约束：
- `disclaimer` 由后端用 `complianceCopy.ts` 常量**强制注入/覆盖**，不信任模型自填。
- system prompt 内置 §1 合规红线（参考 `llm-config.service.ts` 已有合规注入），禁绝对结论、禁投递引导、禁认证背书。
- 模型不可访问外网时，仅基于传入正文/域名分析；正文为空 → `confidence: low` + 仅域名口径。

---

## 8. 前端页面（apps/kiosk，触控规范 ≥56px 主按钮 / ≥48px 可点区）

| 路由 | 页面 | 要点 |
|---|---|---|
| `/job-link` | 入口：扫码二维码（主）+ 屏上键盘输入（兜底） | 二维码大、说明清晰；输入框 `readOnly` 自绘键盘 |
| `/job-link/:id` | 分析进行中 / 结果页 | 加载态、风险三级色（info 蓝 / attention 橙 / warning 红）、免责声明常驻、抓取失败恢复引导 |

- 复用共享 `LoadingState/EmptyState/ErrorState`；进度页接 `setBusy(true)` 防 120s 空闲被自动登出（与登录中心 IdleLogoutGuard 联动）。
- 入口可放在「岗位信息」区与 AI 助手快捷操作中（白名单路由 `/job-link`）。
- H5 回传页可作为 kiosk 之外的轻量页面（或临时托管 H5），只含「粘贴链接/文字 + 提交」，无登录要求。

---

## 9. 分阶段实施计划

### P0 — 设计与数据流（本文件即交付物）

- [x] 页面流程（§4、§8）
- [x] API 设计（§5）
- [x] 数据模型（§6）
- [x] 合规文案 + 命名红线（§1，待并入 `complianceCopy.ts` SSOT）
- [x] AI 输出结构（§7）
- [x] 错误兜底（§4.3）
- [ ] 合规文案常量正式落 `packages/shared/src/types/complianceCopy.ts`（实现首步）

### P1 — 最小可用实现（依赖：真实 AI Provider 已接通）

- Kiosk `/job-link` 入口页（二维码 + 屏上键盘兜底）+ 结果页
- 手机回传 H5（提交链接 / 提交文字两种）
- 后端 `/job-link/sessions*` + `/job-link/analyses*` 端点 + DTO 校验 + 限流 + SSRF 防护
- 后端公开页面抓取 + 正文提取（超时/robots/UA/失败降级）
- AI 分析接口（结构化 schema，复用真实 LLM 调用骨架）
- `JobLinkAnalysis`/`JobLinkSession` 落库 + 短 TTL cron 清理
- 审计日志（提交/抓取/完成，仅元数据 + sourceHost）
- 结果页：风险三级、免责声明、抓取失败恢复路径
- 验证：URL 白名单/SSRF 负向、登录墙降级、token 防注入、TTL 清理、典型站点抓取成功/失败回归集

### P2 — 增强

- 企业公开信息源增强（接公开工商/经营异常等合法数据源，叠加可信度）
- 历史记录（依赖登录态；免登录默认不留长期历史）
- 风险规则库（可配置的提示规则，沉淀避坑常识）
- 管理后台查看调用量（仅元数据：次数/域名分布/失败率，复用 AI usage 模式）
- 失败页面截图/文本手动补充通道

---

## 10. 实现节奏

1. 本设计文档定稿（本步）。
2. 先满足前置：接通真实 AI Provider（必需）。
3. 先做 `complianceCopy.ts` 合规文案常量 → 再做后端端点/抓取/AI → 再做 Kiosk 页面 + H5。
4. 每完成一阶段，更新 [current-progress.md](../progress/current-progress.md) 与 [next-tasks.md](../progress/next-tasks.md)。
5. 分支：从 main 开 `feature/job-link-risk-analysis`（禁止在 main 直接提交）。
