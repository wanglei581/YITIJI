# 2026-07-11 AI / 求职产物 printFileUrl 契约修复（Hermes）

- 独立分支：`codex/ai-artifact-print-url-contract-20260711`，基线 `origin/main=69fed4fc`。
- TDD RED：新守卫 28 项失败，覆盖 shared、API 签名生成、Kiosk 消费和缺 URL 阻断。
- GREEN：AI 产物、我的文档和招聘会资料入口统一只向打印链路传内部 HMAC `printFileUrl`；COS `signedUrl` 仅预览/下载；求职材料 mock 打印按钮诚实禁用。
- 招聘会资料：新增 SQLite/PostgreSQL 双 additive `FairMaterialPrintBridge`，60 分钟派生 FileObject 复用、lease + 唯一 activeKey single-flight、20MiB 内部受信任桥接、源大小/魔数/MIME/SHA-256 复核；下架/禁打/删除撤销 bridge，活跃任务保留履约文件，旧 HMAC URL 不可借保留窗口创建新任务。
- 安全回归：`verify:admin-fairs` 覆盖 15MiB+1、20MiB、并发、篡改、撤销/履约；`verify:print-jobs` 继续拒绝外部、缺签名和篡改 URL；相关 SQLite 运行时 verify、三端 typecheck、lint/build、SQLite/PG Prisma generate 均通过。
- 最终短复审：APPROVE，Critical/High/Medium 均为 0；边界仍为未 commit/push/merge/deploy，后续合并后才执行预生产安全探针。

---

# 2026-06-04 L2-2 member-auth 后端骨干重建(Claude)

## 分支

`claude/l2-2-member-auth-backend`(从 `main` 9c07385 新开,未 push、未 merge)

## 任务边界

只重建 C 端求职者「手机号验证码登录」后端骨干,不做前端 UI、不做登录中心 mock、
不碰岗位/收藏/jobsMeta/seed。只读参考 `feat/end-user-account` 的 auth 文件,不整支 cherry-pick。

## 实现要点

- `member-auth` 模块独立 JwtModule,`audience='enduser'` + 30min 过期,与内部 AuthModule 不合并
- Redis 强前置(REDIS_URL 未配置即抛错,无 inline fallback):验证码(TTL 5min)/
  多维频控(手机号日 / IP 时 / 设备时)/ 登录会话(member:session:{jti})
- 手机号不落明文:`phoneHash`=HMAC-SHA256(pepper 复用 SECRET_ENCRYPTION_KEY)唯一查找,
  `phoneEnc`=AES-256-GCM(复用 secret-cipher);login/me 只回 `phoneMasked`
- 双向隔离:内部 `JwtAuthGuard` 拒 `aud='enduser'`;`EndUserAuthGuard` verify 强制 aud=enduser 拒内部 token
- logout 删 Redis 会话即失效(JWT 未过期也作废);DTO 白名单(forbidNonWhitelisted)越界字段 400
- 新增 `verify:member-auth` E2E 脚本:真实 HTTP 跑通 发码/400/越界/429冷却/错码401/登录/
  /me/落库隐私/logout失效/双向隔离,共 10 组检查 **ALL PASS**

## dev.db / migration 处理

dev.db 存在历史 drift(本地迁移与 `_prisma_migrations` 不一致,既有问题)。
**未运行破坏性 `migrate dev reset`**;沿用 AiResumeResult / FieldMappingRule 先例,
新增 `20260604140000_add_end_user` 迁移文件,通过 `prisma db execute --file` 非破坏性建表,
不动既有数据与迁移表。

## 验证结果

typecheck / lint / build 全过;redis-cli ping = PONG;`pnpm verify:member-auth` 全绿。

---

# 2026-06-02 W3 起步完成(Claude × Codex 协作)

## 跨设备记录规则

本文件只保存 Claude 当日开发摘要、协作收尾、demo 链路和关键验证结果，不保存完整聊天记录。

换设备、换模型或让其他 AI 接手时，先读取：

1. `AGENTS.md` 或 `CLAUDE.md`
2. `docs/progress/current-progress.md`
3. `docs/progress/next-tasks.md`
4. `docs/product/feature-scope.md`
5. `docs/compliance/compliance-boundary.md`
6. `docs/progress/today-claude.md`

删除、清理、移除页面或文件的记录应写入 `docs/progress/current-progress.md` 的更新记录，并以 Git commit 作为最终追溯来源。聊天记录只能作为辅助背景，不作为项目事实来源。

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
