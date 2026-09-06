# 端点契约快照摘要（EV-014）· 2026-09-02

端点总数: 105
已知缺口: 12

## 已知缺口（每条带原因）
- `DELETE /community/comments/:p/like` — 同上，取消评论点赞。
- `DELETE /community/feeds/:p/like` — 同上，取消点赞。
- `GET /community/feeds` — 职业生活圈社区流：后端无 community 模块。CLAUDE.md §15 已声明「职业圈动态」未开放，小程序 pages/ai 在入口
- `GET /community/feeds/:p` — 同上，社区详情。
- `GET /community/feeds/:p/comments` — 同上，社区评论列表。
- `GET /orders/package/:p` — 同上，材料包详情。
- `POST /assistant/daily-report` — 今日早报：后端无该端点。CLAUDE.md §15 已声明未开放。
- `POST /community/comments/:p/like` — 同上，评论点赞。
- `POST /community/feeds/:p/comments` — 同上，发评论。社区功能上线前须先过 UGC 内容审核与合规评估。
- `POST /community/feeds/:p/like` — 同上，点赞。
- `POST /orders/package` — 材料包创建：Gate 0 决策 D5 明确 M2 延后，后端无 orders/package 路由。pages/home/home.js 已
- `POST /orders/package/:p/cancel` — 同上，材料包取消。
