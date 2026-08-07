# 职易达 · AI 求职与职业生活服务（微信小程序）

唯一发布源码（M0.1 壳阶段）。原生微信小程序，不迁移 Taro。

## 当前范围（M0.2）

- 四 Tab 壳：首页 / AI百宝箱 / 求职 / 我的（自定义 TabBar）。
- 首页一屏：沿用已核验视觉基线，入口收敛到四个 Tab；未上线功能统一提示，不伪造页面。
- 登录：微信一键登录（getPhoneNumber）+ 短信验证码降级；登录前强制协议/隐私勾选，
  协议版本与后端校验一致；“我的”页含登录/退出与本地会话清理。
- 其余 Tab 与本人数据继续为空态，M0.3–M0.4 分批接入公开浏览与本人数据。

## 本地打开

微信开发者工具 → 导入项目 → 选择本目录 `apps/miniapp`。

- 仓库内 `project.config.json` 使用 `touristappid`（游客模式）；正式调试请在本机改回
  已注册 AppID（`wxe9ba99a3a311c7df`），不要提交真实 AppID。
- 调试时可勾选“不校验合法域名”；正式发布前必须在公众平台配置 `zyidai.cn` 的
  request / uploadFile / downloadFile 合法域名。

## 门禁

```bash
node scripts/verify-miniapp-static.mjs
```

检查 JSON 可解析、页面四件套、四 Tab 一致性、无死路由、合规文案与密钥残留。
微信开发者工具编译 0 Error 与 UI 实点按 `docs/acceptance/miniprogram-jobfit-ui-real-click-runsheet-2026-08-07.md` 执行。
