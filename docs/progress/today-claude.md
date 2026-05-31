# 2026-06-02 Claude 今日动手清单(W3 起步 — C 方案)

## 角色

P0 冲刺 **W3 Day 1+2 合并**(用户选 C 方案:JobSource 加凭证 + Webhook 接收端,
跳过 BullMQ 拉取与 Excel 字段映射,把"我方可接企业推送"作为最强 demo 信号)。

## 分支

`feat/p0-w3-claude-webhook-sync`(stacked on `feat/p0-w2-claude-jobfair-be7` @ `6ca2121`)

## 将编辑/新建的文件

**后端 Day 1 — JobSource 字段扩 + 加密层**:
- `services/api/prisma/schema.prisma`(JobSource 加 endpoint / authType / encryptedCredential / webhookSecret 等)
- `services/api/prisma/migrations/<ts>_extend_job_source_for_sync/`(新建)
- `services/api/src/common/crypto/secret-cipher.ts`(新建,AES-256-GCM 加解密层)
- `services/api/.env.example`(添加 `SECRET_ENCRYPTION_KEY`)

**后端 Day 2 — Webhook 接收端**:
- `services/api/src/sync/`(新建模块)
  - `sync.module.ts` / `sync.controller.ts` / `sync.service.ts`
  - `dto/webhook-payload.dto.ts`
  - `replay-guard.ts`(in-memory nonce LRU,5min TTL)
- `services/api/src/app.module.ts`(注册 SyncModule)
- `services/api/src/jobs/jobs.service.ts`(暴露 `importJobsFromWebhook(sourceId, items)`)

**Codex 接续补齐 — 数据源最小闭环**:
- `services/api/src/jobs/dto/data-source.dto.ts`(新建 Partner 数据源创建 DTO)
- `services/api/src/jobs/jobs.controller.ts`(补 `/partner/data-sources` 三个接口)
- `services/api/src/jobs/jobs.service.ts`(数据源列表 / 创建 / 启停;Webhook secret 只返回一次并加密落库)

## 路由

```
POST /api/v1/sync/webhook?source=<jobSourceId>
  Headers:
    X-Webhook-Signature: hex(HMAC-SHA256(webhookSecret, timestamp + '.' + body))
    X-Webhook-Timestamp: unix seconds(±5min 窗口)
    X-Webhook-Nonce: uuid(5min 内不可重复)
  Body: { items: [ {externalId, title, company, city, salary?, sourceUrl, ...} ] }
  → 200 { imported: N, taskId? }
  → 401 SIG_INVALID / SIG_EXPIRED / SIG_REPLAY(全部同一错误码,防探测)
  → 400 字段不合规
```

## 合规边界检查(每条都过)

- ✅ HMAC-SHA256 签名,timingSafeEqual 防侧信道
- ✅ 5min 时间窗口防过期重放
- ✅ Nonce LRU 防同一请求二次提交
- ✅ webhookSecret AES-256-GCM 加密落库;验签前服务端解密,前端不回显
- ✅ rawBody 缺失时直接 401,不允许 fallback 到 JSON.stringify(body)
- ✅ ImportJobsDto 字段白名单 → 企业塞"候选人邮箱"等触红线字段直接 400
- ✅ 写入默认 `pending` + `draft`,必须 admin 审核后才上 Kiosk
- ✅ Audit:`action='job.import'`,`payload={source:'webhook', sourceId, count}`
- ✅ 401 不区分原因(防 sig/timestamp/replay/source 哪个错的探测)

## 阻塞 Mavis 的事项

- W3 Day 1+2 全程:Mavis 不要碰 `services/api/src/sync/`、`services/api/src/common/crypto/`、`services/api/prisma/`

## Mavis 可并行

- 接 `handoff-to-mavis.md` M-001 校企合作 banner
- Kiosk fair 7 页接真 API(M-002)
- A3 Admin 文件管理 UI
- A5 Admin 审计 UI

## 预计完成时间

UTC+8 EOD。Day 1 + Day 2 合并到一天完成(两块代码量都不大)。

## 完成清单

- [x] JobSource 字段扩 + migration
- [x] secret-cipher.ts AES-256-GCM 加解密
- [x] .env.example 添加 SECRET_ENCRYPTION_KEY
- [x] SyncModule + Controller + Service + ReplayGuard
- [x] jobsService.importJobsFromWebhook
- [x] `/partner/data-sources` 列表 / 创建 / 启停最小闭环
- [x] app.module 注册
- [x] curl smoke:伪造请求 + 真请求两种（错签名 401;正确签名 201 imported=1）
- [x] API typecheck + lint + build
- [ ] commit
