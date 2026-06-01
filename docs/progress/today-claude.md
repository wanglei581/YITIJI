# 2026-06-02 W3 起步完成(Claude × Codex 协作)

## 分支

`feat/p0-w3-claude-webhook-sync`(stacked on `feat/p0-w2-claude-jobfair-be7`)

## 协作记录

用户在 Claude 写完 W3 起步骨架后让 Codex 接续完成。Codex 的贡献:
- 安全加固:webhookSecret AES-256-GCM 加密落库(原 plain),
  rawBody 缺失直接 401(原 fallback 到 JSON.stringify)
- 补齐"数据源最小闭环":/partner/data-sources GET/POST/PATCH 三个端点
- 配套 Partner 前端 /sources 页改造(创建弹窗 + Webhook secret 一次性显示)
- typecheck/lint/build 全过 + smoke 全过

Claude 接续动作:
- Review 全部 Codex 改动(参考 commit e3d4629 + 工作区前端 5 文件)
- 端到端 smoke 自验:登录 → 创建 webhook 源 → HMAC 签名推送 → 防重放 → 错签名 → audit 链
- 补齐 AuditAction 枚举('data_source.create' / 'data_source.toggle')

## 关键端到端验证结果

```
1. POST /auth/login {partner1/partner1}              → token ✓
2. POST /partner/data-sources {name, accessMode:webhook}
   → { id, webhookUrl: '/api/v1/sync/webhook?source=X',
       webhookSecretOnce: 'cnpz...E', credentialConfigured: true } ✓
3. POST /sync/webhook?source=X  + HMAC(timestamp.body)
   → { imported: 1, receivedRequestId } ✓
4. POST /sync/webhook same nonce 重放 → 401 同错误码 ✓
5. POST /sync/webhook 错 sig → 401 同错误码 ✓
6. Job 落 reviewStatus=pending + publishStatus=draft ✓
7. Admin 查 audit → 看到 data_source.create + job.import(source='webhook')✓
```

## 合规守住

- ✅ HMAC-SHA256 timingSafeEqual 防侧信道
- ✅ 5min 时间窗口防过期重放
- ✅ Nonce 5min LRU 防同一请求二次提交
- ✅ webhookSecret AES-256-GCM 加密落库,前端只见 credentialConfigured
- ✅ rawBody 缺失直接 401(不允许 JSON.stringify(body) fallback)
- ✅ ImportJobsDto / WebhookPayloadDto 字段白名单 → 企业塞红线字段直接 400
- ✅ Webhook 写入默认 pending+draft,必须 admin 审核才能上 Kiosk
- ✅ Audit:data_source.create + job.import(source=webhook),IP/UA/requestId 留痕
- ✅ 401 不区分原因(防 sig/timestamp/replay/source 哪个错的探测)

## 总产出 commit(W3)

```
9b383c1  feat(partner): 数据源创建上接 Codex 后端 + Audit 枚举补齐
e3d4629  feat(api): W3 webhook sync 接收端与数据源最小闭环  (Codex)
d1adf67  docs: today-claude.md W3 起步 意图
```

## 实际可演 demo 故事

> 1. Partner 后台 → 数据来源 → "新增数据源"
> 2. 选 Webhook → 填名称 "字节跳动 ATS 接入" → 保存
> 3. 弹出窗口显示 Webhook URL + Secret(只显示一次)
> 4. 用 Postman / curl / 字节自己 ATS 系统按文档 HMAC 签名推送岗位
> 5. Admin 后台 → 岗位信息源 → 看到刚推过来的"前端工程师"待审核
> 6. Admin 点 "通过" → "上架" → Kiosk 看到岗位卡
> 7. Admin 后台 → 审计日志 → 整链路追溯(data_source.create / job.import / job.review / job.publish)
> 8. 演示防重放/错签名:重发同 nonce / 改一字节 → 立即 401

## 阻塞 Mavis 的事项

无。本批改动均在 Claude 独占 + 已结束。

## 下一步选择

- A. push W3 分支让 hook 跑校验 + 开 PR(stacked,等 PR #1 → PR #2 顺序合)
- B. 继续 W3:做 BullMQ API 拉取 + Excel 字段映射 + 校企合作 banner handoff 跟进
- C. 暂停 W3,先把 W1 PR #1 + W2 + W3 三条线一次合掉再说

## 备注

W1 PR #1 hotfix `a22cdc1` 仍在 stacked 链上。
demo-w2 临时分支可删除(role-boundary.md 已 cherry-pick 到 W2 主线)。
