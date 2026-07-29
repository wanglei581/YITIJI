# P0 Kiosk 公共会话隐私超时审查

## 最终范围

- 仅修改 `apps/kiosk` 的 runtime root、认证/idle/屏保、六个 busy 页面、浏览器与静态门禁，以及正式进度文档。
- 未修改 API、数据库、Admin、Partner、Terminal Agent、支付、生产配置、密钥或部署。
- 后台打印/扫描任务不取消；公共页面只停止当前轮询并清除本机用户上下文。

## 安全不变量

1. 全部 27 寸终端路由位于同一 pathless 安全根，unknown route/error boundary 也不能绕过。
2. 普通 idle / 屏保可尊重真实 busy；硬隐私截止不受 busy 抑制。
3. 清场先遮罩和同步清本地状态，服务端 logout 仅 keepalive 尽力送达，网络失败不阻塞。
4. 新增干净 history entry 截断 forward；旧 back、BFCache、旧 landing 和屏保刷新/唤醒均 fail-closed。
5. boundary 只含随机 token、history idx、createdAt，无用户 PII；top-level/nested history.state、sessionStorage、localStorage、SameSite 会话 Cookie 候选统一选最新代次。
6. 手机扫码登录、手机上传与共享法律页不套 27 寸终端硬截止。

## TDD 与对抗审查

- 初始 privacy RED：4 项终端场景失败、2 项手机豁免通过。
- 扫描 truth RED：capabilities fixture 缺失导致 8 失败 / 1 通过；补诚实 fixture 后 9/9。
- 多轮本地主审先后复现并关闭：未知路由逃逸、旧 back 历史恢复、forward 历史恢复、sessionStorage 写失败导致清场中止、`window.name` 跨来源不可信、旧 landing 覆盖新边界、屏保刷新与唤醒丢边界、BFCache 冻结文档恢复、`goForward().catch()` 假阳性。
- 最终本地主审第七轮：`READY / APPROVE`，Critical=0、Important=0。
- Cursor Grok 4.5 High/Fast：`APPROVE`，Critical=0；其 forward 断言、BFCache 和 token-only landing 建议已全部收紧。
- Claude wrapper 最终调用异常退出，无有效报告；Antigravity 达到额度/资源限制，无有效报告。未把空输出记为通过。

## 最终验证

- `pnpm --filter @ai-job-print/kiosk test:browser:privacy`：15/15 PASS。
- `pnpm --filter @ai-job-print/kiosk test:browser:truth`：23/23 PASS。
- `pnpm --filter @ai-job-print/kiosk test:browser:w2`：29/29 PASS。
- `pnpm --filter @ai-job-print/kiosk test:browser:w3`：6/6 PASS。
- `pnpm --filter @ai-job-print/kiosk test:browser:w5`：18/18 PASS。
- `pnpm --filter @ai-job-print/kiosk test:browser:w6`：87/87 PASS。
- Kiosk typecheck：PASS。
- Kiosk lint：0 errors；4 个范围外既有 Fast Refresh warnings。
- 生产 HTTP build：随 privacy/W2/W3/W5/W6 webServer 多次 PASS；仅有既有 chunk-size warning。
- 静态门禁：member-session、production-real-services、print-done-truth、scan-session-truth、fusion W2/W3/W5/W6 全部 PASS。
- `git diff --check`：PASS。
- `pnpm audit --audit-level high`：FAIL，报告 2 个本次未新增 high：React Router RSC 模式公告、ESLint 间接 `brace-expansion`；另 3 low / 1 moderate。未在本 P0 补丁中做跨主版本依赖升级。

## 裁决

本地候选代码满足 P0 公共终端隐私清场要求，可进入本地提交与后续 PR/CI 阶段。当前不代表已 push、已合并、已部署或已完成 Windows 真机、法务、支付、PG/COS、线上浏览器和现场试运营验收。
