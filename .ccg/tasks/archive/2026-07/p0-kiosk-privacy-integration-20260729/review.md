# P0 Kiosk 隐私超时集成审查记录

## 已关闭问题

1. High：`/legal/*` 位于安全根之外，可暂停已登录公共终端的硬截止。已先补失败浏览器测试，再将法律页纳入无视觉安全根。
2. High：`/scan/settings` 因隐私清场卸载时会取消已创建扫描会话。已先复现 DELETE，再收窄为只有用户明确返回、无效响应或自然过期才取消。
3. Warning：缺少打印任务清场后“停止轮询但不取消”的对等回归。已补浏览器测试。
4. Warning：W6 路由深度与材料库静态门禁仍断言旧调用位置。已更新为安全根真实结构。
5. Warning：新增隐私套件未进入 CI。已接入 `kiosk-browser-smoke` 并上传失败证据。
6. Fixture：法律页进入安全根后新增屏保配置请求。W5 两个法律页视觉用例补诚实 disabled fixture，未放宽断言。

## 本地验证

- `test:browser:privacy`：18/18 PASS（独立 Antigravity 审查窗口在主工作树当前状态执行）。
- `test:browser:truth`：23/23 PASS。
- W2：29/29 PASS；W3：6/6 PASS；W5：18/18 PASS；W6：87/87 PASS。
- Kiosk typecheck：PASS。
- Kiosk lint：0 error，4 个既有 Fast Refresh warning。
- `verify:job-material-library-ui`、`verify:fusion-w6`、`verify:member-session-closure`、`verify:production-real-services`、`verify:print-done-truth`、`verify:scan-session-truth`：PASS。
- 多轮 production build 随 Playwright webServer 通过，仅有既有 chunk size warning。
- `git diff --check`：PASS。

## 外部/独立复核真实性

- Claude CLI：二次调用均由上游 `yurenapi.com` 返回 502，未形成有效 Claude 报告，不记为 APPROVE。
- Antigravity：外部模型再次遇到 quota/resource limit，未形成有效模型报告；独立窗口完成本地只读浏览器与产品审查，判断技术安全可进入 CI，但商业上线仍有条件 NO-GO。
- Cursor Grok 4.5 High/Fast：首轮发现法律页逃逸、扫描设置误取消、CI/测试缺口；对 `d821d1c5` 父差异首审因未展示 unchanged 的既有取消代码与 truth 测试而 `REQUEST_CHANGES`，补充原始实现、truth 23/23、privacy 18/18、配置与产品决定后最终 `APPROVE`，Critical 0、High 0。未把首次证据不足误写成代码缺陷。

## 保留门禁

- P0-1B：复用 `/session-timeout` 建立普通 idle / 屏保清场前 30 秒任务感知预警；不得放宽最终硬隐私截止。
- Windows Kiosk 必须验证单标签锁定和真实 Edge/Chrome BFCache；若不能保证单标签，再实现跨标签广播清场协议。
- 扫描 waiting/scanning/processing 的服务端到期释放、设备占用释放与跨用户隔离仍属真机/服务端现场验收。
- 当前候选不代表正式商用上线；F1、法务、PG/COS、真实外部服务、Windows 精确候选和一机一打印机试运营仍未关闭。

## 最终结论

本地代码与浏览器证据允许创建 PR 并进入 GitHub CI。由于 Claude / Antigravity 外部模型未形成有效报告，不能宣称“双外部模型批准”；Cursor 最终批准不替代 GitHub CI、Windows 真机或商业上线门禁。
