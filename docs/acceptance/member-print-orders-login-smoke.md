# /me/print-orders 登录态真实订单 smoke 验收

本验收用于补齐「我的打印订单」登录态真实订单浏览器检查。它不是自动登录测试，不新增测试账号后门，也不把 fixture 接入运行时代码。

## 边界

- 只走真实登录链路，会员 token 继续由 `AuthProvider` 保存在内存态。
- 不得使用 localStorage、sessionStorage、cookie、query token 或 window hook 注入会员态。
- 不修改后端 API、支付状态机、取件码生成、价格、退款或核销逻辑。
- `apps/kiosk/src/pages/profile/me/printOrders/__fixtures__/member-print-orders-login-smoke.json` 只作为样例形态和守卫输入，不被页面 import。

## 前置条件

- Kiosk 以真实 API 模式启动：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1`。
- 后端使用可登录的会员账号，且该会员至少有以下订单形态中的一部分：待现场确认、已支付含取件码、已退款或历史无支付记录。
- 如本地短信 provider 为 log，验证码只从后端日志读取；不要在前端加入任何绕过登录的开关。

## 浏览器 smoke

1. 游客态打开 `/me/print-orders`，应显示登录引导，登录入口带 `loginFrom="/me/print-orders"` 的回跳语义。
2. 通过真实登录流程完成会员登录，回到 `/me/print-orders`。
3. 检查列表展示真实订单：文件名、份数、色彩、纸张、任务状态、支付概要均来自接口返回；历史无 Order 显示「暂无支付信息」。
4. 检查支付详单：金额按整数分展示；支付来源只显示线下收款、免费或人工确认；不得出现微信、支付宝或线上已收款口径。
5. 检查取件码只按后端返回展示：paid 且后端返回 `pickupCode` 时才展示；unpaid、refunded、无 Order 不展示。
6. 切换任务状态筛选，确认筛选只影响已加载列表；未加载完且当前页无结果时应提示继续加载，而不是宣称全量无记录。
7. 当接口返回 `nextCursor` 时，点击加载更多，确认追加下一页，不覆盖已加载订单。
8. 保持 pending 或 printing 订单存在时观察自动刷新；刷新失败时只显示提示，不清空已有列表。
9. 点击问题反馈，确认反馈跳转到 `/me/feedback` 且带打印任务关联参数。
10. 点击「去我的文档再打印」，确认只进入 `/me/documents`，不从订单侧直连 `/print/confirm`。

## 窄屏检查

- 在 360px 和 390px 视口分别打开 `/me/print-orders`。
- 检查顶部、筛选、订单卡、支付详单、取件码、加载更多和反馈入口没有横向溢出。
- 检查按钮文字不压住图标，取件码面板不遮挡相邻内容。

## 记录要求

- 记录验证环境、账号来源、API 模式、浏览器视口、是否存在 paid/pending/printing/历史无 Order 样例。
- 如果缺少某一类真实订单，只记录「本次未覆盖」，不要用前端 mock 或手工改 DOM 代替。
