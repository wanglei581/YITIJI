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
