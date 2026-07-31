# 首页 fusion-youth stash 对齐

## 真实闭环

保护 stash `18bffcf5d89a111f60ffd626944a0b3d065b6366` 中“首页采用 fusion-youth 青绿米纸视觉”的设计意图，同时避免把只适配旧 `.khome` / `home-service-desk.css` DOM 的失效覆盖层强行接回已经迁移到 `.kpv1` / `prototype-v1.css` 的当前首页。

## 允许修改

- `apps/kiosk/scripts/verify-home-prototype-v1.mjs`
- `apps/kiosk/src/pages/home/home-fusion-youth-override.css`（仅在证据证明失效后删除；原始内容继续由 stash 保存）
- `apps/kiosk/src/pages/home/HomePage.tsx`（默认不改；仅当双模型证明当前首页确有未吸收行为时最小修改）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`（仅当后续任务状态受影响）
- 本 CCG 任务记录

## 必须满足

1. 先新增会因工作区仍存在旧 override 文件而失败的合同，再删除或适配生产文件。
2. 证明当前首页使用 `.kpv1` 与 `prototype-v1.css`，并已通过正式 token 获得米纸、深墨绿、teal 主色；禁止用无匹配选择器的 CSS 假装恢复成功。
3. 保持首页真实路由、登录、继续任务、百宝箱、智慧校园、合规与备案行为不变。
4. 跑首页静态 verifier、Kiosk typecheck/lint/build 以及相关浏览器 smoke；多模型终审无 Critical/Warning 后方可提交。
5. stash 在验证完成前不得删除；若最终证明旧文件已完全失效，删除工作区副本后仍需保留 stash 到用户确认。

## 明确不做

- 不重设计首页、不新增入口或卡片。
- 不修改后端、共享协议、数据库、支付、打印扫描或生产配置。
- 不部署、不 push、不连接 production。
