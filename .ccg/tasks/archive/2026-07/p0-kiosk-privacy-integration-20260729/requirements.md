# P0 Kiosk 隐私超时集成要求

## 目标

将 `bfeb7f43` 的公共终端隐私超时候选推进到可创建 PR 的单一集成候选；关闭三方审查发现的真实 Critical/High，补齐 CI 与回归证据，但不合并、不部署、不操作真实环境或硬件。

## 允许修改

- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx`
- `apps/kiosk/tests/visual/kiosk-privacy-timeout.spec.ts`
- `apps/kiosk/scripts/verify-fusion-w6.mjs`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `.github/workflows/ci.yml`
- 本任务相关 `docs/progress/`、正式实施计划、`.ccg/tasks/` 记录

## 必须满足

1. `/legal/*` 不能成为已登录公共终端会话逃逸硬隐私截止的路径。
2. 隐私清场不得取消已经创建的打印或扫描后台任务；只停止页面轮询与本地交互。
3. 用户明确点击“返回（取消任务）”、无效服务端响应和会话自然过期仍可取消未确认扫描任务。
4. 手机扫码登录与手机上传继续豁免 27 寸终端硬截止。
5. 隐私浏览器套件进入 GitHub `kiosk-browser-smoke` 门禁，失败证据可上传。
6. 不新增业务入口、API、数据库字段、依赖、生产配置或硬件能力。

## 延后到现场门禁

- 真实 Chromium/Edge BFCache 恢复证据。
- Windows Kiosk 单标签锁定与禁止新增同源标签页的现场验证；若无法保证，再实施跨标签广播清场协议。
