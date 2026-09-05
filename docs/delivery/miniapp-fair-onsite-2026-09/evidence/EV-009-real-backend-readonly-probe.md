# 生产后端只读探测（EV-009）

**2026-09-02 · 修订 8176c1ee2004 之后 · 只读 GET / 零落库 POST · 执行方：Claude**

补上「从未对 zyidai.cn 发过一次真实请求」这个空白的一部分。只发只读请求与
后端明写「纯计算、零落库」的核对请求，不认证、不写入、不发送任何用户数据。

## 连通性：7 个公开端点全部 200

| 端点 | HTTP | 耗时 | 响应 |
|---|---|---|---|
| `/health` | 200 | 2.8s | `db: postgres` · `degraded: []` |
| `/jobs` | 200 | 2.7s | **0 项 · total=0** |
| `/job-fairs` | 200 | 2.4s | **0 项 · total=0** |
| `/policies` | 200 | 3.1s | **0 项 · total=0** |
| `/companies` | 200 | 3.9s | `{data, success}` |
| `/policies/eligibility-questions` | 200 | 2.0s | 3094 B · 9 问项 |
| `/terminals/public` | 200 | 2.0s | **空数组** |

响应普遍 2–4 秒。小程序 `config.timeout` 是 15s，余量够；但这只是公开只读端点，
AI 长任务（`aiTimeout` 90s）未测。

## 契约验证：政策条件自测（批 2 第 4 项）

**生产响应形状与实现时的假设完全一致**：

- 顶层键 `questionSetVersion / questions / privacyNotice / disclaimer`
- 9 个问项，字段 `key / label / sensitive / options`，其中 **5 项标了 sensitive**
- `privacyNotice` 与 `disclaimer` 均有值

**该端点无 `data` 信封**，顶层即载荷。核对 `utils/request.js:159`
`if (!('data' in body)) return body` —— 对无信封响应原样返回，实现是对的。

核对端点（合成作答，服务端零落库）：

- 无效键 `status` → `answeredCount: 0`、`ignoredQuestionKeys: ['status']`，服务端正确清洗
- 真实键 `employment_status=seeking_after_leaving` → `answeredCount: 1`、`ignored: []`
- `method: deterministic_comparison`（确定性比对，非 AI）✓
- **两次都是 `items: 0`**

## 最重要的一条：生产库没有内容

岗位 0、招聘会 0、政策 0、公开终端 0，且没有任何已录入可比对条件的政策。

后果：

1. **批 1 的招聘会现场助手在生产上无法验证** —— 没有招聘会可打开，
   展位导览 / 参会企业 / 活动资料 / AI 行前计划一条都走不到。
2. 政策条件自测今天打开必然是空态（页面对此的处理是对的：说「没有可比对的政策」
   并说明「不代表你不符合任何政策」，不替库空作证）。
3. `/terminals/public` 为空 → 打印流程的终端选择无可选项。

**所以真机冒烟的前置不是「有设备」，而是「有内容」。** 没有内容时，
真机能验的只有壳、导航与空态，验不了任何业务闭环。

## 本探测不能证明什么

- 未认证，所有 `/me/*`、AI 生成、打印下单、文件访问一律未测
- 未在微信开发者工具或真机内执行，渲染、版式、`downloadFile` 合法域名一律未验
- AI 长任务的真实耗时与超时行为未测
