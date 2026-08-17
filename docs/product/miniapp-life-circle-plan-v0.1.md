# 微信小程序 · 「职业生活圈」规划草案

> **状态**：草案 v0.1，等本地 `claude` CLI 反馈后定版。
> **范围**：仅讨论 `apps/miniapp` 内 AI 百宝箱 Tab 的内容扩展。
> **基准**：`apps/miniapp` 当前 `main@a3d4b953`，不含本规划任何功能。
> **合规边界**：严格遵守 `CLAUDE.md §15 / §16 / §9`，所有功能必须可点击即真实，禁止伪造 Token / 会员 / 积分 / 领取结果。

---

## 1. 目标与范围

### 1.1 目标
把当前"AI 百宝箱"升级为"职业生活圈"，形成：
- **上半屏**：真实 AI 求职工具 + 材料与打印（已有，不动）
- **下半屏**：新增 4 个真实能力入口（视频 / 福利 / 邀请 / 签到）
- **顶部 Tab 名**：保持"AI百宝箱"作为业务标识，页面内副标题改为"职业生活圈"

### 1.2 不在范围
- ❌ 不新增底部 Tab
- ❌ 不改首页、求职、我的 Tab
- ❌ 不动 Kiosk / Admin / Partner 任何代码
- ❌ 不改 API 数据库 schema（除非要新增 1 个视频内容表，可选）

---

## 2. 4 个新模块的合规与可行性

### 2.1 📹 学习视频（合规 ✅ / 可立即做）

**做法**：
- 内容源：接入**官方公开视频**（人社部就业指导公开课、地方人社局政策解读）
- **不抓第三方版权视频**（避免侵权）
- 数据形态：`VideoItem { id, title, cover, durationSec, sourceOrg, sourceUrl, category }`
- 存储位置：
  - 方案 A：API 静态 JSON（`GET /api/v1/discovery/videos`），Admin 后台可编辑
  - 方案 B：前端硬编码在 `data/videos.js`（更轻量，5-10 个视频起步）
- 用户交互：点击 → `wx.navigateTo` 跳 `pages/video-player/video-player` → 嵌入 `<video>` 组件播放 URL
- 跳转记录：复用既有 `BrowseLog`（仅记录本人浏览行为，不记录观看时长）

**API 路径**：新增 `GET /api/v1/discovery/videos`（仅读、needAuth:false）
**风险**：低（纯展示 + 嵌入播放，无奖励机制）

### 2.2 🎁 福利中心（合规 ✅ / 复用 Kiosk）

**做法**：
- Kiosk 端已有 `BenefitActivity` MVP（详见 `docs/superpowers/plans/2026-06-18-benefit-activities-mvp-implementation.md`）
- 后端 API 已存在：
  - `GET /api/v1/benefit-activities`（活动列表）
  - `GET /api/v1/benefit-activities/:id`（详情）
  - `POST /api/v1/benefit-activities/:id/claim`（会员领取）
  - `GET /api/v1/me/benefits`（我的权益）
- **小程序直接调用以上 API**，不写新后端
- 页面：复用 Kiosk `BenefitActivitiesPage.tsx` 的设计风格，新建 `apps/miniapp/pages/benefit-list/benefit-list` 与 `pages/benefit-detail/benefit-detail`

**API 路径**：复用既有 `benefit-activities`
**风险**：低（仅前端移植）

### 2.3 🔗 邀请有礼（合规 ✅ / 简化版）

**做法**：
- **不发任何奖励**（按你的决策 C1）
- 仅生成"我的专属邀请码"（基于用户 memberId hash）
- 用户可分享该码给朋友，**朋友注册时输入邀请码作为推荐来源记录**（不发放优惠券/积分）
- API：
  - `GET /api/v1/member/invite-code` → 返回本人邀请码（首次访问生成，缓存到 `member.inviteCode`）
  - `POST /api/v1/member/auth/register` → 新增可选 `inviteCode` 字段，仅记录 `InviterRelation`（不影响会员等级/权益）
- 小程序展示：我的邀请码 + 二维码（`wxqrcode` 接口生成）+ "分享给朋友"按钮（`onShareAppMessage`）
- 数据库新增 1 个表：`MemberInviteRelation { id, inviterId, inviteeId, inviteCode, createdAt }`

**风险**：低（仅记录关联，不发奖励；不影响权益合同到位前的业务）

### 2.4 📅 每日签到（合规 ⚠️ / 仅作预告）

**做法**（按你最终决策 S1）：
- 入口可点击，跳转 `pages/signin-preview/signin-preview`
- 页面**仅展示**：
  - 签到日历 UI（带签到格子占位）
  - 连续签到天数说明
  - "签到权益即将上线"提示
  - **没有任何"已签到"状态、没有积分数字、没有领取按钮**
- API：`GET /api/v1/member/signin-info` 返回 `{ available: false, message: '签到权益即将上线' }`
- 后端**不维护签到记录表**（不浪费数据库）

**风险**：低（纯展示，无业务逻辑）

---

## 3. UI 与页面结构

### 3.1 改造后 `pages/ai/ai.wxml` 结构

```text
[顶部导航]
  └─ AI百宝箱（主标题）
  └─ 职业生活圈（副标题，新增）

[上半屏·真实能力]
  ├─ 小青 AI 助手入口卡（保留）
  ├─ AI 免责声明（保留）
  ├─ AI 求职工具网格（保留 5 个）
  ├─ 材料与打印列表（保留 5 个）
  └─ AI 服务记录入口（保留）

[下半屏·职业生活圈新模块]（新增 section-t: "生活圈"）
  ├─ 📹 学习视频（横向滚动卡片）
  ├─ 🎁 福利中心（卡片入口）
  ├─ 🔗 邀请有礼（卡片入口，含我的邀请码）
  └─ 📅 每日签到（卡片入口，仅预告）

[底部]
  └─ 合规备注（保留）
```

### 3.2 新增页面（4 个）

| 页面 | 路径 | 复用 Kiosk | 备注 |
|------|------|-----------|------|
| 视频列表/播放器 | `pages/video-list/video-list` + `pages/video-player/video-player` | ❌ 新建 | 嵌入 `<video>` |
| 福利列表 | `pages/benefit-list/benefit-list` | ✅ 复用 API | UI 参考 Kiosk |
| 福利详情 | `pages/benefit-detail/benefit-detail` | ✅ 复用 API | UI 参考 Kiosk |
| 邀请有礼 | `pages/invite/invite` | ❌ 新建 | 二维码 + 分享 |
| 签到预告 | `pages/signin-preview/signin-preview` | ❌ 新建 | 纯展示 |

### 3.3 app.json 注册变更

新增 5 个页面注册，无修改。

---

## 4. 数据流与接口

### 4.1 复用既有 API

| 路径 | 方法 | 用途 |
|------|------|------|
| `/api/v1/benefit-activities` | GET | 福利列表 |
| `/api/v1/benefit-activities/:id` | GET | 福利详情 |
| `/api/v1/benefit-activities/:id/claim` | POST | 领取（需登录） |
| `/api/v1/me/benefits` | GET | 我的权益 |

### 4.2 新增 API（仅 3 个）

| 路径 | 方法 | 返回 | 实现位置 |
|------|------|------|---------|
| `/api/v1/discovery/videos` | GET | `VideoItem[]` | `services/api/src/discovery/discovery.controller.ts`（新建） |
| `/api/v1/member/invite-code` | GET/POST | `{ inviteCode, qrCodeUrl }` | `services/api/src/member/member-invite.controller.ts`（新建） |
| `/api/v1/member/signin-info` | GET | `{ available: false, message }` | `services/api/src/member/signin-info.controller.ts`（新建） |

### 4.3 数据库变更

新增 1 张表（用于邀请关系）：
- `MemberInviteRelation { id, inviterId, inviteeId, inviteCode, createdAt }`
- 同时给 `EndUser` 表新增 `inviteCode String?` 字段

Prisma 迁移文件：
- `services/api/prisma/migrations/20260815000000_add_member_invite_relation/`
- `services/api/prisma/postgres/migrations/20260815000000_add_member_invite_relation/`

---

## 5. 文件清单

### 5.1 新建文件（14 个）

**小程序端**（10 个）：
- `apps/miniapp/pages/video-list/{video-list.wxml,wxss,js,json}`
- `apps/miniapp/pages/video-player/{video-player.wxml,wxss,js,json}`
- `apps/miniapp/pages/benefit-list/{benefit-list.wxml,wxss,js,json}`
- `apps/miniapp/pages/benefit-detail/{benefit-detail.wxml,wxss,js,json}`
- `apps/miniapp/pages/invite/{invite.wxml,wxss,js,json}`
- `apps/miniapp/pages/signin-preview/{signin-preview.wxml,wxss,js,json}`

**后端**（3 个）：
- `services/api/src/discovery/discovery.controller.ts` + `discovery.service.ts` + `discovery.module.ts`
- `services/api/src/member/member-invite.controller.ts` + `member-invite.service.ts`
- `services/api/src/member/signin-info.controller.ts`

**数据库**（2 个）：
- `services/api/prisma/migrations/20260815000000_add_member_invite_relation/migration.sql`
- `services/api/prisma/postgres/migrations/20260815000000_add_member_invite_relation/migration.sql`

**脚本**（1 个）：
- `apps/miniapp/scripts/verify-life-circle.mjs`

### 5.2 修改文件（4 个）

- `apps/miniapp/app.json`：注册 5 个新页面
- `apps/miniapp/pages/ai/ai.wxml`：增加下半屏
- `apps/miniapp/pages/ai/ai.wxss`：新增卡片样式
- `apps/miniapp/pages/ai/ai.js`：绑定新入口跳转

### 5.3 不动文件

- `CLAUDE.md` / `AGENTS.md`（不需改）
- Kiosk / Admin / Partner（不需改）
- `packages/shared/`（不需改，复用既有 `BenefitActivity` 类型）

---

## 6. 合规审查

| 模块 | 合规检查 | 结论 |
|------|---------|------|
| 视频 | 仅展示官方公开视频，不发奖励 | ✅ |
| 福利 | 复用 Kiosk 既有 MVP，已通过双 CI | ✅ |
| 邀请 | 仅生成码 + 记录关联，不发奖励 | ✅ |
| 签到 | 仅展示预告，无业务逻辑 | ✅ |
| 整体 | 未触碰岗位/招聘会/简历/合同/硬件 | ✅ |

**符合 CLAUDE.md §9（不伪造能力）/ §15（权益合同未到位）/ §16（入口稳定规则）**

---

## 7. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 视频源失效 | 中 | Admin 后台可配置 URL，前端有 fallback 文案 |
| 福利活动后端 schema 不兼容 | 低 | Kiosk 已验证 API 稳定 |
| 邀请码生成冲突 | 极低 | 6 位 base32 + 唯一索引 |
| 静态门禁回归 | 低 | 新增 `verify:life-circle` |
| 视觉风格不统一 | 中 | 复用 Kiosk `inkpaper` 主题 |

---

## 8. 验证门禁

新增 `apps/miniapp/scripts/verify-life-circle.mjs`：
- 4 个新模块入口真实可点击
- 视频 / 福利调用真实 API
- 邀请码真实生成
- 签到页面**仅展示预告**，无任何"已签到"状态
- 合规文案 / 触控尺寸 48px+ / 数据真实

集成进 `verify-miniapp-static`，期望 **100+ PASS / 0 FAIL**（从 87 增加到 ~100）

---

## 9. 后续步骤

1. **本地 `claude` CLI 反馈**：用户拿这份草案让本地 Claude 评审
2. **汇总双方意见**：用户贴回本地 Claude 的反馈
3. **本会话 Claude 出最终版**：含修订点
4. **用户审核最终版**
5. **动手实施**：按修订后的最终版，分 2 个 PR 提交：
   - PR1：API + DB（邀请码 + 视频 + 签到预告）
   - PR2：小程序 UI（5 个新页面 + AI 百宝箱改造）

---

## 附录 A：参考文档

- `CLAUDE.md §15/§16/§9` — 合规边界
- `docs/superpowers/plans/2026-06-18-benefit-activities-mvp-implementation.md` — 福利活动 MVP（Kiosk）
- `apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx` — 福利列表参考实现
- `apps/admin/src/routes/benefit-activities/index.tsx` — 福利管理后台
- `apps/miniapp/utils/api.js` — 既有 API 封装
- `apps/miniapp/pages/ai/ai.wxml` — 当前 AI 百宝箱

---

## 附录 B：等本地 Claude 评审的问题清单

请让本地 Claude 重点评审：

1. **视频源**：你建议选哪个公开源？（人社部 / 地方人社局 / 其他？）
2. **视频存储**：A 方案（API + Admin 可配）vs B 方案（前端硬编码 5-10 个），哪个更合适？
3. **邀请码格式**：6 位 base32 够用吗？还是建议 8 位？
4. **签到预告页面**：除了"即将上线"，还要不要展示"上线后能获得什么"的预告文案？
5. **UI 风格**：要不要复用 Kiosk 的"inkpaper"主题？还是沿用 miniapp 当前的"纸本+紫调"？
6. **新页面是否需要分页/P0/P1 排序**：视频列表要不要加分类筛选？
7. **数据库表 `MemberInviteRelation` 字段**：还需要哪些字段（如设备指纹、注册时间、注册来源渠道）？
8. **小程序端 `wx.login` 登录是否需要与邀请码结合**：当前是手机号 + 短信，是否需要改成"手机号 + 短信 + 邀请码"？

---

> **草案完成，等用户贴本地 Claude 反馈。**
