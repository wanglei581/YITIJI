# Kiosk 8177 / 5299 融合视觉验收 Runbook

> 适用范围：W1–W6 的 Kiosk 呈现层迁移与状态验收。
>
> 视觉基准：`docs/design/kiosk-proto-2026-07-fusion/`。
>
> 路由事实：`apps/kiosk/src/routes/index.tsx` 与 `apps/kiosk/tests/visual/route-manifest.ts`。

## 1. 验收边界

本 Runbook 只验证生产构建中的浏览器呈现、路由可达性、布局和受控状态表达。所有截图必须来自 production build；禁止使用 Vite dev server、静态原型页或 mock-mode 构建截图充当生产 UI 证据。

浏览器证据不能替代以下验收：API 真实契约与权限、Terminal Agent、Windows 主机、支付渠道、打印机、扫描仪。涉及这些能力时，浏览器验收只证明前端正确消费当前契约；API/Agent/Windows/支付渠道/打印机/扫描仪仍须分别按对应 runbook 和真机流程验收。

W0 只建立可重复的 production-build 浏览器入口和 4 条 smoke，不代表全部 Kiosk 页面已完成融合换装，也不代表真实业务或硬件闭环通过。

## 2. 固定环境

| 项目 | 固定值 |
| --- | --- |
| 构建 | production build only |
| Kiosk 视口 | `1080×1920`，覆盖全部 production Kiosk routes |
| 手机视口 | `390×844`，只覆盖 `/member/qr-login`、`/upload/phone` |
| locale | `zh-CN` |
| timezone | `Asia/Shanghai` |
| color scheme | `light` |
| motion | `reduced` |

不得把 `390×844` 扩展为普通 Kiosk 路由的替代验收视口，也不得用桌面浏览器的任意缩放比例替代 `1080×1920`。动态页面内容允许变化，但视口、语言、时区、配色和动效偏好必须固定。

W0 的标准 smoke 命令为：

```bash
pnpm --filter @ai-job-print/kiosk test:browser:smoke
```

Playwright 必须由配置中的 `webServer` 启动生产构建和 `vite preview`。导航使用 `domcontentloaded`，禁止依赖 `networkidle` 或任意 `waitForTimeout` 掩盖请求和轮询问题。

## 3. 状态夹具规则

状态夹具只能在浏览器路由拦截层提供当前生产契约允许的响应；不得在 `apps/kiosk/src/**` 增加演示开关、固定假数据或测试专用分支。

| 状态 | 受控方式 | 禁止做法 |
| --- | --- | --- |
| loading | 拦截目标请求并保留 deferred response；先断言加载态，再显式释放响应 | 用固定 sleep 猜测加载时长；返回永不结束的伪协议 |
| empty | 返回语义有效的 empty response envelope，保持当前 API 的成功包络、字段和分页结构，仅令集合为空或可空结果为合法空值 | 返回缺字段对象、`204` 或错误包络冒充空态 |
| offline | 对目标请求执行 `route.abort('internetdisconnected')` | 用 `500`、自造错误码或静态文案冒充断网 |
| authenticated | 从真实登录 UI 发起操作，并拦截当前登录/会话响应，让页面按真实流程建立认证态 | 向 local/session storage、cookie 或页面上下文直接注入 token |
| payment | 只覆盖当前契约已有的 `failed`、`closed`、failed-or-expired attempt 和 `refunded` | 发明新的支付状态、回调结果、支付渠道或成功结论 |
| scanner offline | 返回当前 device status shape 中的离线状态，由现有页面逻辑渲染 | 自造扫描仪 DTO、硬件错误码、型号或 Agent 成功状态 |

每个拦截器必须按准确的 HTTP method 与 `/api/v1` path 注册。未注册请求应以 `internetdisconnected` 失败并在用例结束时报出，不能被通配成功响应吞掉。加载态的 deferred response 在断言后必须释放或清理，避免污染后续用例。

## 4. 路由与截图执行

1. 先运行融合基线校验，确认 86 条规范化路由、5 条兼容重定向和派生原型仍一致。
2. 用 production build 启动独立 preview；不得复用来源不明的 dev server。
3. 全部 production Kiosk routes 在 `1080×1920` 下逐路由验证；只有 `/member/qr-login` 与 `/upload/phone` 另外在 `390×844` 下验证。
4. 每页至少核对可见 `<main>`、路由特征文本、无页面脚本异常、无失败 document request、无横向溢出。
5. 对该业务真实存在的 loading、empty、error、offline、认证、支付或硬件状态，按第 3 节逐项创建可复现夹具；状态页参考不是新 production route。
6. 失败时保留 trace 和截图，定位后修复生产呈现或测试夹具；不得以更新截图绕过真实回归。

截图与 trace 只能保存在已忽略的 `test-results/` 下，例如 `test-results/kiosk-fusion/`。失败截图不得复制到 `docs/`、源码目录、Git tracked 路径或 CI 永久公开资产；W0 不提交 reference screenshots。

## 5. 隐私与安全

截图、trace、HTML 报告、控制台摘录和测试名称中禁止出现：

- 任何 PII；
- token 或认证凭据；
- 取件码；
- signed URL；
- prompt body；
- 简历内容；
- uploaded document 或其可识别内容。

夹具只使用无个人信息、不可用于真实系统的合成数据。认证测试不得打印请求头、响应中的 token 或 storage 内容；文件流程不得打开、截图或提交真实简历和用户上传文档；支付与打印测试不得记录可复用的取件码或签名地址。发现上述内容时，立即停止传播证据，删除本地失败产物并用脱敏夹具重新执行。

## 6. 证据记录

每次验收至少记录：Git commit、production build 命令与布尔配置选择、Playwright 命令、项目/视口、通过数与失败数、使用的状态夹具、已知限制。只记录环境变量名称与布尔选择，不记录值或密钥。

通过浏览器视觉验收时，结论必须写成“production-build 浏览器呈现通过”。除非对应独立证据也已完成，不得扩写为 API、Terminal Agent、Windows 主机、支付渠道、打印机、扫描仪或整体上线验收通过。
