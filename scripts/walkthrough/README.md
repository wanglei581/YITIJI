# 本机走查用假服务

**只用于本机全链路走查。** 不得部署，不得指向生产或共用数据目录，也不得把假服务的输出当成真实 AI 能力的证据。内容全部是测试数据（虚构人物「测试·张建国」、测试号段手机号）。

| 文件 | 作用 |
|------|------|
| `fake-llm.mjs` | 假大模型，OpenAI 兼容接口，默认端口 4340 |
| `fake-baidu-ocr.mjs` | 假百度 OCR（换 token 与 `accurate_basic` 两个接口），默认端口 4341 |
| `seed-ai-model-config.mjs` | 把走查 API 的 AI 模型配置指向假模型 |
| `validate-fake-llm.ts` | 自检：用 `services/api` 里真实的服务类去调假服务，确认回包能通过校验 |
| `fake-llm-text.mjs` / `fake-llm-features.mjs` | 假模型内部模块 |

## 启动

```bash
node scripts/walkthrough/fake-llm.mjs          # FAKE_LLM_PORT，默认 4340，只监听 127.0.0.1
node scripts/walkthrough/fake-baidu-ocr.mjs    # FAKE_OCR_PORT，默认 4341
```

走查 API 需要的配置：

```bash
AI_PROVIDER=llm
OCR_PROVIDER=baidu
BAIDU_OCR_BASE_URL=http://127.0.0.1:4341
BAIDU_OCR_API_KEY=walk-fake   BAIDU_OCR_SECRET_KEY=walk-fake
```

大模型地址不能用后台接口改：后台会拒绝本机地址（`AI_BASE_URL_PRIVATE`），环境变量也只认厂商默认地址。所以要直接写配置文件，写完后重启走查 API：

```bash
FILE_STORAGE_DIR=<走查 API 的数据目录> SECRET_ENCRYPTION_KEY=<与走查 API 相同> \
  node scripts/walkthrough/seed-ai-model-config.mjs
```

合同审查的地址固定为 `https://api.deepseek.com/`，这个假模型接不上。小青数字人（TRTC）由腾讯云的服务器去调模型，也连不到本机。这两条链路都不在假模型的覆盖范围内。

## 故障模式

**假模型**。状态文件是 `${FAKE_LLM_STATE_DIR:-~/.cache/walk0929/fake-llm}/mode`，每次请求都会重新读取：

| 取值 | 效果 |
|------|------|
| `ok` | 正常回包（默认） |
| `timeout` | 挂住连接 200 秒不回 |
| `http500` | 返回 500，带 OpenAI 格式的错误体 |
| `http402` | 返回 402 `Insufficient Balance`（模拟模型账户余额耗尽，2026-10-04 线上 DeepSeek 实况） |
| `badjson` | 返回 200，但内容不是合法 JSON；纯文本对话会回空内容 |
| `blocked` | 返回 400，错误码 `data_inspection_failed`（内容安全拦截） |
| `slow` | 等 25 秒后正常返回 |

如果只想让某一次请求出故障，可以在任意自由文本框里输入 `【走查故障:timeout】`（冒号全角、半角都认）。这个标记只对那一次请求生效，优先级高于状态文件。

**假 OCR**。状态文件是 `${FAKE_OCR_STATE_DIR:-~/.cache/walk0929/fake-ocr}/mode`，可选值：`ok`、`lowconf`（平均置信度约 0.4）、`empty`（识别出 0 行）、`error`（等同于 `error17`，日配额用尽）、`error18`（QPS 超限）、`timeout`。在同一目录放一个 `text.txt`，可以替换默认的识别文本，每行一条。

## 日志

每次请求在状态目录的 `requests.jsonl` 里记一行。

- 假模型记录：上海时间、识别出的功能、模型、模式、prompt 字数，以及最后一条用户消息的前 200 字（用来检查 PII 是否已遮盖）。
- 假 OCR 只记图片的字节数，不记内容。

## 自检

先启动两个假服务，然后在 `services/api` 目录下运行：

```bash
FAKE_LLM_PORT=4340 FAKE_OCR_PORT=4341 SECRET_ENCRYPTION_KEY=<任意 ≥32 字符> \
  node -r @swc-node/register ../../scripts/walkthrough/validate-fake-llm.ts
```

注意：自检会改写两个假服务的 `mode` 文件，跑完会恢复成 `ok`。不要在别人走查的时候运行。
