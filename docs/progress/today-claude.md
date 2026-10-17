# 2026-10-17 恢复（Claude）

- **12:01**：
  - FLOW1a #1479 `05d26c1` 冻结：15 条门禁全过，反向检查 17 条中 16 条转红，agy 判「可以出候选」。
  - 实屏被会话 30 分钟过期挡在登录页，文档和参数两页没验到。
  - 会话梳理：短信账号恢复不了；补签不核对是不是同一会员，有静默切号风险。FLOW1b 方案已交 agy。
  - 已告诉 Monika 开发者工具「可以用了」。
- **11:13**：
  - VIS3c、VIS3d 推送，VIS3e #1478 `6ced7f3` 冻结为最终候选。11:08 在冻结 SHA 上重跑小程序 15 条 verify，全部通过。
  - 实屏：VIS3c 4 张，最终候选 4 张，都只在开发者工具 390 宽模拟器上看。CANON 已恢复。
  - 新预览：11:01 生成。用户手机两组指定检查通过；「我的文档」和打印参数链路重开为 FLOW1，不写整页验收。
  - CI：G09 精确 SHA 这次 run 全绿；#1478 的 build 和冒烟还在跑。
  - FLOW1 先只读定位，等 Codex 截图，方案交 agy 后才动代码。
  - 用户又加了两块：登录页的状态和布局；登录一次后自动恢复，不再反复要短信验证码。
  - 「我的文档」的刷新、重试不发请求，我和 Codex 各在沙箱里复现过一次。
- **10:33**：
  - VIS3a #1474 `ed73304`：实屏 14 张收口。上传页箭头的误判已更正。CANON 已恢复。
  - VIS3b `ec69af9`：本机 469/469，13 条反向检查转红；agy 实现复核中。
  - G09 `c8336f1` 已推，run `38993685472` 在跑。
  - 矩阵按四类收口状态更新。
  - 登录报错框是微信自己的；我们只补失败后的出口。
- **09:55**：
  - 恢复，取代昨晚 22:28 的暂停。用户口径：本会话约 7%，周额度约 62%，可以继续。
  - 主项目：两次临时切换（VIS1、OPS1）都由 Codex 做，都已切回 `cfbe56784`。切换前后的 SHA 和时刻记在 current-progress。
  - 实屏：VIS1、OPS1 候选局部通过；上传页返回图标、首页到面试的跳转、空态开始提示，这三项不算通过。
  - 矩阵：37/44 路由有实际证据，7 个受数据门禁没看到。
  - G09：冷审纠正了 `toHaveURL` 的机制。Grok 只改注释、本地提交，之后交 agy 终审，再推送。
  - 无障碍：微信用 `aria-role`。仓库多数写的是 `role=`，返回键 39/56 没有名称。
  - 时间更正：昨晚四条标题已改回提交时间。
  - 下一批 VIS3：先报预算，交 agy 审。

---

# 2026-10-16 20:00 后软件续办（Claude）

- **21:14 补**：
  - `8242781fa` 手机复验两项 PASS：订单显示与返回、我的文档 PDF。
  - 范围扩大到整个小程序：44 页，矩阵写进 reviews。
  - VIS1 方案送 agy 审。
  - G09 第二轮派给 Grok，用两段式 helper。
- **21:07 补**：
  - **小程序流程**：#1470，头 `8242781fa`，B1、B2 加一次修订，agy 终审「可以出预览」。预览已编译，等用户复验。
  - **后台防误登记**：#1471，头 `91e3d8b85`。
  - **G09**：接手协调。Grok-2036 的补丁还没提交，已交 agy 审。#1469 的 `:142` 另记，不说两处已修好。
  - **正式发布缺口表**：写进 current-progress 21:07 那一条。
- **额度**：会话 20:00 恢复。本会话没有 get_usage 工具，读不到周额度和 5 小时额度的百分比。请求正常受理，没有切换账号，没有开付费追加。
- **小程序打开原文**：
  - 分支 `claude/miniapp-print-ux-20261016`，草稿 PR #1469，叠在 #1466 上。提交 `6026e535a` → `c0cca1e8a` → `e1af0aeac` → `689047e9f`。
  - 改了 6 个文件：`utils/file-url.js`、`pages/print-preview/print-preview.js`、`pages/documents/documents.js`，新测试 `scripts/tests/file-preview.test.mjs`，`package.json` 的一行，`page-lifecycle.test.mjs` 的一条。
  - 验证：
    - 20 条新用例；
    - 页面生命周期 237 条；
    - 小程序全量静态门禁 exit 0；
    - 反向检查 16 处，逐一变红后复原；
    - agy 两轮复核。
  - 手机：两个 PDF 入口和正常返回都 PASS。下载中途返回、图片两项待真机复验。
- **手机预览的来源**：一次性冻结副本 `/Users/wanglei/.codex/worktrees/miniapp-candidate-689047e9f`，是 Claude 建的，Codex 说用完后由 Claude 删除，不加 `--force`。主项目 `zhiyida-miniapp-main` 保持在当前源码基线 `cfbe567`，不动。
- **存储超限日志**：只记证据，不改代码。
- **G09 CI**：已接手收货。Grok 的诊断已读，方案交 agy 复核，等结论再派实现。
- **B1**：新分支 `claude/miniapp-print-flow-ux-20261016` 从 `689047e9f` 起，预算 6 个源文件，做完单独开草稿 PR。

---

# 2026-10-16 商用收口统筹接任（Claude）

- 接收完整交接报告：正文已读完，附录按模块分段读；工作分支 `claude/closeout-commander-20261016`，叠在 #1466 分支 `03439f5` 加两笔文档提交上，#1466 的头提交不动。
- 冒烟：Grok CLI 和 agy 都照本机现有配置调用，命令行不加绕过参数，都能正常出结果。
- 派工：
  - Grok-A：G06 文件授权，把 #1444、#1446 移植到 main。
  - Grok-B：G09 招聘锁，把 #1430、#1452、#1453 移植到 main。
  - agy：给 #1465、#1466 的精确差异找反例。
  - 两个工作区各自隔离验证库和 Redis 库号。本机 shell 带的 `RUST_LOG=warn` 会让 Prisma 引擎报一条空错误，已在环境文件里改成 `info`。
- G00：
  - 从 Codex 会话记录逐字重放，恢复了原版备份脚本（SHA 与原记录一致）。
  - 从作业日志取到两个版本安装包的权威哈希。
  - 另存了 CI 制品；最近的一份 10/17 到期。
- 升级包审查：写了只读检查脚本（分四个阶段）和只读 SQLite 查询脚本，查询脚本在同款表结构的测试库上实跑过，没有写库。核出升级后服务会变成手动启动、需要恢复为自动，以及降级被禁止、回滚要先卸载这些事实。真机由 Codex 执行，Claude 不碰 UU。
- 复核：agy 报的两个 P0，经 Grok 用全量源码复现、Claude 对代码再核，都不成立；成立的低档项列进修复清单。
- 正式文档：current-progress 和 next-tasks 顶部各加一条 10/16 15:20 的记录。

---

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
