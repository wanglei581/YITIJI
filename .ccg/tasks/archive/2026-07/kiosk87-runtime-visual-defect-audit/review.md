# Kiosk 87 页运行时视觉缺陷审查

## 结论

- 内部 `ccg-review`：`APPROVE`，Critical=0，Warning=0。
- Claude：`APPROVE`，Critical=0，Warning=0。
- Antigravity：未取得有效报告。两次 OAuth 成功后，服务端仍返回 `admin controls not applicable` / `WaitForReady` 超时；该外部阻塞不得记为通过。

## 已关闭问题

1. React Router 默认英文异常页已替换为中文安全恢复页；全部 15 个顶级 route object 由 TypeScript AST 门禁锁定 `errorElement`。
2. 未知 URL 由 React Router 7 short-circuit 进入根路由错误边界，真实浏览器显示“页面不存在”，不暴露堆栈。
3. 生产日志仅记录 pathname、route pattern 和稳定错误码；原始 error/stack 只在 DEV 分支输出。
4. 线下机构列表与详情已按真实 raw Prisma wire 集中映射；测试夹具不再伪造 `agency.services`、营业实时性、距离、岗位数等不存在字段。
5. `/print/upload` 不再同时显示业务操作栏与全局主导航；W2 页头/gutter、W3 ResumeSource/InterviewSetup/顶级舞台和导航结构已按 TDD 收口。
6. `KioskPageFrame` 不包含 `KioskStageFit`；相关顶级页面仅由 `KioskFullscreenShell` 套一层舞台，不存在双重缩放。

## 验证证据

- Kiosk W6 Playwright：87/87 passed。
- 用户当前浏览器逐条打开 87 个正式 URL：无默认英文路由错误页、乱码字符或横向溢出。
- W2 浏览器：28/28；W4 浏览器：12/12。
- 新增 runtime error boundary verify、fusion baseline/shell/home、W2–W6、visual unity：全部通过。
- Kiosk typecheck/lint/build：通过；lint 0 error，仅 4 条既有 Fast Refresh warning。
- Admin/Partner typecheck/lint/build：通过。
- `git diff --check`：通过。

## 非阻塞建议与边界

- Claude 建议未来增加一条未知 URL 的 Playwright 回归用例，防止路由树重构后 404 恢复路径退化；本批已有 AST 覆盖门禁与真实浏览器证据，因此不阻塞候选。
- 本结论只证明本地候选中已复现的崩溃和代表性错版关闭；不代表 87 页全部状态像素级 1:1，也不替代预生产、Windows 一体机、打印/扫描、支付、短信、TRTC、法务或现场验收。
