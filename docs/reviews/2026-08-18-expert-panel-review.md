# 五路专家联合审查（2026-08-18）

> 状态：一次性只读联合审查。**不是**进度、功能范围或合规红线的替代信源。  
> 主基线：`origin/main@22127deaf`。当前工作区分支落后 main 26 提交，缺陷行号均指主干。  
> 审查方式：五路并行只读，主持人对账去重；关键 P0 已用 `origin/main` 源码复核。  
> **未做**：生产 SSH、真机出纸、微信真机、live LLM、CI 重跑。  
> 本文件不授权部署或生产写入。

## 专家与职责

| 角度 | 审查人 | 结论摘要 |
|---|---|---|
| 产品与合规 | 产品合规专家 | 招聘闭环红线守住；目录硬编码、目录 CTA、线下岗位四要素是试点前必须改的 |
| 后端 / 资金 / 鉴权 | 后端资金专家 | 多项止血已在 main；默认未付可 claim、公开读未接 contentTrust、会员 Redis 无界仍开着 |
| Kiosk / 小程序诚实性 | 前台诚实专家 | 主打印链路诚实；材料包侧链仍可深链，假计价/假门店/假成功码 |
| 安全 / 隐私 / 公共终端 | 安全隐私专家 | 清场与会员会话扎实；管理端登出、文件签名 TTL、送模脱敏、密钥轮换有缺口 |
| 硬件 / 运维 / 商业试点 | 硬件运维专家 | 现场出纸/扫描/扫码、正式 AppID、内容、0i Gate 全部 NO-GO |

整体判定：**商用发布 NO-GO**。软件足以做首台试点准备；改进顺序是「对齐主干 → 关掉会骗人/会出纸的洞 → 一条现场履约 → 一条真内容」，不是继续堆 V6。

---

## 1. 五路一致、不要再当未修的

这些在主干上已经成立。继续开发时不要重做，也不要写成「仓库里还没修」。

- 用户可见面没有「一键投递 / 立即投递 / 平台投递」。
- 打印订单权益核销已拒 `REDEEM_PRINT_ORDER_UNSUPPORTED`。
- 发布路径已接机构 `contentTrust`（#687）；Admin 有「内容可信」控件（#710）。
- 管理端 JWT 在 Redis 故障时回源数据库，不再整站 500。
- Kiosk 完成页只在服务端 `completed` 时说「请取走文件」；无 `taskId` 不模拟成功。
- 小程序主打印链：`_passPrintGate()` 是预览/下单唯一闸；到机码不创建未支付 PrintTask。
- 智慧校园默认关、深链 fail-closed，欢迎页不再编造楼栋。
- 政策核对不用「您符合申领资格」。
- 彩色/双面/N-up 服务端 fail-closed；`printerName` 走配置。
- 生产启动必须显式声明 `PRINT_REQUIRE_PAID_BEFORE_CLAIM`；接微信/支付宝时强制 `true`。

未部署、未真机，不等于这些代码闸门不存在。

---

## 2. 联合缺陷清单（已去重）

只保留「至少一路给出证据、主持人复核后仍成立」的项。同行重复的合并为一条。

### P0 — 试点前必须关（会出纸、会骗人、或越合规）

**[P0-1] 未付/支付中订单在门控关闭时可被 Agent claim 出纸**  
`services/api/src/terminals/terminal-utils.ts:155-157`，`terminals-agent.service.ts:400-414`  
`PRINT_REQUIRE_PAID_BEFORE_CLAIM` 默认不是 `true`。为 `false` 时 claim 只排除退款态，仍含 `unpaid`/`paying`/`closed`。生产接真实支付通道时启动门禁会强制 `true`；**不得把「生产 gate 已写」写成「所有环境默认安全」**。  
改进：有价打印部署必须 `true`；离线收款也至少白名单 `paid|free`。

**[P0-2] 线上平台目录硬编码，且 CTA 越白名单**  
`apps/kiosk/src/pages/jobs/OnlinePlatformsPage.tsx:16-45,63,146`  
写死 Boss/51job/智联/猎聘。Schema 已有 `OnlinePlatformDirectory`，Kiosk 未读。目录按钮用了岗位级文案「去来源平台投递」，违反 `compliance-boundary.md` §4.6。  
改进：改读已审已发目录；空库 fail-closed；目录 CTA 改为「前往官方平台查看 / 扫码打开来源平台」。

**[P0-3] 小程序材料包侧链仍注册，本地假计价/假门店/假成功**  
`apps/miniapp/app.json:10-13`，`pages/package-create/package-create.js:35-37`，`pages/store-select/store-select.js:45-50,86-92`，`pages/package-code/`  
AI 百宝箱入口会说明未开放，但深链/分享仍可走进完整下单皮。硬编码 0.5/2 元、假电话 `010-00000000`、Mock 北大定位、无订单也展示成功码。最后才打不存在的 `POST /orders/package`。  
改进：从 `app.json` 下线或全局守卫；未验收禁止 share；不要先补功能。

**[P0-4] Windows + 奔图履约无现场证据包**  
`docs/progress/next-tasks.md` 顶部。Windows CI ≠ 出纸。缺 orderId/taskId、出纸照片、扫码器五类场景、SMB Phase W。  
改进：一台目标机跑通「小程序建单 → 扫码/到机码 → 支付 → claim → 出纸 → 回流」。关闭标准见原 E1/E2。

**[P0-5] 生产无可用真实内容，机构试点讲不清价值**  
2026-08-10 盘点公开空态、Wave 2 治理 blocker（须重验）。Partner 归因 `available:false`（`partner-stats.service.ts:17-22`）。  
改进：1 个授权来源走导入→审核→信任→发布；禁止 seed。归因固化 `sourceOrgId` 快照，N≥5。

### P1 — 下一波（资损窗口、误导、会话）

**[P1-1] 会员 Redis 故障无界等待** — `end-user-auth.guard.ts:56-58`  
保持拒绝；加有界等待 + 503/`MEMBER_SESSION_STORE_UNAVAILABLE`。禁止改成放行。

**[P1-2] 账号已写入库后 Redis 失效抛 500** — `admin-orgs.service.ts:733-735`  
DB 成功与缓存失效解耦；返回「已保存、会话刷新延迟」。

**[P1-3] 公开读路径未接 contentTrust；机构 disable 不下架**  
`jobs-kiosk.service.ts:47-76`，`admin-orgs.service.ts:389-391`，`content-trust.ts:35-38`  
新发布已拦，线上历史和已停机构内容仍可能可见。回填后接读路径，或 disable/revoke 时 unpublish。

**[P1-4] 权益无面值，领取成功 ≠ 可抵扣**  
止血闸必须保留。活动页已写「抵扣尚未开放」，成功文案仍像已可用。试点勿发打印券，或先补面值再接线。

**[P1-5] 线下岗位缺来源四要素** — `create-offline-job.dto.ts` 的 `externalUrl` 可选；详情页无 source 四要素。  
无 HTTPS 来源入口应 fail-closed（§4.7）。

**[P1-6] 管理端登出不撤销 JWT** — `auth.controller.ts:256-268`  
共享后台电脑上，本地清 token 后 JWT 仍可用到过期。递增 `tokenVersion` 或 jti 黑名单。

**[P1-7] Kiosk 文件签名 30 分钟 + `/content` 无操作者审计**  
`files.controller.ts:57-58,314-328`  
公共终端残留 URL 可被下一位读到；Admin 看文件对不齐 `file.admin_access`。缩短 TTL；claim 重签；Admin 强制走带审计的 download/preview。

**[P1-8] 简历链脱敏非 fail-closed；助手对话未脱敏**  
`llm-input-mask.ts:24-28`，`llm-chat.service.ts:235-241`  
合同审查已 fail-closed，不要另造一套；简历/助手对齐同一硬拦截。

**[P1-9] 招聘会企业页写「合作平台」** — `FairCompanyDetailSections.tsx:187`  
改为中性「来源平台 / 第三方来源」。

**[P1-10] 密钥轮换无自动化门禁**  
启动只校验密钥存在。曾暴露的 LLM/OCR 轮换仍是清单勾选。流水线要轮换证据（无明文）。

### P2 — 可见性与口径

- 告警 `take: 50` 无 `truncated`（`admin-ops.service.ts:203`）。
- Print Hub 文案「彩色与纸张由你自己设」与预览页已禁用不一致。
- 小程序岗位详情主按钮是「复制来源链接」，不是白名单投递/扫码。
- 政策中心 AI 卡写「补贴资格 / 个性化解答」，跳转泛化 `/assistant`。
- 可选会员解析 Redis 抛错可能导致公开接口 500。
- Claim 不重签 30 分钟 `fileUrl`，排队超时后 Agent 下载失败。
- `FILE_SIGNING_SECRET` 未进生产启动门禁。
- Admin 会员列表浏览无审计。

---

## 3. 怎么改进和完善（唯一施工顺序）

禁止五路各开一条平行队列。只按这一条走。

1. **对齐 `origin/main`**  
   本机生活圈分支落后 26 提交。从干净 main 建修复分支，禁止在落后树上「完善全项目」。

2. **先关会出纸、会骗人的洞（本周代码）**  
   P0-1 付费门控默认值/白名单；P0-2 目录硬编码与 CTA；P0-3 材料包下线或入口即拦截。  
   顺手收 P1-1、P1-2。

3. **一条现场履约（必须你在场）**  
   正式 AppID + 目标 Windows + 扫码器 + 奔图。软件侧只补失败态和证据模板。没有出纸照片不得写「打印可用」。

4. **一条真内容**  
   一个授权来源，审核、信任、发布。P1-3 读路径与停用下架一起做。不要 219 条无策略。

5. **并行 0i，不扩硬件**  
   12–15 家访谈、1 个书面试点、2 个场地、2 份 RFQ。12 家后无人谈价就停买设备。

6. **安全收口排在首单演示之后、对外铺点之前**  
   P1-6 登出、P1-7 文件 TTL/审计、P1-8 送模脱敏、P1-10 轮换证据。

7. **明确不做**  
   V6 全页、双后台 48 页、证件照商用、签约审查开放、彩色/双面解闸、材料包做成真功能、seed 填生产、对外 TAM/毛利/窗口期、招聘闭环。

---

## 4. 未验证（联合）

- 生产运行 SHA 是否等于 `22127deaf`；`PRINT_REQUIRE_PAID_BEFORE_CLAIM` 现网取值。
- 生产内容是否仍全空（2026-08-10 盘点过期，须重验）。
- Windows/奔图/扫码器/U 盘/付款码真机。
- 正式 AppID 体验版。
- live LLM 禁词与简历脱敏残留率。
- 0i 访谈与 RFQ 任何外部证据。

---

## 5. 和此前两份材料的关系

- 聊天里的创业评估 Canvas：阶段判断，不是审查真值。  
- `docs/reviews/2026-08-18-project-comprehensive-review.md`：单人基线审查，本文件在其上叠加五路对账。  
- 冲突时以本文件第 2–3 节 + `origin/main` 源码为准。
