# P0 Kiosk 公共会话隐私超时计划

正式实施计划见 `docs/superpowers/plans/2026-07-29-p0-kiosk-privacy-timeout.md`。

## 文件预算

- 新增：2 个运行时源码文件、1 个 Playwright 配置、1 个 Playwright 用例。
- 修改：路由与 Kiosk 布局、普通 idle/屏保/认证登出适配、5 个过宽 busy 页面、1 个登录页、1 个扫描 truth 夹具、Kiosk package/env、2 个进度文档。
- 禁止：`services/`、`apps/admin`、`apps/partner`、`apps/terminal-agent`、数据库、生产配置、密钥、部署脚本。

## 阶段

1. RED：增加顶级路由会员/匿名/忙碌任务/手机豁免/浏览器后退测试；复现扫描 capabilities 夹具失败。
2. GREEN：建立 `KioskRuntimeRoot` 与 `KioskPrivacyGuard`，对终端路由统一挂载普通 idle、屏保和不可被 busy 抑制的硬隐私截止。
3. 收口：登出 keepalive；缩小页面 busy 到真实在途阶段；不取消后台打印/扫描任务。
4. 验证：privacy、truth、W2/W3/W5/W6、typecheck、lint、production HTTP build、静态真实性门禁。
5. 审查：Claude + antigravity + Cursor Grok 4.5 high/fast + 本地主审；Critical 修复后复审。
6. 文档与归档：同步正式进度、写 review、归档 CCG task；不推送、不合并。
