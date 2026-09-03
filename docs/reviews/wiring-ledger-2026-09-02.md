# Kiosk 前后端接线台账（2026-09-02）

> 取证 revision：`23464350f`（图谱重算于 `6d74c2f17`，含 lazy 路由解析修复）
> 结论均由代码与 `docs/graph/graph.json` 计算，不采信文档陈述。
> 进度口径仍以 [current-progress.md](../progress/current-progress.md) 为唯一信源。

## 一、四层核对结果

| 层 | 结果 | 取证方式 |
|---|---|---|
| kiosk 路由注册 | **107 / 107** | `graph.json`（旧解析器漏 lazy 路由，只得 86） |
| 原型 `data-route` → 运行时路由 | **95 / 95** | 51 页属性提取 + 参数化匹配 |
| 前端端点引用 → 后端存在 | **1820 / 1820** | 剥 `/api/v1` 前缀 + 归一路径参数后比对 471 端点 |
| 运行时页面 ↔ 新稿 51 页 | **0 / 51** | `grep -rl kiosk-redesign-2026-08 apps/kiosk/src` |

**结论：不需要新建后端端点。** 全部剩余工作是逐页把新稿实现进运行时。

## 二、三个「未命中」不是缺口

- `GET /local/terminal-identity`、`POST /local/print/wake` —— 打到 `http://127.0.0.1:9527`，即 Windows Terminal Agent，本就不走云端 API。
- `POST /print` —— `services/api` 无此路由；来源是 `apps/kiosk/src/services/api/fairVisitPlan.ts` 里 `call(fairId, taskId, '/print', …)` 的相对片段，被图谱误判为完整路径，属解析器假阳性。

## 三、两次错误比较（留档，避免重犯）

1. 首次算出「123 个端点缺口」——原因：后端路径带 `/api/v1` 前缀，前端不带，未剥前缀直接比对。
2. 首次算出「39 条路由未注册」——原因：正则把 JS 拼接片段 `data-route="'+route+'"` 当成字面路由值。

剥前缀 + 参数感知匹配 + 过滤模板拼接后，真实缺口分别为 0 与 1（`/print/pickup` 应为 `/print/pickup-claim`，已改正）。

## 四、修正的两处会误导施工的错误

1. `30-my-profile.html` 头部把数量来源写成 `GET /me/summary` —— 后端无此端点；运行时 `useMemberProfileOverview` 是 `Promise.allSettled` 并发调 `/me/ai-records`、`/me/favorites`、`/me/documents` 读分页 `total`。
2. 同页新增卡片误写 `data-route="/print/pickup"`。

## 五、迁移批次

| 批次 | 页数 | 端点引用面 | 状态 |
|---|---|---|---|
| 一 · 打印扫描主链路 | 12 | 531 | 执行中 |
| 二 · 简历与材料 | 8 | 382 | 待开始 |
| 三 · 我的与账号 | 10 | 479 | 待开始 |
| 四 · 岗位·招聘会·企业 | 8 | 451 | 待开始 |
| 五 · 首页·AI·其它 | 13 | 411 | 待开始 |

单页验收标准六条见 [next-tasks.md](../progress/next-tasks.md) 顶部「当前主线」。
交付闸门与证据见 [docs/delivery/kiosk-redesign-r1/](../delivery/kiosk-redesign-r1/)。

## 六、2026-09-02 晚更正（并行核对推翻本文两处结论）

本文第二节此前把三条列为「真实缺口」，经复核**两条是我判断错了**：

| 我原先的结论 | 实际 | 我错在哪 |
|---|---|---|
| `GET /offline-agencies/:id` —— kiosk 侧不存在 | **存在**：`GET /api/v1/kiosk/offline-agencies/:id`，且 `apps/kiosk/src/services/api/offlineAgencies.ts:227` 正在调 | 正则先命中 `/admin/` 就下了结论，没看全端点表 |
| `GET /local/qr-login/status` —— Agent 与 kiosk 均无 | 能力**在后端 API 上**：`GET /api/v1/member/auth/qr/:ticketId/status`。扫码登录横跨本地网桥（create/claim）与后端 API（status/confirm）两个服务 | 只在 Agent 和 kiosk 里找，没在 services/api 里找 |

**真实缺口因此从 2 条降为 1 条：只有 `GET /me/summary` 后端确实不存在。**

另外复核发现原型 `03-login-gate.html` 声明的 `status → pending | confirmed | expired` 也是错的：
后端 `QrTicketStatus`（`member-qr-login.service.ts:17`）只有 `'pending' | 'confirmed'`，
过期是 404 `QR_LOGIN_NOT_FOUND`、已领取是 410 `QR_LOGIN_ALREADY_CLAIMED`。
原型的 qr-expired 态是**错误码驱动**的，照 status 值写会永远等不到。以上均已在原型头部改正。

**教训**：判断「某端点不存在」必须遍历完整端点表，不能靠一次正则命中就收手——
这和本文第三节记的两次错误比较是同一类毛病。
