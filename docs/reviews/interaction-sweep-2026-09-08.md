# 交互走查 2026-09-08

> **截图说明**：本次共产出 189 张（每步一张）。仓库内只保留 **18 张**：每条旅程的首尾各一张 + 三个缺陷的证据图，避免把 58MB 二进制永久写进 git 历史。全量截图留在走查机 `/tmp/sweep-full/ai-resume/`，需要复看请重跑 spec：
> `node node_modules/@playwright/test/cli.js test tests/interaction/ai-resume-journey.spec.ts --config playwright.interaction.config.ts`

产品负责人指令：用模拟数据，模仿人的操作，把每个页面每个按钮真点一遍。  
各包**追加自己的节**，不要覆盖别人的节。

**数据来源（全文件有效）**：本地隔离 SQLite `services/api/prisma/sweep.db` + 本地 API `http://127.0.0.1:3010/api/v1` + 本地一体机 `http://127.0.0.1:5273`。`AI_PROVIDER=mock`、`SMS_PROVIDER=log` 是服务端配置，不是前端假数据。  
**这不是线上验收证据。** 部署清单第四章「线上业务走查」条目不因本文件打勾。

---

## 包 Q-AI · AI 简历与我的

**判定：PARTIAL。** 模拟走查证明：诊断 / 优化对照 / 生成 / 「我的」登录门与会员记录的按钮接线对、文案不越界、删除不留幽灵。  
**不证明**真实 LLM、真实会员账号、真实打印机、真实短信通道下也对。清单 §4.1 / §4.2 **不得勾成完成态**，只能记「模拟走查 PASS / 真实走查待产品负责人给账号与内容」。

未使用 `ApiRouter` 桩，也没有伪造服务端成功响应。会员登录验证码来自本机 Redis `member:sms:code:*`（`SMS_PROVIDER=log` 写入），**不是桩**。

### 覆盖摘要

| 项 | 值 |
|---|---|
| 旅程 | 7（J1 匿名、J2 匿名、J3 匿名、J4×3 匿名资产页、会员闭环） |
| 路由（去 query） | 22 条，见下方 |
| 操作记录 | 160 步；其中真正操作 151，旅程内刻意跳过 9 |
| 死控件（四观测量全无变化且非 disabled） | 2，**均为假阳性**（见下） |
| 合规禁词 | 0（「一键投递 / 立即投递 / 平台投递」） |
| 生产访问 | 0（`zyidai.cn` / `120.48.13.190` 已在 context 层拦截） |
| 截图 | 189 张，`docs/reviews/interaction-sweep-2026-09-08/ai-resume/<journey>/`（最终有效批次 2026-09-08 00:54–00:57） |
| 原始四观测量 | `docs/reviews/interaction-sweep-2026-09-08/ai-resume/operations.jsonl` |

复跑：

```bash
cd apps/kiosk
node node_modules/@playwright/test/cli.js test tests/interaction/ai-resume-journey.spec.ts --config playwright.interaction.config.ts
```

每条旅程 `browser.newContext()`，不复用 page。从首页点进去，不 `goto` 中间步骤（会员登录后若整页刷新会清掉内存会话，脚本已改为点底栏回首页）。

### 正常（接线对、文案诚实）

**J1 匿名诊断闭环**（首页 → `AI 简历服务` → `AI简历诊断` → 上传 `valid-2p.pdf` → 填目标岗位 / 行业 / 经验 / 场景 → `开始 AI 诊断` → 报告页）

- 上传：`POST /api/v1/files/kiosk-upload` 后 `GET /files/{id}/content`。与主持人已验上传链路一致。
- 报告页能读出 mock 诊断结构（6 维、问题证据、演示样本正文）。导出 PDF / 导出修改清单均 `POST /api/v1/resume/records/{taskId}/export`，DOM 出现「诊断报告 PDF 已生成 / 修改清单 PDF 已生成」，游客文案「登录后可存我的文档，本次可扫码带走」。
- 「生成二维码带走」在导出后可点，拉文件 content。
- 「查看优化建议」进入 `/resume/optimize`。
- 匿名报告明确是演示内容（`providerName=mock`），不是上传 PDF 的真实解析——这是本地 `AI_PROVIDER=mock` 的预期，前端没有拿假成功遮过去。

**J2 匿名优化与导出**

- 对照页「用改写 / 保留原文 / 下一条」均引起 DOM 变化。
- 回优化页出现「对照页有 N 条裁决」弹层：`应用到编辑区` 与 `暂不应用` 两条分支都走过。
- 四种格式均走「导出前核对事实」勾选 → `确认导出` → `POST /api/v1/resume/generate/export`。PDF 随后 `GET /files/{id}/content` 打开预览；Word / TXT / Markdown 导出后 DOM 变化（预览以 PDF 为主，与页面说明一致）。

**J3 匿名生成**

- `简历生成` → 填姓名「测试用户」、电话 `13800000000`、目标岗位、教育 / 经历 → `生成我的简历` → `POST /api/v1/resume/generate` → `/resume/generate/preview`。
- 导出前事实核对 → `POST /api/v1/resume/generate/export` → 文件 content 200。

**J4 匿名「我的」三页**（每页独立 context：首页 → 底栏「我的」→ 入口）

- `/me/ai-records`、`/me/resumes`、`/me/documents` **登录门均在**，文案写清「仅本人可见 / 登录后才能跨会话找回」，游客出口「手机号登录 / 去打印扫描 / 查看岗位」都能点走。
- 进入资产页时 **没有** 打 `/api/v1/me/*`（客户端 fail-closed）。与发布 lane 对 §4.1 游客资产页「0 条调用」的口径一致（本包是本地，不是线上证据）。

**会员闭环**（真短信 log，非桩）

- 首页「登录后查看本人记录」→ 勾选协议 → 虚拟键盘输入 `13800000000` → `获取验证码`（`POST /member/auth/sms-code`）→ Redis 读码 → `验证并登录`（`POST /member/auth/login`）。
- 首次诊断弹出「确认使用简历 AI」，`同意并继续` 发 `POST /api/v1/me/ai-consents`。
- `/me/ai-records` 出现 **2** 条：简历优化 + 简历诊断（`GET /me/ai-records` 等，已完成 2）。
- 删除优化记录：`DELETE /me/ai-records/{id}`，列表变为 1 条（诊断还在），顶栏 toast「记录已删除」，**没有幽灵优化条目**。
- `/me/resumes` 出现 1 条上传诊断简历。
- `/me/documents` 出现上传原件 `valid-2p.pdf`；删除后空态「还没有文档」，**没有幽灵文件**。

**合规**：全程未出现禁词。游客 / 会员提示都把「不投递、不进企业简历库」说清楚。

### 缺陷与问题（发现即记录，本包不修）

#### D1. 登录会员导出优化稿必定 400，「我的文档」当然看不到 —— 上线阻塞（已定位，已修）

> **2026-09-08 更正**：本条初记为「导出成功但文档列表看不到」，**标题与结论都错了**。
> 导出根本没成功。下面是复盘后按数据库与源码重定的根因，原文保留在末尾「初记原文」以便追溯。

- **路由**：`/resume/optimize` → `/me/documents`
- **控件**：优化页「确认导出」；「我的文档」列表
- **期望**：§4.2「简历优化 → 导出 PDF → 我的文档可见」
- **实际**：会员点「确认导出」→ 后端返回 `400 RESUME_FACTS_NOT_CONFIRMED`，**不写文件、不写审计**，
  所以「我的文档」里只有上传原件 `valid-2p.pdf`。**匿名用户不受影响**。
- **影响面**：所有登录会员的「简历优化导出」**100% 失败**，无一例外。
  `ResumeGeneratePreviewPage` 走同一适配层方法，同样受影响。

**根因（三段证据，均可复核）**

1. 后端闸门 `services/api/src/ai/resume/resume-draft.store.ts` `assertFactsConfirmed`：
   `if (!input.endUserId || !input.taskId) return` —— **匿名早返回不校验**；
   登录会员且 optimize 行未过期时，`factsConfirmedAt` 缺失即抛 `400 RESUME_FACTS_NOT_CONFIRMED`。
2. DTO `services/api/src/ai/dto/resume-generate.dto.ts:215-216` **早已收该字段**
   （`@IsOptional() @IsISO8601({ strict: true })`），`forbidNonWhitelisted` 不会拒它。
3. 前端适配层 `apps/kiosk/src/services/api/aiHttpAdapter.ts` 的 `exportGeneratedResume`
   **故意不发这个字段**，理由写在一条**已经过期**的注释里：「DTO 尚无该字段（包 H）」。
   包 H 之后 DTO 补上了，注释没跟着改。调用侧 `ResumeOptimizePage.runResumeExport(factsConfirmedAt)`
   本来就把值传下来了，在适配层被丢掉。
   **同一文件里的兄弟方法 `exportResumeRecord` 是对的**，它照常转发该字段 —— 一对一的反证。

**走查数据佐证**（`services/api/prisma/sweep.db`，本地夹具库）

| 事实 | 数值 |
|---|---|
| `optimized` 类导出文件 | 12 条，`endUserId` 全为 NULL（都是匿名旅程产出） |
| 带会员 id 的文件 | 仅 1 条，是上传原件，不是导出稿 |
| 会员旅程审计序列 | `file.upload` → `parse_submitted` → `optimize_requested` → `ai_record_delete` → `file.delete` |
| 会员旅程的 `resume.generate_exported` | **0 条**（点过「确认导出」，POST 也发了，但没有成功审计） |
| `BenefitGrant` 表 | 0 行 —— 排除「权益不足」这一路解释 |
| `UserAiConsent` | 会员在 16:57:26 已有有效 `resume_ai` 同意 —— 排除「同意缺失」这一路解释 |

**为什么走查当场没看出来**：匿名旅程导出 12 次全成功，会员旅程只跑了 1 次；
四观测量只记 method+path 不记状态码，400 和 200 在日志里长得一样。
**这类只打登录态、匿名全绿的缺陷，靠「点一遍」发现不了**，必须比对后端落库。

- **修复**：适配层补发该字段 + 新增门禁 `verify:resume-export-facts-contract` 防回归。**后端未改动**（后端是对的）。

<details><summary>初记原文（2026-09-08 更正前）</summary>

原标题：「会员优化导出成功，但「我的文档」看不到导出稿」；
原实际：「会员 `POST /api/v1/resume/generate/export` 已发出；「我的文档」只有上传原件 `valid-2p.pdf`（2 KB，与夹具体积一致），没有优化稿 PDF。删除该原件后空态诚实。」；
原口径：「模拟数据下的接线缺口，**不是**线上证据。」

</details>

#### D2. 「打印这份报告」能进确认页，但本机报价失败（诚实，未出纸）

- **路由**：`/resume/report` → `/print/confirm`
- **控件**：`[data-testid=resume-report-print]`「打印这份报告」
- **期望**：导出后可进入打印确认；本机无 Agent / 打印机离线时应诚实失败、不建单
- **实际**：进入报价确认，状态「报价失败 · 未建单」。文案「暂时无法获取报价」「打印机离线。当前不能下单，不会扣费」「终端安全校验失败」。console 伴随 404 / 400（`orders/quote` 等）。未建单、未扣费，符合不伪造能力。
- **四观测量**：URL 变到打印确认（截图 `j1-anon/00149479-report-print-landed.png`），有 `GET /terminals/KSK-001/capabilities`、`POST /orders/quote`、`GET /print/price-config`，DOM 变，有失败提示。
- **复现**：报告页先导出，再点「打印这份报告」。
- **说明**：出纸与终端身份属打印包 / 真机，本包不深追。

**2026-09-08 补：跨会话残留排查结论 —— 不是隐私事故**

评审时有人担心「按钮状态残留会让下一位用户打印出上一位的简历」。已按源码逐条排除：

| 问题 | 结论 | 依据 |
|---|---|---|
| 导出结果存在哪 | 组件内 `useState`，无 module 级变量、无 `localStorage`/`sessionStorage` | `ResumeReportTakeaway.tsx:118` |
| 清场会不会留下它 | 不会。清场是**整页重载**，React 树连同 state 一起销毁 | `KioskPrivacyGuard.tsx` `pushSanitizedDestination` → `window.history.pushState(...)` + `window.location.reload()` |
| 路由 state 里的签名链接呢 | 一并清掉：重载前把 `history.state.usr` 覆写为 `null`，并写入 `minHistoryIndex` 隐私边界拦截旧历史 | 同上 |
| 匿名会不会漏计时 | 不会，空闲守卫**匿名同样生效**（C-2A 已去掉登录门槛） | `useIdleLogout.ts` 头注释 |

- **真正要修的只有文案**：按钮固定写死「打印这份报告」，但 `handlePrint` 打的是**最后一次导出**的文件。
  先导诊断报告、再导修改清单，按钮仍说「报告」，实际送去打印的是修改清单。
  已修：label 跟随 `exportKind`（`change_list` → 「打印修改清单」）。打印逻辑本身未动。
- **报价失败部分不是缺陷**：本机无 Agent、打印机离线，页面如实说「不能下单、不会扣费」且未建单，符合 CLAUDE.md §9「不伪造能力」。

#### D3. 优化页「离开前确认」弹层会挡住后续按钮（文案是「确认离开 / 继续编辑」）

- **路由**：`/resume/optimize`
- **控件**：`.qx-rd-overlay` 内「确认离开」「继续编辑」
- **期望**：未导出离开对照时给确认；确认后应能继续点格式 / 导出
- **实际**：第一轮走查因脚本只认「离开」二字，弹层一直挡住 `.qx-rd-fmt`，四种导出全点不到，空闲后还进过 `/session-timeout`。弹层本身**不是死控件**（点「确认离开」URL 会变）。最终批次脚本已点「确认离开」，导出走通。
- **四观测量**（挡住时）：URL 不变，无新 API，DOM 几乎不变，弹层仍在。
- **复现**：对照页裁决后回优化页，再点「逐条看完整对照」但不点弹层按钮。
- **建议**（修复另开包）：检查 1080×1920 下弹层关闭按钮是否足够大、是否能点遮罩关闭；与空闲超时叠在一起时用户会以为导出坏了。

### 假阳性死控件（不记产品缺陷）

| 记录 | 原因 |
|---|---|
| J2 `format-PDF` | PDF 已是当前选中项（`aria-pressed=true`），再点一次四观测量全无变化 |
| 会员 `home (open /)` | 登录后已在 `/`，脚本不再整页刷新（避免清内存会话），这是空操作 |

### 未覆盖（如实）

| 流程 | 原因 |
|---|---|
| 真实 LLM 诊断 / 优化 / 生成 | 本地 `AI_PROVIDER=mock`，报告正文是演示样本 |
| 真实短信到手机、QR 扫码登录 | `SMS_PROVIDER=log`；QR 需 Terminal Agent 与公网基址 |
| U 盘 / 手机扫码上传简历 | 需 Windows Agent / 真机；本包用隐藏 `input[type=file]` 走云端通道（当前 vite 虽 `VITE_TERMINAL_ID=KSK-001`，默认仍露出本机选文件区） |
| 真机出纸 | 打印机离线 + 终端安全校验失败，见 D2 |
| 会员「AI 帮你生成一份」→ 我的简历 / 我的文档 | 会员旅程走了诊断+优化+删除，**没再跑生成**；匿名生成不入库 |
| 岗位匹配参考完整闭环、模拟面试 → 我的 | 部署清单 §4.2 有这两条；本包主旅程是 J1–J4。Hub「岗位匹配参考」能点进 `/resume/job-fit`，未填简历做完整匹配。模拟面试不在本包 |
| PDF 预览页芯是否渲染 | 主持人已裁：headless / 应用内阅读器只显示外壳。截图空白**一律记自动化不可判，需真机**，不记缺陷 |
| 预览区高度偏小 | 已知 `FileContentPreview.tsx` 写死高度，已记过，不重复报 |

### 匿名被登录门挡住的功能（诚实）

| 页 | 挡住什么 | 提示是否诚实 |
|---|---|---|
| `/me/ai-records` | 跨会话 AI 记录列表 / 删除 | 是。说明诊断/优化/生成/面试要登录才能找回 |
| `/me/resumes` | 简历档案 | 是。并给「去上传简历」免登录出口 |
| `/me/documents` | 文档列表 / 删除 / 再打印 | 是 |
| 报告导出 | 写入「我的文档」 | 是。「登录后可存我的文档，本次可扫码带走」 |

### 与部署清单 §4.1 / §4.2 的对照（不得打勾）

| 条目 | 模拟走查 | 真实走查 |
|---|---|---|
| 4.1 手机号登录/登出 | 本地 log 短信登录走通；登出未专测 | 待真号 |
| 4.1 QR 登录 | 未覆盖 | 待 Agent + 公网基址 |
| 4.1 「我的」无假数量 | 游客 0 调用 + 登录门；会员见真实 2/1/1 | 待生产账号 |
| 4.2 上传→诊断→报告→我的 AI 记录 | 会员可见 2 条 mock 记录 | 待真模型 + 真号 |
| 4.2 优化→导出 PDF→我的文档 | 导出接线对；**文档列表未见导出稿（D1）** | 待真号 |
| 4.2 生成→预览→PDF→我的简历/文档 | 匿名生成+导出走通；会员生成未跑 | 待真号 |
| 4.2 岗位匹配 / 模拟面试 | 未作为主旅程 | 待另包 |
| 4.2 删除不留幽灵 | 会员删 AI 记录、删文档后空态/余 1 条，无幽灵 | 待真号 |

**结论必须标 PARTIAL。** 数据来源是本地种子 + 本地 API，不是线上验收。
