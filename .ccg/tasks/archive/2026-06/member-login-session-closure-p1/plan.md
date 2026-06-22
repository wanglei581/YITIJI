# 初版执行计划

1. 双模型分析现有会员登录、Kiosk auth、收藏、活动、账号状态和留存文档。
2. 写 failing verify，覆盖 401 会话失效、deviceId 传递、收藏/活动目标校验、禁用账号 session fail-closed。
3. 按最小改动补后端服务与前端 API/client 行为。
4. 补个人数据留存矩阵文档和进度文档。
5. 跑最小验证与完整相关验证。
6. Claude + Antigravity 双模型复审。
7. 归档 CCG 任务、提交、推送并创建 PR。
