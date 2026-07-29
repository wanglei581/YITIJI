# 审查记录

## CI 根因

`verify-fusion-shell.mjs` 仍要求 `KioskRoot` 是 `createBrowserRouter` 的顶层直接入口；统一隐私安全架构已经将其放入顶层非视觉 `KioskRuntimeRoot`，因此旧门禁错误阻断。

完整静态套件继续运行后还发现 `verify-fusion-w5.mjs` 的有序清单仍把法律页放在登录页之前；现行安全路由已经把法律页移入运行时安全根，因此同步清单顺序。

Fusion baseline 原先把新增的 `*` 错误边界误计为第 88 个可导航页面。该边界没有独立 URL、页面原型或截图用例，继续由 unknown-route 隐私浏览器用例验证，因此提取器明确排除精确的 `*`，保留 87 条生产页面清单。

远端 fusion smoke 随后证明 `/session-timeout` 与 `/error-offline` 已进入安全根后会真实读取屏保配置；旧夹具没有注册该请求。测试现显式返回 disabled 屏保配置，继续保持未处理 API 请求 fail-closed。

`build-and-verify` 还发现会员登录弹窗合同仍从视觉 `KioskRoot` 查找 idle hook；idle 所有权已迁移到 `KioskPrivacyGuard`。门禁改为核对完整 `useIdleLogout(screensaverActive, hardClear)` 调用，确保登录弹窗依赖的公共终端清场仍成立。

K1 公共入口合同同样仍要求 `LoginPage` 局部调用敏感会话清理。新版统一安全根已覆盖登录页，门禁改为验证 `KioskPrivacyGuard` 调用 `clearKioskSensitiveSession`；屏保页自身的挂载清理合同继续保留。

打印确认合同仍要求旧的 `!isSim || !simDone` busy lock，这会让真实任务即使失败、超时或结束也持续阻止隐私待机。生产实现已经收紧为仅执行中的真实任务或 SIM 演示持锁，因此门禁同步验证完整的失败、超时和结束态释放条件。

## 修复

- 断言 `KioskRuntimeRoot` 为顶层直接入口。
- 递归断言 `/` + `KioskRoot` 位于 `KioskRuntimeRoot` 后代中。
- 断言手机扫码登录、手机上传仍是安全根之前的顶层豁免，且不得嵌套进安全根。
- 断言 `/login`、`/legal/:doc` 与 catch-all `*` 必须位于安全根后代，不能顶层逃逸。
- 将屏保与 idle hook 所有权断言迁移到 `KioskPrivacyGuard`。
- hook 源码断言先移除注释，防止注释伪装实现。
- JSX 组件解析同时兼容自闭合与双标签写法，降低误报。
- 更新 W5 路由清单为手机辅助页 → 登录页 → 法律页，保持与实际 AST 遍历顺序一致。
- baseline 提取器仅排除精确 catch-all `*`，并增加单元夹具；不排除其他具体路由。
- fusion smoke 只为安全根页面补充 disabled 屏保响应，不吞并通配请求、不修改生产行为。
- 会员登录合同跟随安全根所有权迁移，不再要求视觉壳承担会话安全。
- K1 合同验证统一清场所有权，不恢复已删除的登录页局部 idle 逃逸实现。
- 打印确认合同锁定精确的 active-task busy lock，不回退失败、超时和结束态的隐私释放。

## 双模型只读审查

- Claude 最终只读审查：`APPROVE`，Critical 0、Warning 0。
- Cursor Grok 4.5 High/Fast 最终只读审查：`APPROVE`，Critical 0、High 0；提出法律页静态归属可进一步锁死，已采纳并扩展到登录页与 catch-all。
- Antigravity 最终调用因配额/资源限制未返回有效报告，不记作通过；此前审查提出的注释绕过与双标签误报均已修复。

## 验证

- `pnpm --filter @ai-job-print/kiosk verify:fusion-shell`：PASS
- `node --check apps/kiosk/scripts/verify-fusion-shell.mjs`：PASS
- `pnpm --filter @ai-job-print/kiosk test:browser:privacy`：18/18 PASS
- `pnpm --filter @ai-job-print/kiosk verify:print-confirm-honest`：PASS
- `git diff --check`：PASS
- GitHub Actions `30432157270`：`build-and-verify`、`kiosk-browser-smoke`、`postgres-readiness` 全部 PASS

最终结论：PR #432 已通过三项 CI；保持未合并、未部署。
