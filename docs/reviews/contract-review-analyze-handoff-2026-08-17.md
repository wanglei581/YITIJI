# 合同审查 analyze 阶段失败 —— 排查交接

> 面向 `services/api` 负责线。小程序侧已确认**不是原因**，前端链路完整。
> 本文只给已证实的事实与证据，不含未验证推断（推断单独标注）。

## 一、故障定位（已收敛到一处）

**extract 成功，analyze 失败。**

Redis `bull:contract-review:contract-review.extract.*` 三条记录均有 `finishedOn`、
`failedReason` 为空 —— **OCR / 文本抽取这一段是好的**。

失败全部发生在 analyze：

```
ContractReviewSafeError: CONTRACT_REVIEW_ANALYSIS_FAILED
  at safeError            contract-review-orchestrator.service.ts:380
  at safeStageError       contract-review-orchestrator.service.ts:365
  at analyze              contract-review-orchestrator.service.ts:214
  at bullmq worker.js:589
```

`analyze` 的 catch（`:212-218`）包住了整个阶段，`safeStageError` 做脱敏包装，
**底层原因未被记录到任何地方**。这是本次排查耗时的直接原因。

## 二、已排除（均在生产实测，非推断）

| 假设 | 结论 | 证据 |
|---|---|---|
| provider 未配置 | ❌ | `.env:100-103` 四项齐全 |
| 代码未部署 | ❌ | `dist/contract-review/` 含 processor 与 queue |
| 队列未注册 / 未入队 | ❌ | Redis 有 `bull:contract-review:{events,completed,failed,id,stalled-check}` 及具体 analyze/extract job 键 |
| 处理器未接手 | ❌ | analyze job 有 `finishedOn` 与 stacktrace，说明跑过并抛错 |
| OCR / 抽取失败 | ❌ | extract job 全部成功 |
| API key 或模型不可用 | ❌ | 直接调 `https://api.deepseek.com/chat/completions` 用 `.env` 中的 key + `deepseek-v4-pro`，返回 200，模型存在 |
| 环境变量未生效 | ❌ | `dist/main.js:40` `require("dotenv/config")`，应用自读 `.env`；`pm2 env` 看不到属正常 |

> 注：`pm2 logs | grep CONTRACT_REVIEW_(EXTRACT|ANALY|SAFETY|PROVIDER|QUEUE)` 零输出，
> **不构成"未执行"的证据** —— processor 与 orchestrator 本身没有 Logger，
> 这些关键字本来就不会出现。本人一度据此误判。

## 三、最强线索：pro 是推理模型，输出结构可能与解析预期不符

直接调用 API 的实测返回（`max_tokens:5`）：

```json
{
  "model": "deepseek-v4-pro",
  "choices": [{ "message": {
      "content": "",
      "reasoning_content": "We need respond to user"
  }, "finish_reason": "length" }]
}
```

**`content` 为空字符串，实际输出在 `reasoning_content`。**

而 `contract-review-provider.service.ts:199-200` 送出的是标准 chat 结构，
解析侧（同文件 `:275` 附近对 `pages` 的严格校验）期望从 `choices[0].message.content`
取到 JSON。若 pro 在推理未完成时 `content` 为空或非 JSON，解析必然失败 → `analyze` 抛错。

**这是推断，未验证**。验证方式：在 provider 调用处临时记录 `finish_reason` 与
`content.length`（不要记录内容本身，合同正文不得入日志）。

## 四、模型不可更换（本人已试错并回滚）

`contract-review-provider.service.ts:9` 硬编码：

```ts
deepseek: { baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-pro' }
```

本人曾把 `.env` 的 `CONTRACT_REVIEW_MODEL` 改为 `deepseek-v4-flash` 试探，
错误码随即从 `CONTRACT_REVIEW_ANALYSIS_FAILED` 变为 `CONTRACT_PROVIDER_NOT_APPROVED`
（`provider.service.ts:98/259`）—— **模型白名单是代码级的，属合规备案的一部分**。
已改回 `deepseek-v4-pro` 并重启，服务健康（`/health` 返回 `status:ok, db:postgres`）。

> 该错误码演变本身也是有用信息：它证明配置确实被读取、白名单确实生效。

## 五、建议的三项修复（均在 `services/api`）

1. **补可观测性**（优先）：`safeStageError` 在脱敏对外的同时，应把底层错误
   （类型 + 消息，不含合同内容）记入日志。当前"什么都不记"使任何排查都必须
   反向从 Redis 挖 stacktrace。
2. **`ContractReviewTaskView` 增加失败原因字段**。客户端拿到 `failed` 却无法告知用户，
   小程序侧只能显示"服务端未说明原因"。这是产品缺陷，非仅排查不便。
3. **适配推理模型输出**：若第三节推断成立，需在 provider 解析处兼容
   `reasoning_content`，或调整 `max_tokens` / 请求参数确保 `content` 完整返回。

## 六、小程序侧状态（不阻塞，供参考）

前端链路已完整并经真机验证：布局（补状态栏占位）、格式白名单（取上传与抽取两道闸门交集，
`.doc` 可上传但抽取阶段被拒故排除）、真实文件名（`prepareNamedFile`，
`resolveSupportedKind` 依赖扩展名，临时名会导致类型解析失败）、PIPL 同意流程
（含委托处理方与敏感信息单独同意两项披露）、失败原因透传。

**前端不是本次故障的原因。**

## 七、方法记录

本人在此问题上连续误判六次，均为「用一个看起来支持结论的观察，当成结论的证据」：

1. 「服务端未配 AI」—— 只看本机 `.env` 推断线上
2. 「任务从未创建」—— 忽略客户端在终止态会主动 DELETE 任务
3. 「照片不清楚」—— 前端硬编码文案替服务端猜原因，用户传的是 Word 原文件
4. 「进程无环境变量」—— 应用走 dotenv 自读，`pm2 env` 本就看不到
5. 「处理器从不接手」—— 该组件无 Logger，零日志不等于未执行
6. 「换 flash 可绕过」—— 模型白名单是代码级合规约束

**第一次拿到硬事实，是去 Redis 把 failed job 的 stacktrace 读出来的时候。**
结论：涉及生产状态，去生产取证；日志无输出前，先确认该路径是否本来就会打日志。
