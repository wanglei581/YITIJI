# 上线前全面体检清单（2026-09-05）

> 基线 `origin/main@1d7468cda`。13 路只读代码审查 + 1 路公开检索。每条带 file:line 与触发→结果，可逐条复现。
> 严重度：P0 上线阻塞 / P1 必修 / P2 改善。ID 前缀：API 后端、ADM-C/M/A 与 OPS 管理员后台、PTR 合作机构、JOB/SES/AI/MSC/PRT 一体机、AGT 终端 Agent、MP 小程序、X 横切。
> 交互版（可勾选）：https://claude.ai/code/artifact/19e89ffa-8ac1-4a3b-9910-a83fe19ab111 ；原型体检：https://claude.ai/code/artifact/56a843c3-1907-4c14-8ad9-34b81784c135



---

# 横切 / 我自己核实的发现（主会话）

基线：worktree HEAD=1d7468cda = origin/main，2026-09-05。

## 工具链与门禁事实
- 七个包 typecheck 全部干净（shared/ui/admin/partner/kiosk/terminal-agent/api）。
- CI lint 目标（api/kiosk/admin/partner）干净：kiosk 9 条 Fast Refresh warning、0 error。
- `verify-ci-gate-coverage`：16 条确定性门禁直接执行；382/388 verify/ui 门禁在 CI 闭包内，6 条已登记豁免。
- 三端 vite.config 生产构建强制 `VITE_API_MODE=http`，否则拒绝构建。

## X-01（P2）terminal-agent 不在 CI lint 范围，11 条 eslint error
- `apps/terminal-agent/package.json` 无 `lint` 脚本；`ci.yml:216-219` 只 lint api/kiosk/admin/partner。
- 用根 `eslint.config.mjs` 扫：`agent/dpapi.ts:25 err 未用`、`agent/scan-input/windows-secure-reader.ts:221 _bytes 未用`、`agent/wmi.ts:107,156 多余转义 \"`×8、`printer/print-with-powershell.ts:27 ext 未用`。
- 是否掩盖逻辑错误待硬件链路专家逐条判定。修法：加 `lint` 脚本并接进 CI（先清掉 11 条）。

## X-02（P1，跨三端）`fmtSyncTime` 按 UTC 切片，公开/Admin/Partner DTO 都用它
- `services/api/src/jobs/jobs-shared.ts:439-441`：`d.toISOString().replace('T',' ').slice(0,16)` → 输出 UTC 的「YYYY-MM-DD HH:mm」且无时区。
- 消费者：`prismaJobToListItem`(582, 公开/Kiosk)、`prismaJobToAdminDto`(605)、`prismaJobToPartnerDto`(621)、`prismaFairToListItem`(653)、`prismaFairToAdminDto`(686)、`prismaFairToPartnerDto`(705)、`prismaJobSourceToPartnerDto`(550)、partner sync-logs(927/951)。
- Admin `job-sources/index.tsx:252,361`、`fair-sources/index.tsx:252,362` 原样显示该字符串 → 差 8 小时。
- Kiosk `CampusTabs.tsx:79-82 fmtSync`、`JobFairsPage.tsx:46`、`jobs-fairs-prototype.tsx:147 formatDate` 用 `new Date(str)` 把 UTC 串当本地解析；北京时间 08:00 前的同步会显示成**前一天**。CLAUDE.md §10 要求岗位详情必须展示「同步时间」，这是展示真值问题。
- 修法（最小）：`fmtSyncTime` 改为按 `Asia/Shanghai` 格式化（与 `partner-stats.service.ts` 同口径），或返回 ISO 并让三端各自 `toLocaleString`。Partner 招聘会 `startTime/endTime`（`fairs/index.tsx:333-334` 直接 slice ISO）同批修。
- 同源于 Partner 专家 PTR-01；升级为跨端 P1。

## X-03（P2）API 服务里硬编码 `take: N` 无 total/truncated 的模式约 25 处
- 例：`jobs-admin.service.ts:234 take:500`、`content.service.ts:63,349 take:500`、`smart-campus.service.ts:128,179 take:500`、`companies.service.ts:309 take:200`、`benefit-activities.service.ts:39,133 take:200`、`terminal-toolbox.service.ts:503 take:500`、`member-feedback.service.ts:126 take:100`、`job-ai.service.ts:319 take:100`。
- 与已登记的 admin-ops 告警 `take:50` 同类；上线初期数据量小不炸，但都是「被截了看不出来」。建议统一：要么分页要么响应带 `truncated`。

## 已登记、仍 OPEN 的上线阻塞（文档已有，非本轮新发现）
- BL-01 运行时 1/51 页按青序流光新稿实现（工程）。
- BL-02 生产实例 `771d53e2`（2026-08-18 部署）落后 origin/main 100+ 提交，未复验（运维）。
- BL-03 Windows 一体机真机打印/扫描/Agent 未验收：建单→到机码→支付→claim→出纸→回流（现场）。
- BL-05 百度 OCR 密钥曾在聊天暴露，须轮换（产品负责人）。
- B2 生产库岗位/招聘会/政策 `total:0`，需授权来源录入。
- 招聘信息专区缺可信终端身份的服务端总闸门（P0 架构缺口，另一会话处理中）。
- 平台可靠性遗留：EndUserAuthGuard Redis 无界等待 23s；admin-orgs 缓存失效假失败；admin-ops 告警 take:50。
- 扫码上传 Redis 过期后 FileObject 生命周期；`GET /me/summary` 不存在；mock-only 字段 `onsiteServices/admissionMethod/tagline`。
- 奔图开放 API 彩色 mode 三处措辞不一致（`packages/shared/src/types/print.ts:100-107`、`apps/terminal-agent/src/printer/types.ts:47-48 vs 76-77`、`docs/device/pantum-api-design.md:87`）。

## 横切扫描干净项（不必再查）
- 违规投递文案：用户可见源码 0 处（命中皆为黑名单本身/免责声明/帮助 FAQ）。
- 打印机型号硬编码：代码/配置 0 处（命中皆为注释、用户提示、测试夹具）。
- 前端 TODO/FIXME 0；console.log 前端 0、API 2。
- `window.open` 在 `isTerminalKiosk` 下改走二维码（`JobDetailPage.tsx:120-126`）。
- `.env.example` 密钥均为明显占位并有生产门禁（`assertProductionRuntimeGates`）。


---

# NestJS API 上线前缺陷审查（HEAD=1d7468cda）

P0 本轮未新增；已知 P0「招聘信息专区缺可信终端身份总闸门」的同类暴露面（供一并收口）：`POST /print/jobs`（`x-terminal-id` 头，print-jobs.controller.ts:62）、`POST /scan/sessions`（body terminalId）、`POST /print/sign/*`、`POST /trtc/session`（仅判头非空）、`POST /activity/*`、`POST /kiosk/feedback`。只有 `member/auth/qr/create|claim` 真正校验终端 Agent token（member-qr-login.service.ts:214-220），可作参照。

| ID | 严重度 | 模块 | 文件:行 | 现象 | 触发→错误结果 | 建议 | 置信 |
|---|---|---|---|---|---|---|---|
| API-01 | P1 | job-sync | `job-sync/ssrf-guard.ts:32-43`、`job-sync.service.ts:441,457` | SSRF 守卫不识别 `::ffff:a.b.c.d`、NAT64/6to4/组播；DNS 解析与 fetch 两次解析（rebinding） | 机构 endpoint 指向 AAAA=`::ffff:169.254.169.254` → 管理员启用同步 → 读内网/元数据落 pending Job | `::ffff:` 剥壳按 IPv4 判；固定 IP 连接；每跳重判 | 高 |
| API-02 | P1 | ai | `ai/llm/llm-chat.service.ts:222-240`、`ai.service.ts:787`、`assistant-chat.dto.ts:24-27` | `/assistant/chat` 记忆以客户端可任传、默认毫秒时间戳的 sessionId 为键，无归属 | 匿名传他人 id → 读到/污染其近 12 条对话 | randomBytes 铸 id + 绑定 endUserId/ip 摘要；Map 上限 | 高 |
| API-03 | P1 | print-jobs/terminals/files | `print-jobs.service.ts:109,290`、`terminals-agent.service.ts:463`、`files.service.ts:571-579`、Agent `task-runner.ts:331-336` | 建单时 30 分钟签名 URL 落进 `PrintTask.fileUrl`，claim 原样下发不重签；匿名文件 1h TTL 后 `/content` 404 | 已付款、终端离线/缺纸 >30min 恢复 → 下载 401 → `PRINT_COMMAND_FAILED`，订单仍 paid，不进核查流 | claim 事务内用 fileId 重签；`/content` 对在途任务放行 | 高 |
| API-04 | P1 | 审计横切 | `print-sign.service.ts:350-352`、`print-conversion.service.ts:271-273`、`contract-review-report.service.ts:229-231`；AuditLog.actor FK | 用 `actorId: endUserId`（EndUser id）写带 User 外键的 AuditLog，`AuditService.write` 吞错 | 签章/图片转 PDF/合同报告审计 INSERT P2003 → 静默丢失（**dev.db 副本已复现**） | `actorId:null` + payload 带 endUserId（files.controller.ts:403 做法）；加门禁 | 高 |
| API-05 | P1 | files | `files.service.ts:505-506`、`files.controller.ts:262-275`、`deriveOwner:1269-1272` | 管理员取文件 URL 只在 `ownerType==='user'||endUserId` 时审计；匿名一体机上传（身份证/简历扫描件）`ownerType='system'` | 管理员看匿名 id_scan → 零审计（违反 §11） | admin 非本人上传即审计 | 高 |
| API-06 | P1 | member-auth | `member-auth.service.ts:413-435`；`EndUser.wxOpenId @unique` | 微信登录按手机号找/建用户后无条件写 wxOpenId，未处理该 openid 已绑另一用户 | 微信换绑手机/手机号已短信注册 → P2002 → 500，该微信永久无法登录 | 先按 wxOpenId 查；冲突按规则迁移/拒绝 | 高 |
| API-07 | P1 | payment | `order-status.service.ts:203-233` vs `:96-121` | `markPaidOnline` 缺 `markPaid` 的取件窗口守卫且无条件再铸明文 pickupCode | 迟到回调 closed→paid 钱入账无法出纸；线上支付云打印单多一枚无 hash「幽灵码」 | 复用 `mintPickupCode = pickupCodeHash==null`；过期单记「已收款待退」 | 高 |
| API-08 | P1 | payment/pickup | `online-payment.service.ts:767-770`、`pickup-order.service.ts:96-99`、`member-print-order-create.service.ts:203,287-291` | 云打印单认领出码未付，15 min 惰性关单 closed 但 pickupStatus 仍 claimed | 再输码 `ORDER_PAYMENT_UNAVAILABLE`；小程序不可取消；仍显示有效到机码 → 死局到码过期 | 关单时回滚 pending/unpaid 或置 expired 并允许取消 | 高 |
| API-09 | P1 | payment | `online-payment.service.ts:242-252` | `provider.createQrPayment` 事务外抛错未捕获 | 渠道 5xx → 500 无审计；订单已 paying、尝试 created 存活到 QR TTL 300s → 收银台卡 5 分钟 | 捕获→尝试 failed、订单 CAS 回 unpaid、审计、返回 503 | 高 |
| API-10 | P1 | payment | `alipay.provider.ts:408-429,435-452`、`online-payment.service.ts:849-852,221` | 当面付预下单顾客未扫码时 `TRADE_NOT_EXIST` → unknown → 尝试不释放 | 不扫码 5 分钟后重新出码一直 PENDING 到关单 | `qr_code_timeout_express`；本地过期后 NOT_EXIST 视 closed | 中 |
| API-11 | P1 | legal(admin) | `admin-legal-docs.controller.ts:22-31`、`legal.service.ts:118-130` | body 为 TS 接口非 class → ValidationPipe 跳过；create 无审计；activate 审计不 await 且吞错 | 缺字段 → Prisma 500；条款版本谁建谁激活无留痕 | DTO；审计进事务 writeRequired | 高 |
| API-12 | P1 | mock-interview | `mock-interview.service.ts:185-221,222-250` | 候选人回合先落库再调 LLM；done 后仍收答案；end/start 无 CAS | LLM 503 重试 → 报告失真；并发两次 end → 双付费 + 唯一冲突 500 | 顺序校验；`asked>=target` 拒收；CAS | 高 |
| API-13 | P2 | terminals | `terminals-agent.service.ts:357-369`、heartbeat.dto | 心跳每 30s 追加，全仓无 deleteMany；字符串无 MaxLength | 每台/年约 100 万行 | 清理任务 + 长度上限 | 高 |
| API-14 | P2 | jobs/public | `jobs-shared.ts:656` | 公开招聘会 `managedMaterialCount:0` 写死 | Kiosk「0 份·可打印」 | `_count.materials` | 高 |
| API-15 | P2 | offline-agencies | `offline-agencies.service.ts:101-119` | 公开列表回 contactEmail；service 过滤在分页后做，total 失真 | 邮箱泄露；第 1 页空后页有 | 去 select；过滤下推 | 高 |
| API-16 | P2 | job-sync | `job-sync.controller.ts:96-116`、`job-sync.service.ts:483-486` | response-config 无 DTO/审计、直接 `this.service['prisma']`；拉取 `res.json()` 无体积上限 | 任意大 JSON 落库；慢滴流拖垮 worker | DTO+审计；字节上限+AbortController | 高 |
| API-17 | P2 | member-auth | `member-auth.service.ts:335-341` | 短信日桶用 UTC 日期 | 每日上限北京 08:00 重置 | Asia/Shanghai 分桶 | 高 |
| API-18 | P2 | member-auth | `:28,293`、`redis.service.ts:100-123` | 会员会话固定 1800s 无续期 | 小程序每 30 min 强制重登 | 滑动续期 | 中 |
| API-19 | P2 | auth | `auth.service.ts:108-119`、`app.module.ts:86,158` | 内部登录只每 IP 5/min，无按账号锁定；Throttler 进程内存 | 多 IP/多实例爆破线性放大 | 账号维度锁定；Redis storage | 高 |
| API-20 | P2 | print-jobs(admin) | `admin-print-jobs-abandon.service.ts:126-135`、verify-outcome | 废弃/核查 not_printed 已付款订单不触发或提示退款 | 钱在 paid 纸不出 | 标 refundRequired 或串联 Refund | 中 |
| API-21 | P2 | common/auth | `optional-end-user.ts:45` | 可选会员解析直接 `redis.get` 不经 tryRedis | Redis 故障 + 带 Bearer 的匿名端点等待后 500 | tryRedis 有界 | 高 |
| API-22 | P2 | stubs | `kiosk-session.controller.ts:5-12`、`notifications.controller.ts:9-12`、`activities.controller.ts:11-13` | 三个未鉴权 stub 返回假成功/假数据，前端无调用 | 违反不伪造能力；死代码 | 删除或 501 | 高 |
| API-23 | P2 | audit | `audit.service.ts:109-121` | limit/offset/日期 NaN 直达 Prisma | `?limit=abc` → 500 | 查询 DTO | 高 |
| API-24 | P2 | member-notifications/feedback | `member-notifications.service.ts:47-81`、`member-feedback.service.ts:64-69` | `total=items.length`、`nextCursor:null`、两源各截 take 再合并 | 旧通知不可达；unreadCount 大于可列出数 | 分别 count；复合游标 | 高 |
| API-25 | P2 | orgs | `admin-orgs.service.ts:311-345` | 建机构+建账号非同一事务 | 账号冲突 → 机构已建无账号 | 单事务 | 高 |
| API-26 | P2 | 审计横切 | `admin-orgs.service.ts:469-490,392-404,442-467,496-540`、`admin-org-content-trust.service.ts:100-122`、`admin-print-scan.controller.ts:106-122`、`content.controller.ts:287-306` | 高权限动作先提交再吞错 audit.write | 审计失败仍 success | writeRequired 进事务 | 高/中 |
| API-27 | P2 | files | `files.service.ts:430-431,463-466,323` | complete 后原直传签名仍可重写；COS sha256 客户端声明；PII 预检按 fileId | 隐私检查后替换内容再建单 | 仅 uploading 可写；服务端算 sha256；PII 比对 sha256 | 中 |
| API-28 | P2 | files | `files.controller.ts:216-225`、`upload-options.dto.ts:13-29` | raw PUT 先缓冲 200MB 再按用途限 20MB；kiosk/partner token 可传 admin_upload 用途 | 内存放大；命名空间污染 | 流式限额；角色→用途白名单 | 高 |
| API-29 | P2 | files | `files.service.ts:1089-1090,673-692`、`upload-sessions.service.ts:348-350,380-386` | 显式 sensitiveLevel 可降级留存；删除不查在途任务；扫码上传文件绑定会员后仍在 `tmp/` | id_scan 24h；打印中 404；90 天简历被清 | 取更严者；删前查任务；绑定时改键 | 中 |
| API-30 | P2 | trtc | `trtc.controller.ts:14-18,86-92`、`trtc.service.ts:183-186`、`tencent-api.util.ts:73-85` | stop 归属键 `ip|UA`（同厅一体机相同）；停止失败仍 ok；腾讯 API 无超时 | 同厅互停付费会话；假成功持续计费 | 每会话随机 secret；失败 503；超时 | 高/中 |
| API-31 | P2 | ai | `ai.service.ts:352-408`、`llm-chat.service.ts:204-211`、`advisor.service.ts:345-358,441`、`self-assessment.controller.ts:76-84`、`ai-config.controller.ts:62-88` | optimize 懒执行无并发锁（双扣费）；chat Map 无上限；advisor pins 无上限；self-assessment 未走 DTO；admin baseURL 无校验（管理员 SSRF） | 双计费；内存 DoS；500；test 探内网 | NX 锁/上限/DTO/IsUrl+私网拒绝 | 高 |
| API-32 | P2 | consent | `member-privacy.service.ts:12-20` | consent 只覆盖 job_ai/contract_review；简历 AI 入口不查 UserAiConsent | 撤回后仍调模型 | 加 scope 或文档化 | 中 |
| API-33 | P2 | jobs/admin | `jobs-admin.service.ts:104-129`、`companies.service.ts:413-433`、`policies.service.ts:295-313`、`job-sync.service.ts:323-335` | publish check-then-write；数据源批量下架不撤打印桥 | 竞态 pending+published；下架后 1h 旧签名仍可打印 | updateMany where approved；下架撤桥 | 中（另一会话在改） |
| API-34 | P2 | jobs/public | `fair-material.service.ts:247-250`、`fair-venue-guide.service.ts:183-186`、`fair.mapper.ts:161-165`、`jobs-shared.ts:389`、`companies.service.ts:168-170` | 子资源不套 demo 排除；公开 detail 暴露 reviewedBy；重复 query 数组 `.trim` 500；「今日」按服务器时区 | 泄露审核元数据；`?keyword=a&keyword=b` 500 | 剥离；firstString；固定时区 | 中 |
| API-35 | P2 | content | `content.controller.ts:274-282`、`content.service.ts:213-220` | 宣告 Accept-Ranges 不处理 Range，整段视频入内存；listPlaylists 无 take | 视频拖动失败；打满内存 | 流式 Range；分页 | 高 |
| API-36 | P2 | legal/activity | `legal.controller.ts:9-12`、`activity.controller.ts:54-83` | 未知 type 回落服务条款；日志 terminalId 任意字符串 | 隐私政策标题下显示服务条款；伪造终端进后台 | 400；校验终端 | 高 |

## 控制器鉴权核对（89 个）
admin/* 全部类级 JwtAuthGuard+RolesGuard admin ✓（缺口 API-11/16/26）；me/*、member/* EndUserAuthGuard ✓；terminals：register 生产关闭、heartbeat/claim 等走 hash 凭证 ✓，`config/printer-status/capabilities/toolbox-events` 公开（即已知 P0）；print-jobs/scan/sign/upload/ai 公开段以资源级随机 token/签名 URL/支付 HMAC 授权，无 IDOR（缺口 API-02/21/30）；webhook HMAC+时间窗+nonce ✓；三个 stub 公开假成功（API-22）。

## 未覆盖
partner 段（另一专家）；alipay/wechat provider 本体未亲读；terminals-admin 仅部分；N+1 未系统扫；PG/SQLite 差异只验 FK 一处。

## 核实过无问题
Agent 凭证 hash/代次/吊销/常量时间 ✓；claim 事务三重 CAS ✓；patchTaskStatus 归属与迁移白名单 ✓；扫描 token/去重/CAS ✓；签章归属/魔数/上限/幂等 ✓；生产门禁（密钥长度、沙箱禁止、PII 强制、CORS）✓；会员 aud 隔离/验证码锁定/换绑踢会话 ✓；支付验签先于解析、金额三方比对、唯一约束、退款守卫 ✓；文件签名绑定/TTL/防穿越/魔数/tombstone ✓；公开内容 approved+published、凭证不出响应 ✓；AI 配置只回 apiKeyConfigured、日志无 PII、失败不回落 mock ✓。


---

# 补缺审查：Admin 核心运维页 + Kiosk 打印主链路（HEAD=1d7468cda）

## 块 A：Admin 核心运维页
| ID | 严重度 | 页面 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| OPS-01 | P1 | 日志审计筛选 | `audit/index.tsx:41-55`；后端 `auth.service.ts:119,153`、`files.controller.ts:400`、`admin-orgs.service.ts:860` | 下拉 4 个筛选值后端从未写过（`system.login`/`user.disable`/`file.force_delete`/`organization.update`，实际是 `auth.password_login`/`admin.user.disable`/`file.delete`/`org.self_profile_update`）→ 选中恒空「没有记录」，合规审计页假阴性 | 改为后端真实 action 名或导出常量表；补 ACTION_LABELS | 高 |
| OPS-02 | P2 | 订单/打印扫描运维/工作台 | `orders/index.tsx:19-52`、`admin-orders-readonly.controller.ts:11`、`print-scan/index.tsx:44-66`、`dashboard/index.tsx:106-112` | 任务态 `cancelled/abandoned`、支付态 `paying/closed` 映射缺失 → 裸英文、灰徽章；订单页无法按「已废弃」筛（后端 400） | 补映射与筛选 | 高 |
| OPS-03 | P2 | 订单退款 | `orders/index.tsx:255-269` | 退款失败只显示裸错误码；退款成功但重拉详情失败也显示「失败」不关对话框 | 错误码文案表；成功分支拆开 | 高 |
| OPS-04 | P2 | 文件管理 | `files/index.tsx:62-66,94-100`、`files.service.ts:634` | 一次性拉 200 条（含已删除），筛选/搜索/分页全在这 200 条内，无截断提示 | 服务端分页筛选 | 高 |
| OPS-05 | P2 | 工作台 | `dashboard/index.tsx:483-509,523,540-547` | 9 个接口 `Promise.all` 任一失败整页错误；「处理告警(N)」取 `alerts.length` 忽略 `firingCount` | `allSettled` 分区降级；用 firingCount | 高 |
| OPS-06 | P2 | 计费改价 | `billing/index.tsx:62-68`；DTO `@Min(0)`；`print-jobs.service.ts:426,459-460` | 单价可改 0 且确认只说「即时生效」；0 元单直接 paid/free 跳过收银 | 对 0 加显式警示 | 高 |
| OPS-07 | P2 | 打印机页 vs 工作台 | `printers/index.tsx:18-24,219-221`、`dashboard/index.tsx:600,620-621`、`terminals-admin.service.ts:707-709` | `paperTrayLevel` 一处当「张」一处当百分比；`PAPER_MAP` 的 low/jam 后端永不产出；未知故障码故障列显示「—」 | 统一单位；default 回显原始码 | 中 |
| OPS-08 | P2 | 用户停用/恢复 | `users/UserStatusDialog.tsx:410-413,492`；DTO `@MinLength(2)` | 提示 2–200 字但非空即可点 → 1 字 400 显示后端校验串 | 前端 ≥2 | 高 |

## 块 B：Kiosk 打印主链路
| ID | 严重度 | 链路 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| PRT-01 | P1 | 确认页/收银页错误透出 | `PrintConfirmPage.tsx:404-406`；`printJobsApi.ts:130,143`；`PrintCashierPage.tsx:117,143,168,367`；`paymentApi.ts:227-289` | 适配层抛 `Error('createPrintJob failed: 400 {…JSON…}')` / `'missing terminal id'` / `'createPayAttempt failed: 400 ONLINE_PAYMENT_DISABLED'`，页面 `err.message` 原样上 27 寸屏 | 解析 error.code 抛带 code 的错误；页面按 code 映射中文 | 高 |
| PRT-02 | P1 | 进度页任务态 | `printJobsApi.ts:58`；`PrintProgressPage.tsx:322-338,136-139,180-191`；后端 `print-jobs.service.ts:552`；写入 `admin-print-jobs-abandon.service.ts:111`、`member-privacy.service.ts:147`、`admin-print-scan.service.ts:350,655` | 前端只识别 completed/failed；`cancelled/abandoned` 落到 queuing → 「正在确认任务状态」转圈 10 分钟 → 超时文案「可能仍在队列」，与真实（已废弃可退款）相反 | 终态分支 + `BackendJobStatus` 补两值 | 高 |
| PRT-03 | P1 | 直达 /print/confirm 离线仍建单收款 | 门禁只在 `PrintPreviewPage.tsx:284,319-320,707`；确认页无设备状态引用；19 个直达入口（MyDocumentsPage:212、resume/* 8 处、job-fairs/* 2、interview/* 2、contract-review、ScanResultPage、SignStampPage、ConvertImagesPage 等）；后端 `print-jobs.service.ts:332-338,371-378` 与 `order-quote.service.ts:54-56` 只查能力登记与 lifecycle，无心跳检查 | 打印机离线 → 我的文档点「打印」→ 报价成功 → 建单 → 付款 → 进度页 10 分钟超时；钱已收、无纸 | 后端 create/quote 对最近心跳 fail-closed（offline/paper_empty/error → 400 PRINTER_UNAVAILABLE）；确认页接 `useTerminalDeviceStatus` 禁用主按钮 | 高 |
| PRT-04 | P1 | 进度页轮询容错 | `PrintProgressPage.tsx:339-342,238-249`；`PrintDonePage.tsx:241-252` | 单次 `getPrintJobStatus` 抛错即 `navigateFail('无法连接打印服务')`；3 秒轮询期间任一网络抖动/429（terminalId 为空时按 IP 桶）→ 跳「打印任务已由服务端确认失败」，而打印机正在出纸 | 连续失败 ≥N 才判；文案「暂时无法读取状态」 | 高 |
| PRT-05 | P2 | 收银页终态后仍轮询 | `PrintCashierPage.tsx:270-303`；`cashierStatus.ts:113-122` | closed/failed/refunded 后 2.5s 轮询不停 | 终态 clearInterval | 高 |
| PRT-06 | P2 | 进度页超时文案 | `PrintProgressPage.tsx:349-355,415-433` | 10 分钟超时统一「可能仍在队列」，即使最后状态是 printing；之后完成不再更新 | 按最后状态区分；printing 不超时 | 高 |

## 核实过无问题
信封匹配 ✓；DTO 白名单 ✓；退款/废弃/核查/停用/删除/退役/改价/关闭告警/取消任务均有确认 ✓；§11 文件预览走 `/files/:id/url` 写审计 ✓；§12 mark-paid/refund/print-scan/close-unpaid/告警处置各写审计 ✓；权限页/外设页诚实空态（非假配置）✓；Admin 侧在线判定统一 3 分钟 ✓（toolbox 2 分钟例外）；参数原样送后端 ✓；报价与扣款同一 PricingService、页数服务端识别 ✓（billing 页 `print_duplex_surcharge` 是死标签）；未付不能出纸（claim 只取 paid、收银只 paid 可进）✓；完成页只在 completed 说完成 ✓；主按钮 88/72/56px ✓。


---

# Admin 内容源页审查（job-sources / fair-sources / policy-sources / fairs / companies / sync-sources / import-batches）

## P1
- **ADM-C1 fairs › 参展企业「新增企业」规模未选即 400**：`fairs/components/CompaniesTab.tsx:13,37,65-66` 把 `scale:''` 原样提交，`admin-fair.dto.ts:135-136` `@IsOptional()` 不跳过空串 → `VALIDATION_FAILED`。编辑 scale 为 null 的企业同样。修：与 `ZonesTab.tsx:40` 一致 `scale: form.scale || undefined`。
- **ADM-C2 fair-sources 时间列渲染裸 UTC ISO**：`fair-sources/index.tsx:243-244` 直接显示 `s.startTime`（后端 `jobs-shared.ts:675-676` `toISOString()`），显示 `2026-06-20T01:00:00.000Z` 且差 8 小时；mock 数据是预格式化本地串，掩盖了契约分歧。修：用 `fairs/components/shared.ts:59 fmtDateTime`。
- **ADM-C3 三个来源页 审核通过/发布/下架 静默失败**：`job-sources/index.tsx:110-135`、`fair-sources/index.tsx:118-143`、`policy-sources/index.tsx:73-89` `.then` 无 `.catch`，全应用无 ErrorBoundary/unhandledrejection 处理。触发：发布内容信任失效机构（`jobs-admin.service.ts:116`）或字段不全（`:123`）或非法迁移（`:54`）→ 400 后界面无任何反馈。修：`.catch` 行内显示 `ApiHttpError.message`。
- **ADM-C4 sync-sources 已归档源显示为「待启用」且可点「审批并启用」**：前端 `ApiSyncSourceItem`（`sync-sources/index.tsx:28-42`）缺 `archived`；后端 `job-sync.controller.ts:201` 明确下发并注释此风险 → 点击必 400 `SOURCE_ARCHIVED`。修：加字段、显示「已归档」、禁用按钮。
- **ADM-C5 sync-sources 所有失败只显示「操作失败」**：`:119-127` `throw new Error('HTTP '+status)` 丢弃 body；`:244-255` catch 只存 id。五种可行动原因（SOURCE_ARCHIVED/ORG_DISABLED/NO_ENDPOINT/ENDPOINT_NOT_PUBLIC/capability）全被抹平；`handleTrigger:238` 同样。修：解析 `body.error.message`。
- **ADM-C6 companies 列表硬截 200 无分页无 total**：`companies.service.ts:305-311 take:200`；页面 `companies/index.tsx:41-55,118-169` 无分页。第 201 家不可见无提示。修：返回 `{data,total}` + 分页，或至少提示。
- **ADM-C7 fairs › 活动资料 清空「说明」不生效**：`MaterialsTab.tsx:80` `description.trim() || undefined` → JSON 丢字段 → `fair-material.service.ts:187` 视为未提供 → 旧文本保留。修：清空时发 `''`/`null`。

## P2
- ADM-C8 import-batches 每页选择器失效且显示值 15 不在选项内（`import-batches/index.tsx:36,258-264`）。
- ADM-C9 import-batches →「查看招聘会」按机构过滤但横幅声称按批次（`:245` → `fair-sources/index.tsx:91-93,171-173`；`AdminFairSourceRecord` 无 sourceId）。
- ADM-C10 fairs 各 Tab 行级删除/发布无 catch（`CompaniesTab.tsx:92-100`、`ZonesTab.tsx:52-60`、`MaterialsTab.tsx:93-111`）。
- ADM-C11 fairs › 场馆导览 未保存草稿切 Tab 即丢，按钮「完成」误导（`fairs/index.tsx:187`、`VenueGuideTab.tsx:71,325`）。
- ADM-C12 下架 一键无确认（`job-sources:311-319`、`fair-sources:311-319`、`policy-sources:253-257`、`companies/ReviewPublishSection.tsx:193-200`、`MaterialsTab.tsx:176-184`）；对比 `sync-sources:267` 有 confirm。
- ADM-C13 时区：`policy-sources/index.tsx:207`、`import-batches/index.tsx:38-41` `slice(0,16)` 把 UTC 当本地。
- ADM-C14 标签失真：`fair-sources/index.tsx:360` 「展位数」实为 companyCount（`jobs-shared.ts:680`）；`job-sources/index.tsx:357` 「行业」在 http 模式永远为空（`jobs-shared.ts:600 industry: undefined`），mock 有值。
- ADM-C15 无界查询：`jobs-admin.service.ts:45,143`、`policies.service.ts:253` `findMany()` 无 take，三个来源页纯前端分页；`admin-fairs.service.ts:105-109` 全量，`fairs/index.tsx:106-137` 全渲染无搜索。
- ADM-C16 副标题缺「供给哪个前端页」：job-sources、fair-sources、sync-sources、fairs 页级（已有：policy-sources、companies、import-batches、VenueGuideTab）。

## 核实过无问题
信封配对（job-sources/fair-sources/import-batches/policy-sources/fairs/bulk-publish 裸对象；companies/job-sync `ApiResponse.ok` 解包）；`reason/rejectReason` 不发 undefined；`UpdateFairInfoDto` 接受 null 清空；COMPANY_TYPES/INDUSTRIES 前后端同步；BulkPublishButton 两步确认、逐项失败展示；EligibilityRulesDrawer 三态；筛选重置 page；DangerDeleteButton 两步；StatsTab 拒绝把 0 当数据；企业发布门禁前后端一致；无死链。


---

# Admin 机构/会员/线下机构/法务/隐私页审查（partners / offline-agencies / legal-docs / privacy-requests / member-*）

## P1
- **ADM-M1 partners 停用/启用机构失败零提示**：`partners/index.tsx:508-516` `toggleOrg` 无 catch，`:685` `void` 调用 → 未处理拒绝，徽章不变、无提示。修：照 `PartnerAccountManager.tsx:127-138` 加 catch → 页级错误横幅。
- **ADM-M2 member-benefits 搜索失败渲染空白页**：`member-benefits/index.tsx:103-105` catch 只 `setState('error')` 不设 message，`:192` 与 `:310` 两个守卫都不渲染 → 无错误、无空态、无 spinner（loading 也空）。
- **ADM-M3 benefit-activities 打开+保存把活动窗口整体平移 −8h**：`:47-50 toLocalInput` 把 UTC 串塞进 datetime-local，`:145-146` 再按本地转 UTC。每次不改日期直接保存都漂 8 小时；显示本身也差 8 小时。`fmt()`（:42-45）同样。
- **ADM-M4 offline-agencies 增删改岗位后列表行审核/发布状态不刷新**：前端 `:395-399` 只 patch `jobCount`；后端 `offline-agencies.service.ts:430-434,461-464` 已把机构重置为 pending/draft → 表格仍显示「已通过/已发布」并给「下架」按钮，机构已从 Kiosk 消失而无人知道需复审。修：岗位变更后 `loadList()`。
- **ADM-M5 member-privacy 只取第一页 20 条，丢弃 nextCursor 无翻页**：`memberPrivacyAdmin.ts:59-63` → `page.items`；后端默认 20（`member-data-request.admin.ts:44`）。>20 条工单后不可见。同端点的 `/privacy-requests` 页实现了游标翻页（`:168-182`），两页重复。修：加翻页或删掉 `/member-privacy` 保留 `/privacy-requests`。

## P2
- ADM-M6 硬截断当全集：member-feedback `take:100`（`member-feedback.service.ts:126`，页面 `:234` 打印 `items.length 条`）；member-notifications `take:100`（`:146`）；member-benefits `take:100`（`admin-member-benefits.service.ts:70`）；benefit-activities `take:200/100`（`:39,133,152`）。工单队列 #101 起不可见。
- ADM-M7 UTC 当本地（5 页）：`member-notifications:29-31`、`privacy-requests:51-53`、`member-privacy:39-41`、`member-benefits:42-45`、`benefit-activities:42-45`；`legal-docs:23-32`、`OrgContentTrustPanel.tsx:59-63` 做对了。
- ADM-M8 partners 启用模块勾选框给出服务端必 400 的选项：`partners/index.tsx:155-171` 渲染全部 `MODULE_LABELS`；后端矩阵 `admin-orgs.service.ts:89-137`（licensed_hr_agency 禁 policy_service/smart_campus；fair_organizer/enterprise_source 任何勾选都拒）→ `ORG_TYPE_MATRIX_VIOLATION`。修：按类型投影允许集（在 `packages/shared/src/types/partner.ts` 加常量）。
- ADM-M9 legal-docs 被取代的已发布版本标成「草稿」：`legal-docs/index.tsx:157-163`；后端 `legal.service.ts:107-116` 仅置 isActive=false，publishedAt 仍在。修：三态徽章。
- ADM-M10 枚举裸露：`member-benefits:282` `sourceType`；`benefit-activities:230-231` `sourceType/benefitType`（标签表存在未用）。
- ADM-M11 offline-agencies 下架/发布无确认（`:144-160,336-351`；删除有 confirm）。
- ADM-M12 partners 内容信任改 suspended/revoked 无确认（`OrgContentTrustPanel.tsx:254-262`；只有 active 方向要 reason）。
- ADM-M13 JobsDrawer 删除岗位失败静默（`JobsDrawer.tsx:240-243`）。
- ADM-M14 草稿跨记录残留：`privacy-requests:66-78` RejectDialog 常驻，A 的驳回理由预填到 B；`member-feedback:129-141` 回复框不随工单切换清空，可能发给错误用户。
- ADM-M15 JobsDrawer `pageSize=100` 硬编码且用 `data.length` 覆盖列表 `jobCount`（`offlineAgenciesAdmin.ts:236`、`JobsDrawer.tsx:182-184`）：150 条显示 100 且列表被改成 100。
- ADM-M16 privacy-requests `useState(() => { void load() })` 当挂载副作用（`:152`），渲染期 setState、StrictMode 双发。修 `useEffect`。
- ADM-M17 memberPrivacyAdmin 唯一无 `API_MODE` 分支的适配器（`:11`）→ mock 模式下该页恒「加载失败」（仅开发/演示）。
- ADM-M18 mock 模式把「无数据源」说成「查无此会员」（`member-benefits:97-100` + `memberBenefitsAdmin.ts:76-78`）。
- ADM-M19 副标题缺「供给哪个前端页」：partners、offline-agencies、legal-docs、privacy-requests、member-feedback、member-notifications、member-privacy、member-benefits。
- ADM-M20 partners 删除账号最终确认弹窗「返回」实为关闭整个流程并撤销票据（`PartnerAccountActionDialog.tsx:166` vs `PartnerAccountDeleteConfirmationDialog.tsx:409`）。置信中。

## 核实过无问题
信封解包逐一对控制器核实 ✓；分页形状 ✓；`forbidNonWhitelisted` 全部表单字段白名单 ✓；Partner 凭证流不回显密码、票据撤销、失败刷新给 result_uncertain ✓；无假成功 toast ✓；法务激活/广播撤回/机构删除/岗位删除/权益撤销/活动发布结束/启停两步/邮箱换绑/隐私驳回 均有确认 ✓；筛选重置 page ✓；无死链 ✓；GovernanceDrawer 三态与取证审计 ✓；合规：无候选人/面试/Offer UI，`PROHIBITED_MODULES` 服务端硬拒 ✓；member-feedback 匿名工单不渲染死回复框 ✓。


---

# Admin AI / 设备配置类页审查（toolbox / screensaver / smart-campus / ai-config / ai-services / job-materials / account-settings / login）

## P0
- **ADM-A1 微应用发布到终端后，该终端的百宝箱配置永远无法保存（400）**：`toolbox/components/TerminalToolboxRow.tsx:39,63` 把 GET 回来的 items（含投影项的 `riskLevel`/`disclaimers`，来自 `toolbox-projection.ts:49-50`）原样 `...item` 放进 PUT；`save-toolbox-config.dto.ts:16-74` `ToolboxItemDto` 未白名单这两个字段，`main.ts:90` `forbidNonWhitelisted` → `property riskLevel should not exist`，界面兜底文案「请检查路径和内容」误导。触发：发布任一微应用版本到终端 → 终端投放配置改任何东西 → 保存必 400，手动项永久不可编辑。修：`normalizeDraftItem` 显式构造对象，或 DTO 加可选字段（服务端 `mergeGovernedProjectionItems` 本就忽略）。

## P1
- **ADM-A2 screensaver 终端配置「已保存」但服务端静默存 enabled=false**：`content.service.ts:331-332` 无方案时强制 false；`screensaver/index.tsx:701-720` 丢弃返回值、本地态不刷新（同 key 不重挂）；`idleTimeoutSec` 输入 10 存 30 显示仍 10。修：应用返回的 config 到本地态；无方案时禁用勾选。
- **ADM-A3 smart-campus 同样静默强制 enabled=false**（`smart-campus.service.ts:106,111-112`；前端 `:31,43-47`），且 `catch` 丢掉后端错误。
- **ADM-A4 `/toolbox`、`/smart-campus` 不用 `Page` 组件，mock 模式警告横幅不显示**（`toolbox/index.tsx:66-80`、`smart-campus/index.tsx:117-122` vs `Page.tsx:16-20`）。
- **ADM-A5 toolbox 启动统计请求失败时渲染硬 0**（`ToolboxLaunchSummaryCard.tsx:6-11`、`toolbox/index.tsx:46-49` 失败静默 summary=null → `?? 0`）。
- **ADM-A6 账号设置「最近登录记录」http 模式恒为空**：查 `action:'system.login'`（`account-settings/index.tsx:115`），后端实际写 `auth.password_login`/`auth.sms_login`（`auth.service.ts:119,153`）；mock 有一行掩盖。
- **ADM-A7 最近登录记录不按 actorId 过滤且第 0 行硬标「当前会话」**（`account-settings/index.tsx:115,327-334`；后端支持 actorId `audit.controller.ts:24,35`）→ 修好 A6 后会列出他人登录与 IP。
- **ADM-A8 AI 大模型页不展示 `inheritedFrom`，15 个功能位中 8 个把父配置当自己的**：`aiConfig.ts:32-43` 无该字段；后端 `llm-config.service.ts:63-72` 注释明确要求标注；保存会静默分叉。
- **ADM-A9 screensaver 删除/启停无错误路径**（`screensaver/index.tsx:176-192,470-478` 无 try/catch）。
- **ADM-A10 「熔断当前应用」无确认**（`ToolboxGovernancePanel.tsx:234`；`ToolboxAllowedHostPanel.tsx:94` 暂停/归档同）。

## P2
- ADM-A11 治理面板成功消息渲染成红色（`ToolboxGovernancePanel.tsx:190`）；ADM-A12 AllowedHost 面板成功/错误同灰色（`:77`）。
- ADM-A13 `/ai-config` 每次切功能位整页重载并丢未保存编辑（`ai-config/index.tsx:68-92`）。
- ADM-A14 停用 AI 能力/轮换 key 无确认（`ai-config/index.tsx:370,400`）。
- ADM-A15 `/ai-services` 错误态无重试（`:244`）。
- ADM-A16 AI 调用日志裸 UTC ISO（`ai-services/index.tsx:725`）。
- ADM-A17 求职材料库「已停用」模板显示绿色徽章（`job-materials/index.tsx:126-128`）。
- ADM-A18 播放方案编辑硬编码 `status:'active', enabled:true` 静默重新激活（`screensaver/index.tsx:458-459`）。
- ADM-A19 播放方案编辑器对已停用素材显示裸 UUID（`:513,591`）。
- ADM-A20 AI 文生图状态请求失败显示「暂未启用」（`:52,68-70`）。
- ADM-A21 `verifyToken` 无法清除过期手机绑定（`services/auth/index.ts:544-546`；`/auth/me` 只回 userId/role/orgId）。
- ADM-A22 `PhoneBindingCard.tsx` 222 行死代码且调旧非严格端点。
- ADM-A23 手机换绑卡 5xx 后 300s 冷却把「返回」也禁用（`AdminPhoneTransferCard.tsx:83-88,266`）。
- ADM-A24 密码重置「重新发送」失败静默、无 loading 防重复（`login/index.tsx:576-582,322-346`）；ADM-A25 重置成功无确认（`:250-259`）。
- ADM-A26 登录页法务文档硬编码 v1，与 `/legal-docs` 脱节（`login/LegalDocsModal.tsx:17-74`）。
- ADM-A27 协议勾选内嵌 link 的 Enter 既开文档又切勾选（`login/index.tsx:735-754`）。
- ADM-A28 `upsertAllowedHost/reviewAllowedHost` 返回类型是 mock 虚构（`toolbox.ts:134-136` vs 后端 `{host,purpose,status}`）。
- ADM-A29 AllowedHost `expiresAt` 自由文本（`ToolboxAllowedHostPanel.tsx:68`）。
- ADM-A30 副标题缺目的地：`/ai-services`、`/ai-config`、`/job-materials`。

## 核实过无问题
信封（content/smart-campus/toolbox/ai/ai-config 裸对象；job-materials `ApiResponse.ok` 解包）✓；API key 永不回显，「保存并测试连通」真实上游调用 ✓；AI 用量真实聚合、三态成本 ✓；AI 日志服务端筛选分页 ✓；各 DTO 白名单兼容（仅 ToolboxItemDto 坏）✓；屏保上传 Authorization/boundary ✓；素材/方案删除有 confirm ✓；无死链 ✓；手机绑定/换绑状态机严谨 ✓；mock/http 对齐已刻意修过 ✓。


---

# 合作机构后台（Partner）功能缺陷 + 租户隔离审查

- 审查对象：worktree `HEAD=1d7468cda`（= origin/main），`apps/partner/src`（42 文件）+ 对应后端 `partner/*` 端点
- 方式：只读代码审查；所有结论均以本 worktree 代码为证据（file:line）
- 并发工作已剔除：jobs-partner.service 的「审核状态迁移」不在本报告；「驳回原因回传 + 侧栏投影」「凭证轮换 + 归档 + 熵校验」在本 worktree 均已合入，下文只报它们遗留的缝隙

## 0. 结论摘要

| 严重度 | 数量 |
|---|---|
| P0 上线阻塞 | 0 |
| P1 必修 | 2 |
| P2 改善 | 23 |

**租户隔离：未发现 IDOR / 跨机构可达 / 凭证回显。** 所有 `partner/*` 端点的 orgId 都来自 JWT 回源后的 `user.orgId`（`optional-internal-user.ts:81` 强制 partner 必有 orgId 且机构启用），每条 Prisma 读写都带 org 过滤或取回后比对。

## 1. 汇总表

| ID | 严重度 | 页面路由 | 文件:行 | 现象 | 触发场景 → 错误结果 | 建议修法 | 置信度 |
|---|---|---|---|---|---|---|---|
| PTR-01 | P1 | /fairs、/jobs、/sync-logs、/ | `apps/partner/src/routes/fairs/index.tsx:333-334`；`services/api/src/jobs/jobs-shared.ts:439-441`、`:699-700` | 招聘会开始/结束时间与全部 `syncTime` 按 UTC 展示，无时区标注 | 机构录入 6-15 09:00 → 列表显示「06-15 01:00」；机构去「编辑」改成 09:00 → 真实时间被推后 8 小时 | 服务端 `fmtSyncTime` / `prismaFairToPartnerDto` 改用 Asia/Shanghai（与 `partner-stats.service.ts:47-49` 同口径），或前端统一 `toLocaleString('zh-CN')`（编辑抽屉 `isoToLocalInput` 已正确） | 高 |
| PTR-02 | P1 | /jobs | `apps/partner/src/routes/jobs/index.tsx:51-56, 197, 221`；`services/api/src/jobs/dto/partner-edit.dto.ts:49-50`；`jobs-partner.service.ts:692` | 编辑「校招」岗位时前端把 `category: 'campus'` 映射成 `workType: 'full_time'`，保存后后端 `category` 被改写为 `fulltime` | 机构只改一个错别字保存 → 岗位从校招变全职，Kiosk 校招筛选丢失该岗位 | `UpdatePartnerJobDto.workType` 的 `@IsIn` 加 `'campus'`，`WORKTYPE_OPTIONS` 加「校招」，`CATEGORY_TO_WORKTYPE.campus = 'campus'`；或 `workType` 未改动时不下发 | 高 |
| PTR-03 | P2 | /sources Excel 导入弹窗 | `ExcelImportModal.tsx:107, 271-283`；`jobs-excel.service.ts:185` | 「岗位数据 / 招聘会数据」两个按钮不按 `canImportJobs / canImportFairs` 投影 | `licensed_hr_agency` 选「招聘会数据」→ 填完 7 个必填映射 → 点「生成预览」才 403 | `ExcelImportModal` 读 `useCapability(...)`，禁用对应按钮并说明原因 | 高 |
| PTR-04 | P2 | /profile | `profile/index.tsx:32-41, 150` | 机构类型标签表缺 `school_employment_center / licensed_hr_agency / enterprise_source` | 高校就业中心看到原始枚举「school_employment_center」 | 改用 `@ai-job-print/shared` 的 `PARTNER_TYPE_LABELS`（`packages/shared/src/types/partner.ts:196-200`） | 高 |
| PTR-05 | P2 | /jobs、/fairs、/policy | `import-jobs.dto.ts:30-31`；`partner-edit.dto.ts:34-35, 78-79`；`policies/dto/policy.dto.ts:51-52` | `sourceUrl`/`externalUrl` JSON 录入与编辑路径只有 `@IsString @MaxLength`，无 http(s) 校验（Excel 路径、企业 DTO 都校验） | 机构录入无协议 URL → 200；Kiosk `isValidSourceUrl` fail-closed 后「去来源平台投递」不可用，机构与 Admin 都看不出为什么 | 三处 DTO 加 `@IsUrl({protocols:['http','https'], require_protocol:true})` 或复用 `normalizeOptionalHttpUrl`；前端表单同步预校验 | 高 |
| PTR-06 | P2 | /sync-logs | `jobs-partner.service.ts:934-942`；`sync-logs/index.tsx:46-55, 102` | 后端 `take: 100` 无分页；无按来源筛选；「日志编号」`no` 由数组下标生成，每来一条新日志就换号 | 超过 100 条后老日志静默消失；运营按编号找日志刷新后指向另一条 | 端点加 `page/pageSize/sourceId/result`；`no` 改用 `id` 或落库序号；前端补分页与来源下拉 | 高 |
| PTR-07 | P2 | /sources 新增数据来源 | `sources/index.tsx:144-146` | 创建失败一律显示「创建失败，请检查登录状态或稍后重试」，吞掉服务端 `error.code/message` | Webhook 密钥低熵 400 `WEBHOOK_SECRET_LOW_ENTROPY` 有明确文案 → 机构只看到「检查登录状态」 | 与 `RotateCredentialDrawer.tsx:82-102` 同口径：按 `code` 映射文案，兜底用服务端 `message` | 高 |
| PTR-08 | P2 | /sources 「查看接入」抽屉 | `sources/index.tsx:640-642` vs `:32-36, 308-309` | 抽屉里推送地址用 `${API_BASE_URL}/sync/webhook?...`（相对路径无 host）；创建面板用 `resolveWebhookUrl(API_ORIGIN)` 拼绝对地址 | 机构把没有域名的地址交给对接方 | 抽屉改用 `resolveWebhookUrl(...)` | 高 |
| PTR-09 | P2 | /sources Excel 导入弹窗 | `ExcelImportModal.tsx:212-216`；`sources/index.tsx:621-626` | `handleConfirm` 先调 `onImported()`（父组件卸载弹窗），再 `setStep('done')` → 第 4 步「导入完成」永远渲染不到 | 每次确认导入弹窗直接消失，步骤条第 4 步是死 UI | 先 `setStep('done')`，`onImported` 改在「关闭」按钮触发 | 高 |
| PTR-10 | P2 | /sources Excel 导入弹窗 | `ExcelImportModal.tsx:223-228, 492`；`jobs-excel.service.ts:300-329` | 只有 `step === 'preview'` 关闭才 `DELETE /partner/excel/:batchId`；「上一步」再「生成预览」会新建第二个批次，第一个永远 `pending` | 每次预览都落一条 `ImportBatch` + 全量 `ImportRecord`（最多 1 万行/批）；Admin 导入批次页堆积 pending 孤儿 | 「上一步」/关闭时对已存在的 `preview.batchId` 调 cancel | 高 |
| PTR-11 | P2 | Excel 招聘会导入 | `jobs-excel.service.ts:268-275, 444-448, 254` | Excel 路径不校验 `endAt > startAt`（JSON 路径有）；`sourceUrl.startsWith('http')` 接受 `httpfoo` | 结束早于开始的招聘会进库，Kiosk 直接判「已结束」 | 预览校验补 `endAt > startAt`；改 `normalizeOptionalHttpUrl` | 高 |
| PTR-12 | P2 | Excel 导入 | `jobs-excel.service.ts:225-238, 278-285`；`ExcelImportModal.tsx:440-443` | 预览把机构名下所有已存在 externalId 判为 `dup` 并跳过 → Excel 永远无法更新存量记录；提示「先处理原记录」但机构没有删除入口 | 机构每月用同一张表刷新 500 条 → 全部 dup、0 条更新 | 产品定口径：dup 行走 upsert 回 pending 重审，或把提示改成真实可行路径 | 高 |
| PTR-13 | P2 | / vs /stats | `jobs-partner.service.ts:897, 900, 903, 917`；`partner-stats.service.ts:95, 122-129`；`dashboard/index.tsx:221` | 工作台「待审核」= 仅 `pending`、不含企业；统计页 = `pending + reviewing`、含企业；工作台「去查看」固定跳 `/jobs` | 两页看到 3 vs 5 | 统一口径；「去查看」按类型跳转 | 高 |
| PTR-14 | P2 | /policy、/companies | `policy/index.tsx:298-301`；`companies/index.tsx:442-446` vs `components/RejectReason.tsx:21-31` | 驳回原因三态只在岗位/招聘会页落地；政策页与企业页 `rejected + null` 什么都不显示 | 存量被驳回政策显示「已拒绝」却无任何原因/下一步 | 两页改用 `<RejectReason>` | 高 |
| PTR-15 | P2 | /stats | `stats/index.tsx:334`；`partner-stats.service.ts:184-189`；`docs/product/partner-permission-matrix.md:106-116` | 副标题「我发布的内容产生了什么效果」，但「效果」区块恒为「暂无归因数据」；权限矩阵承诺的浏览量/服务数据/打印量未实现 | 机构按标题期待效果数据，得到的是同步批次统计 | 副标题改为「本机构内容与同步统计」；矩阵标注「归因未落地」 | 高 |
| PTR-16 | P2 | /stats | `services/api/stats.ts:192-198` | 唯一不走 `redirectToLogin()`、不带 `credentials:'include'` 的适配器 | token 过期后统计页显示「加载失败」+「重试」，其它页会回登录 | 复用 `partnerHttpAdapter.get` 或补 401 分支 | 高 |
| PTR-17 | P2 | /sources | `sources/index.tsx:372-380, 446-455, 475` | 页面自己再拉一次 capabilities，失败即整页「加载失败」；全站约定是 `CapabilitiesProvider` 单次拉取 + fail-open | 能力接口抖动一次 → 数据源列表都看不到 | 改用 `usePartnerCapabilities()`，能力为 null 时只禁用「新增」 | 高 |
| PTR-18 | P2 | /terminals、/account | `routes/terminals/index.tsx`、`routes/account/index.tsx`（各 15 行 EmptyState）；`PartnerLayoutWrapper.tsx:52, 54`；`auth.controller.ts:237-247` | 两个 §9A 范围页仍是 stub 但仍挂侧栏（`next-tasks.md:986` A-2 未执行）；后端已对 partner 开放 `POST /auth/password/change`，控制台没有改密入口 | 12 项导航 2 项通向「本阶段不开放」；机构改密只能走登录页「找回密码」 | 摘导航或加「未开放」角标；账号页至少接「修改密码」 | 高 |
| PTR-19 | P2 | /jobs 编辑抽屉 | `partner-edit.dto.ts:24-51`；`jobs/index.tsx:441-473`；`JobQualitySummaryPanel.tsx:70` | 编辑 DTO/表单缺 `educationRequirement / experienceRequirement / skills / benefits / salaryMin / salaryMax / validThrough / headcount`（导入 DTO 与 Excel 都有） | 质量面板提示「需要补技能等字段」，机构点「编辑」却无处补 | 编辑 DTO 与表单补齐结构化字段 | 高 |
| PTR-20 | P2 | /companies | `companies/index.tsx:369-373`；`companies.service.ts:515-518` | 企业资料前后端都不按机构类型限制；矩阵没有「企业资料」一节 | `fair_organizer` 可录入任意企业展示资料 | 产品定口径后加 `canManageCompanies` 前后端同源投影 | 中 |
| PTR-21 | P2 | 后端 /partner/jobs/import、PATCH /partner/jobs/:id、/partner/excel/:id/confirm | `jobs.controller.ts:442, 473, 648` | 三个 `@PaidAiThrottle` 装饰器写在上一方法结尾与下一方法 JSDoc 之间，实际作用于 `importJobs`(10/分)、`updatePartnerJob`(30/分)、`confirmExcelImport`(10/分) 并挂每 IP 每小时天花板 | JSON 对接机构每分钟第 11 次导入即 429；真正读 AI 快照的 `quality-summary` 反而没限流 | 装饰器移到目标方法装饰器栈内并加注释；评估是否该用 `AuthScopedThrottle` | 中 |
| PTR-22 | P2 | /jobs、/fairs、/policy、/companies | `jobs-partner.service.ts:476-479, 716-719`；`policies.service.ts:134-137`；`companies.service.ts:497-502`；`jobs/index.tsx:128-146` | 列表全量返回且前端 60s 轮询；企业列表 `take: 200` 静默截断 | 大机构每分钟拉全量；第 201 家企业不可见无提示 | 列表端点加分页/游标；至少显示「仅展示最近 200 家」 | 高 |
| PTR-23 | P2 | 全部 12 页 | 各页副标题 | 副标题均未写「对应前端哪个页面」 | 机构不知道岗位进「一体机·岗位信息 / 小程序·求职」 | 每页副标题加一句目的地 | 高 |
| PTR-24 | P2 | /smart-campus | `smart-campus.service.ts:181` | `listPartnerSmartCampusTerminals` 加载全部机构的配置行再内存匹配；响应无泄露 | 性能问题 | `where: { terminalId: { in: [...] } }` | 高 |
| PTR-25 | P2 | /sources | `jobs-shared.ts:556`；`sources/index.tsx:139-141` | API 数据源 `endpoint` 明文回显并拼进 `description` | 机构把上游 token 写在 endpoint query 里 → 明文进库并回显 | 创建面板提示；服务端拒绝含 `token=/key=/secret=` 的 endpoint query | 低 |

## 2. 关键详细说明

### PTR-01（P1）时间按 UTC 展示
`fairs/index.tsx:333-334` 直接 `f.startTime.slice(0,16).replace('T',' ')`，而 `startTime` 来自 `f.startAt.toISOString()`（`jobs-shared.ts:699`）；同页编辑抽屉却用 `isoToLocalInput` 正确换算。所有 `syncTime` 由 `fmtSyncTime`（`jobs-shared.ts:439-441`，`toISOString()` 切片）格式化，被 Admin 侧共用，修法要同步核 Admin。

### PTR-02（P1）编辑校招岗位被改成全职
`CATEGORY_TO_WORKTYPE.campus = 'full_time'`（`jobs/index.tsx:51-56`）；`:221 workType: form.workType || undefined` 永远带上；后端 `partner-edit.dto.ts:49-50` `@IsIn` 无 `'campus'`；`jobs-partner.service.ts:692` `category: mapWorkTypeToCategory(dto.workType)` → `'fulltime'`。

### PTR-06 同步日志编号随位置漂移
`jobs-partner.service.ts:940-942` `no` 用倒序数组下标 `i+1` 生成；前端把它当标识展示并用于详情标题。

### PTR-09/10 Excel 弹窗死步骤与孤儿批次
`handleConfirm` 顺序：`onImported()` → 父组件卸载 → `setStep('done')` 无效。`handleCancel` 只在 `step==='preview'` 才 cancel；「上一步」后再预览创建新批次覆盖旧引用。

### PTR-18 stub 页 + 改密无入口
`/terminals`、`/account` 仍是 15 行 EmptyState 且在 `NAV_ITEMS`；后端 `POST /auth/password/change` `@Roles('admin','partner')` 已存在，前端无对应函数。子账号增删改/启停全部在 `admin/orgs/:orgId/accounts/*`（`@Roles('admin')`），partner 侧不可达。

### PTR-21 `@PaidAiThrottle` 的位置
`jobs.controller.ts:440-446` 装饰器视觉上像挂在 quality-summary 上，实际装饰下面的 importJobs；由 `0eea1661b` 派生插入。

## 3. 租户隔离核对表（摘要）
orgId 统一经 `JwtAuthGuard → resolveOptionalInternalUser`（`optional-internal-user.ts:74-88`）回源 User 表；partner 无 orgId 或机构禁用 → 401。逐端点核对 35 条（dashboard/profile/jobs/fairs/data-sources/rotate/archive/sync-logs/excel×5/policies×6/companies×4/smart-campus×2/stats/integration×3）：全部 `where {sourceOrgId|orgId}` 或取回后比对 → 404，无一从 query/body/path 读 orgId。唯一例外 PTR-24（无 where 但响应不泄露）。信封核对：jobs/orgs/policies/smart-campus 裸对象 ✓，companies `ApiResponse.ok` 解包 ✓，auth `{data}` 解包 ✓；前端 30 条路径后端全部存在。

## 4. 合规核对
- `/stats` 只发 `period`；无 endUser 明细；`attribution.available:false`、`minSampleThreshold:5`；文案「打开来源平台只统计点击外部入口的次数，不代表投递结果」✓
- 所有 Partner 写路径默认 `pending + draft` 六处 ✓；`forbidNonWhitelisted`；Excel 敏感列双重拦截 ✓
- 凭证只映射 `credentialConfigured`；一次性明文 `omitWebhookSecretOnce` 剥离 ✓
- 文案全部白名单 ✓；无候选人/简历/面试/Offer 入口 ✓

## 5. 覆盖范围 / 未覆盖 / 核实过但不是问题
覆盖：`apps/partner/src` 全部 42 文件；后端 partner 段控制器/服务/DTO/guards/Prisma 模型/权限矩阵。
未覆盖：浏览器/真机运行；Admin 侧对 `fmtSyncTime` 的消费影响面；生产库实际数据量。
核实过不是问题：`user.orgId!` 断言（守卫保证）；PATCH 先 findUnique 再比对（统一 404 不泄露存在性）；归档/轮换/CAS/限流/confirmPhrase；Excel 映射回填与 confirm 幂等（`BATCH_ALREADY_PROCESSED`）；扩展名前后端双校验；智慧校园非学校机构双拒；政策删除级联；登录角色回源 `/auth/me`；工作台/统计空态真实。


---

# Kiosk 岗位/招聘会/企业/政策/线下机构 链路审查

## 筛选/分页对照
- `/jobs`：keyword/city/industry/category/sourceOrgId 传后端 ✓；**page 从不传，固定 pageSize 100**（`JobsPage.tsx:97,133`），>100 条不可达；城市/行业字典只从前 100 条派生。
- `/job-fairs`：status/keyword/terminalId 传后端 ✓；地区/日期/收藏只在 ≤100 条内本地过滤（`JobFairsPage.tsx:230-239`）。
- `/companies`：游标分页完整 ✓。
- `/offline-agencies`：keyword/page ✓；后端支持 district/orgType/service，UI 只有装饰性「全部区域」chip。
- `/renshi` 政策：全部本地，不传 query（`policies.ts:38`）。
- 参展企业/资料：不传 page/pageSize，后端默认 20。

## 缺陷
| ID | 严重度 | 路由 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| JOB-01 | P1 | 所有显示「同步时间」页 | `jobs-shared.ts:439-441`；消费 `JobsPage.tsx:28-33`、`JobFairsPage.tsx:46-52`、`jobDisplay.ts:54-64`、`JobFairDetailTabs.tsx:64-71`、`JobFairCheckinPage.tsx:13-18`、`W4Presentation.tsx:144-151`、`sourceTrust.ts:68-70` | 后端 UTC「YYYY-MM-DD HH:mm」无时区，前端 `new Date(str)`：Chrome 按本地解析差 8h；**WebKit/Safari 返回 Invalid Date → `sourceTrust.hasDate` 判缺失 → 全部岗位外跳/扫码被 fail-closed 停用** | 后端输出 ISO 带 Z，或前端统一 UTC 解析 | 时区高；Safari 中 |
| JOB-02 | P1 | `/job-fairs/:id` 参展企业、`/campus` | `jobFairs.ts:49,79`、`httpAdapter.ts:254-257`、`jobs.controller.ts:186-192` | `getFairCompanies` 不传分页，默认 20；total 被丢 → >20 家只显示 20 家且写「20 家」 | 传 pageSize=100 并透传 total | 高 |
| JOB-03 | P1 | `/job-fairs/:id/companies` | `FairCompaniesPage.tsx:42-52` vs `httpAdapter.ts:190-213` | 展区筛选按 `zoneName` 匹配，http 映射只有 `zoneId` → 点任意展区「无匹配企业」，生产整体失效 | 用 zoneId 匹配 | 高 |
| JOB-04 | P1 | `/job-fairs`、`/job-fairs/:id`、`/campus` | `JobFairsPage.tsx:197-200`、`JobFairDetailPage.tsx:157-160,240-245`、`CampusPage.tsx:165-168` | 「扫码预约」无来源门禁：sourceUrl 空/非法仍先写 ExternalJumpLog（后端 `activity.service.ts:75-84` 也不校验）再弹「未提供有效链接」→ 我的记录出现没发生的跳转 | 复用 `evaluateJobSourceTrust` 门禁，不通过不记日志 | 高 |
| JOB-05 | P1 | `/jobs/:id/offline` | `OfflineJobDetailPage.tsx:397-425,454-468`、`offlineAgencies.ts:230-251` | 线下岗位详情只显示来源机构，无外部ID/同步时间/外部链接/来源说明（后端 `offline-agencies.service.ts:204-230` 有 externalId/externalUrl 被适配层丢弃）；违反 §10 | 透传四要素、补来源卡 | 中 |
| JOB-06 | P1 | `/job-fairs/:id` 现场服务 | `jobs-shared.ts:656 managedMaterialCount: 0` 写死；`JobFairDetailTabs.tsx:207-212` | 详情显示「活动资料 0 份」而资料页有资料 → 前后矛盾（§9） | 后端填 `_count.materials` | 高 |
| JOB-07 | P2 | `/offline-agencies/:id` | `OfflineAgencyDetailPage.tsx:311` `'intern'` vs 枚举 `'internship'` | 实习岗在机构页显示「全职」 | 改枚举 | 高 |
| JOB-08 | P2 | `/jobs` | `JobsPage.tsx:97,133,106,143` | 固定 100 不翻页；错误文案「后端服务未连接…VITE_API_MODE=http」直出给用户 | 分页；用户口径文案 | 高 |
| JOB-09 | P2 | `/renshi` | `RenshiPage.tsx:81-84`、`policies.ts:37-49`、`PolicyPanel.tsx:220-223` | 截断提示「用身份筛选缩小范围」但身份筛选是本地的，不重新请求；后端支持 audience | 传 audience | 高 |
| JOB-10 | P2 | `/job-fairs`、`/job-fairs/checkin` | `JobFairsPage.tsx:212-217,228-239`；`JobFairCheckinPage.tsx:133` | 签到页只在最先 20 场里找有 checkinUrl 的场次 | 传 status+pageSize | 高 |
| JOB-11 | P2 | `/job-fairs/:id` | `JobFairDetailTabs.tsx:213-218` vs `jobs-kiosk.service.ts:301-312` 恒 null | 入口承诺「签到进度」，后端从不提供 | 改文案 | 高 |
| JOB-12 | P2 | `/offline-agencies` | `OfflineAgenciesPage.tsx:24-27,44,123-124` | 状态徽章写死「正常收录」；假「全部区域」chip | 读 status；接真区域筛选 | 中 |
| JOB-13 | P2 | `/job-fairs/:id` 地图 | `JobFairDetailTabs.tsx:78-98` | 无 AMAP key 时嵌 openstreetmap iframe（内网空白、坐标外发） | 无 key 直接落「暂无地图」 | 中 |
| JOB-14 | P2 | `/job-fairs/:id/materials` | `httpAdapter.ts:290-292` | 资料默认 20 份截断且标题数字不实 | 同 JOB-02 | 高 |
| JOB-15 | P2 | `/job-fairs/:id/companies` | `FairCompaniesPage.tsx:68-70` | 空态裸 EmptyState 不套 frame → 无返回按钮 | 放进 frame | 高 |
| JOB-16 | P2 | 招聘会子页 | `FairCompaniesPage.tsx:163`、`FairMapPage.tsx:259`、`FairMaterialsPage.tsx:490` | `syncTime ?? fair.startTime` 用活动时间顶替同步时间 | 缺失显示「未提供」 | 高（影响低） |

## 核实过无问题
岗位详情四要素 + fail-closed 门禁 ✓；ExternalJumpLog 失败不阻断、匿名不落库 ✓；二维码只含来源 URL/导航坐标，无 PII ✓；求职进度只 `me/job-applications`、DTO 白名单、恒 `self_reported`、无三端消费 ✓；收藏游客本地+登录同步 ✓；信封解包各模块匹配 ✓；三态齐全 ✓；签到/材料/参观计划/stats 不伪造 ✓；137 个 navigate 目标全部已注册 ✓。


---

# Kiosk 会话 / 隐私 / 门禁 / 待机屏 / 设备状态 审查

## 基线事实
token 纯内存（`auth/AuthContext.tsx:21,28,84`）；401 由 22 个模块经 `notifyMemberSessionExpired` → 整页跳 `/login?from=`；普通空闲 180s（busy 暂停）；屏保接管时用后台 idleTimeoutSec（30–1800）；硬隐私截止 300s **不看 busy**（`auth/KioskPrivacyGuard.tsx:20,496-556`）；清场 = 4 个 sessionStorage 键 + 合同审查内存态 + 3 个收藏 localStorage 键 + reload。**存储键清单核对无漏清。** terminalId 来自 Agent `127.0.0.1:9527/local/terminal-identity`。设备状态 = 最新心跳，5 分钟窗。

## 缺陷
| ID | 严重度 | 路由 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| SES-01 | P1 | `/print/confirm`、`/scan/result` | `PrintConfirmPage.tsx:604,418`、`AuthContext.tsx:36-43`、`ScanResultPage.tsx:82` | 流程中途去登录，`login()` 先 `clearKioskSensitiveSession()` 清掉打印材料会话，回跳只带 URL 不带 state → 命中「未知文件」守卫须重新上传；`/scan/result` 回跳渲染「扫描失败」 | login 只清属于别人的会话（比对 ownerMemberId），或回跳前快照；scan 登录入口 from=/me/documents | 高 |
| SES-02 | P1 | `/print/confirm`、`/print/cashier` | `services/print/printJobsApi.ts:112,130,143,161`、`services/print/paymentApi.ts:29,63,76,89,98,125,143`、`PrintConfirmPage.tsx:405,709`、`PrintCashierPage.tsx:117,143,168,367,619` | 下单/支付把英文技术串直渲染：`createPrintJob failed: 500 {...}`、`missing terminal id`；且这两个模块 401 不触发会话重置 | 改抛 `ApiHttpError(code,中文)`，页面 `userMessageOf`；missing terminal id 映射「本机设备未就绪」 | 高 |
| SES-03 | P1 | `/assistant` 语音、`/print/cashier`、`/interview/session` | `KioskPrivacyGuard.tsx:496-556`、`useAiAdvisorCallSession.ts:82`、`online-payment.service.ts:38` | 硬截止 300s 无视忙碌锁：语音通话 5 分钟不触屏被整页 reload 中断；支付码 TTL 恰 300s，等待中被清场，匿名用户随后拿不到取件码 | busy 期间延长硬截止或把音频/轮询成功当活动心跳 | 中 |
| SES-04 | P2 | 全站 | `main.tsx:37`、`screensaver.ts:89-98,122-132` | Agent 晚于浏览器启动时，身份解析成功 `key` 换值重挂整棵树 → 已登录用户静默登出、上传中 state 丢失 | 首次 ''→有值不换 key | 中 |
| SES-05 | P2 | 6 页（contract-review、interview/setup、convert、sign、resume/source、print/upload） | `ContractReviewHomePage.tsx:219-232,270`、`InterviewSetupPage.tsx:464,499,510`、`ConvertImagesPage.tsx:229,244-245`、`SignStampPage.tsx:313-314,354-355`、`ResumeSourcePage.tsx:55,228,348`、`PrintUploadPage.tsx:199,543` | §17 违规：「本机文件（桌面验证）」在一体机可点，弹 OS 文件框 | 抽 `isTerminalKiosk()`，kiosk 下隐藏 | 高 |
| SES-06 | P2 | `/resume/self-assessment/result` | `SelfAssessmentFlow.tsx:557` | 原生 `confirm()` | 换 ConfirmDialog | 高 |
| SES-07 | P2 | 首页/预览 vs Admin | `useTerminalDeviceStatus.ts:5`、`terminals-admin.service.ts:754`（5min）vs `:252,672`（3min） | 前台在线、后台离线的 2 分钟窗口 | 抽公共常量 | 高 |
| SES-08 | P2 | `/print/confirm` | 无 printerReady 复核；`useTerminalDeviceStatus.ts:54` 60s 轮询 | 预览时在线→确认期间掉线仍可下单付款 | 确认/付款前再拉一次或后端 fail-closed | 中 |
| SES-09 | P2 | 7 个 Bearer 模块 | `printJobsApi.ts`、`usbImportApi.ts`、`printConversion/scanTasks/ai/printSign/kioskFeedback.ts` | 401 不触发会话重置，UI 仍显示已登录 | 补 `isMemberSessionInvalidError` 分支 | 高 |
| SES-10 | P2 | `/resume/materials`、`/me/documents` | `JobMaterialLibraryPage.tsx`、`MyDocumentsPage.tsx` 无 `useBusyLock` | AI 生成 >150s 无触屏被清场，结果丢失 | 补 busy lock | 高 |
| SES-11 | P2 | 待机屏 vs 硬截止 | `save-config.dto.ts:9`（≤1800）、`KioskPrivacyGuard.tsx:20` | 屏保 idle >300s 时硬截止先到 → 先回首页再等屏保 | 前端 clamp 或后台校验 | 高 |
| SES-12 | P2 | 约 40 处 | `PrintUploadPage.tsx:240,305,360`、`SignStampPage:171,196`、`ConvertImagesPage:96,158`、`PrintMaterialCheckPage:367,453`、`ScanProgressPage:134`、`MySettingsPage:123`、`MyPrivacyRequestsPage:52,76`、`ResumeGeneratePage:256,312`、`JobMaterialLibraryPage:95,150`、`ResumeTemplateLibraryPage:120` | `err instanceof Error ? err.message : 中文` 反模式，后端 message 原样透传（`http-exception.filter.ts:56`） | 全站 `userMessageOf` + 门禁断言 | 中 |

## 核实过无问题
首帧 fail-closed 遮罩与 BFCache ✓；隐私边界载体无 PII ✓；屏保 idle 校验 ✓；设备 id 仅频控 ✓；`useHomeDeviceStatus.ts` 是死代码（无调用方，建议清理）；429/413 已中文 ✓；超时页显示脱敏手机 ✓；合同审查按 ownerMemberId 隔离 ✓；手机辅助页二维码只含 ticketId、上传 token 在 hash ✓；无 clipboard/Notification/print/alert/prompt ✓。


---

# Kiosk AI 简历链路审查（parse / optimize / generate / report / export / materials）

总体：这条链路无异步轮询，parse/optimize/generate/career-plan/job-fit 全是同步请求（后端请求内调 LLM）；只有扫码上传与 U 盘导入轮询，且终态/失败上限/卸载清理都正确。

| ID | 严重度 | 路由 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| AI-01 | **P0** | /resume/parse、/optimize、/generate | `apps/kiosk/src/services/api/aiHttpAdapter.ts:33`（`TIMEOUT_MS=15_000`）vs `services/api/src/ai/llm/llm-http.ts:82`（`LLM_LONG_TIMEOUT_MS` 默认 90s）；后端三处用长档 `llm-resume.service.ts:280`、`llm-resume-optimize.service.ts:343`、`llm-resume-generate.service.ts:167` | 前端 15s abort 而后端仍在算：模型 >15s（推理模型实测 13.2s 起）→ 前端 `REQUEST_TIMEOUT` 跳失败页；parse 同步且 taskId 只在响应里 → 结果已落库但前端永远拿不到；重试再吃 `@TerminalScopedThrottle(6)` 与日配额（`ai.controller.ts:133,139`，`rollback:147-151` 只在服务端抛错时回滚，客户端 abort 不回滚）；optimize 超时被当「返回重新解析」而后端已缓存成功结果（`ai.service.ts:352`）；解析页文案「通常 1 分钟内完成」（`ResumeParsePage.tsx:243`）自相矛盾 | 三条 LLM 路由客户端超时对齐 ≥90s（或改异步+轮询）；optimize 超时引导「重新读取」；abort 补配额回滚或幂等提交键 | 高 |
| AI-02 | P1 | /resume/optimize → /print/confirm → /login | `PrintConfirmPage.tsx:604,157,418`、`LoginPage.tsx:116-119`、`AuthContext.tsx:38` | 游客「去打印优化版」→「去登录查看权益」→ 回来文件没了（同 SES-01 根因：`login()` 清 sensitive session 且回跳不带 state） | 登录透传 state 或 `login()` 不清本人会话 | 高 |
| AI-03 | P1 | /resume/generate、/materials、/templates | `aiHttpAdapter.ts:113-118`（只映射 AbortError，`Failed to fetch` 原样抛）→ `ResumeGeneratePage.tsx:256,312`；`jobMaterials.ts:55` 无 try/catch → `JobMaterialLibraryPage.tsx:95,150`、`ResumeTemplateLibraryPage.tsx:120` | 断网/后端未起时屏幕裸英文 `Failed to fetch` | 统一 `userMessageOf`；网络层 TypeError 包成 `ApiHttpError('NETWORK_ERROR')` | 高 |
| AI-04 | P2 | /resume/optimize | `ResumeOptimizePage.tsx:172,278` | 429/超时/TTL 过期一律「请返回重新解析」，无「重试」，配额再扣 | 对齐 `ResumeOptimizeComparePage.tsx:123-132` 的分流 | 高 |
| AI-05 | P2 | /resume/report 刷新恢复 | `ResumeReportPage.tsx:146-147,191-205` | 恢复到 `status==='failed'` 记录时只显示「还没有诊断报告」，失败原因与「打印原件」出路丢失 | 复用 `!success` 分支 | 高 |
| AI-06 | P2 | /resume/optimize → /me/ai-records | `ResumeOptimizePage.tsx:185-187`、`MeListShell.tsx:103`、`member-assets.controller.ts:72` | 游客「查看记录」→ 登录后列表为空（匿名结果 endUserId=null，无认领逻辑，且 login 清掉匿名 session） | 游客态改说明或登录时用 accessToken 认领 | 高 |
| AI-07 | P2 | /resume/export | `routes/index.tsx:248`、`ResumeExportPage.tsx:45-72` | 死路由（无任何 navigate）+ 永久占位页 | 删或做真 | 高 |

## 字段/信封对照
`status` 四态、report/failReason/accessToken、modules/optimizedResume、自评两态、上传会话六态 —— 前后端一致；AI 控制器裸 DTO ✓、files/member-assets `{success,data}` 解包 ✓、错误信封一致 ✓。

## 核实过无问题
生产禁 mock（`client.ts:36`）✓；AI 挂了可打印原件（`ResumeDiagnosisFailExits.tsx:46-56`）、生成导出走 pdfkit 不过模型 ✓；后端 failReason 全为中文 ✓；「已生成」只在真实 signedUrl 存在时渲染 ✓；sessionStorage 4 键全登记清理、简历正文只走内存 ✓；匿名令牌走 header、DB 存 hash ✓；无发企业路径 ✓；定时器清理 ✓；`@PaidAiThrottle(20)`（`ai.controller.ts:192`）排版易误读但语义正确。


---

# Kiosk 扫描链路 / 打印扫描服务中心 / 契约 / 触控 / AI 助手 / 百宝箱 审查

| ID | 严重度 | 路由 | 文件:行 | 现象/触发 | 建议 | 置信 |
|---|---|---|---|---|---|---|
| MSC-01 | P1 | /assistant | `AssistantPage.tsx:61-73` | 路由白名单 `'/print/'`、`'/scan/'` 带尾斜杠，匹配要求 `/print//…` 永不命中 → 后端 LLM 给的 `/print/upload`、`/scan/start` 操作芯片被 `safeActions` 静默丢弃（node 复现） | 去尾斜杠 | 高 |
| MSC-02 | P2 | /scan/settings | `ScanSettingsPage.tsx:137-150` | 除网络错误外所有创建失败折成固定文案，丢弃后端 message（409 `SCAN_TERMINAL_BUSY` 有明确文案、终端停用、429） | 按 code 分支 | 高 |
| MSC-03 | P2 | 扫描全链 | `ScanSettingsPage.tsx:267`、`ScanProgressPage.tsx:54,210,221`、`ScanResultPage.tsx:134` | 硬编码「输出 PDF（服务端生成）」，实际 `deliverScanFile` 原样存 Agent 送的 jpg/png（`scan-tasks.service.ts:520-527`、`scan-watcher.ts:216-221`），无转换 → 选 JPEG 结果页 chip 显示 PDF（§9） | format 由 mimeType 派生 | 高 |
| MSC-04 | P2 | /scan/result | `ScanResultPage.tsx:76-83,156` | 游客态「登录后在我的文档管理」，但游客扫描件 `ownerType='system'`、无认领机制，登录后我的文档没有 | 改文案或做认领 | 高 |
| MSC-05 | P2 | /print-scan/convert | `ConvertImagesPage.tsx:276` vs `:179-181` | 规则卡无条件写「PDF 已保存到我的文档」，同页横幅已按登录态区分 | 按 token 分支 | 高 |
| MSC-06 | P2 | /print-scan/convert | `ConvertImagesPage.tsx`、`print-conversion.service.ts` | 格式转换无前端深链门禁、无服务端 `assertUserTaskAllowed`，请求体无 terminalId；对比扫描/签章服务端 fail-closed | 加 terminalId + 服务端能力校验 | 高 |
| MSC-07 | P2 | /toolbox、/smart-campus/** | `useToolboxConfig.ts:43,91`、`useSmartCampusConfig.ts:43,89`、`KioskCapabilityGuard.tsx:75-78` | 每 5 分钟刷新先置 loading → 页面整体卸载成「配置检查中」，弹窗/滚动/state 全丢 | 刷新期间保留上一份快照 | 高 |
| MSC-08 | P2 | /scan/progress | `ScanProgressPage.tsx:108-131` | `completed && file===null`（文件已清理，`scan-tasks.service.ts:336-347`）无分支 → 每 3 秒轮询到天荒地老；API 不可达也无客户端截止 | 进失败页；传 expiresAt 兜底 | 中 |
| MSC-09 | P2 | 虚拟键盘、扫码面板 | `kiosk-keyboard.css:68,117`、`KioskKeyboard.tsx:112,129`、`UploadSessionQrPanel.tsx:351-362` | 键盘收起 40px、候选词 44px <48；扫码面板主确认键 `size="sm"`(48) 低于 56 | ≥48 / lg | 高 |
| MSC-10 | P2 | /print-scan/feature/id-photo | `PrintScanFeatureInfoPage.tsx:73,160,198` | 「先用照片打印」跳 `/print/upload` 不带 `category=photo` → 落到文档打印 | 补参数 | 高 |
| MSC-11 | P2 | /print-scan/convert | `ConvertImagesPage.tsx:213` | 来源标签靠文件名含「手机」猜 | 记 source 字段 | 高 |

## 契约比对
157 处端点字面量：115 自动命中，42 模板串人工核对全部存在；无新的「前端调了后端没有」。扫描六态、上传会话六态、AiTaskStatus 四态两侧一致；各裸返回/信封解包逐文件对照一致。未核 PrintTaskStatus/订单枚举（打印主链路）。

## 核实过无问题
扫描确经 Agent 投递、无 Agent 不伪造完成 ✓；轮询串行、终止条件、TTL/reaper ✓；结果 URL 为 HMAC 签名、controlToken 不落存储 ✓；扫描件直进打印/诊断契约 ✓；服务中心能力真实读取、探测失败 fail-closed ✓；AI 助手 TRTC 失败退化为文字、非 llm provider 锁输入 ✓；百宝箱/智慧校园三种失败收敛不白屏 ✓；主按钮触控尺寸抽查通过（除 MSC-09）✓。


---

# Terminal Agent + 小程序 + worker 审查（HEAD=1d7468cda）

| ID | 严重度 | 端 | 文件:行 | 现象 | 触发→错误结果 | 建议 | 置信 |
|---|---|---|---|---|---|---|---|
| AGT-01 | P1 | agent+api | `task-runner.ts:380-389`；`terminals-agent.service.ts:62-65,519-524`；`offline-queue.ts:106-112` | `PATCH printing` 失败视为信息性继续打印，但后端只允许 `claimed→printing/failed`，不允许 `claimed→completed` | printing 上报时网络抖动 → 纸已出 → `completed` 400 `INVALID_STATUS_TRANSITION` → 离线队列 4xx dead-letter → 5 min 后 `resetExpiredClaims` 把已付款任务改 `failed/PRINT_JOB_UNCONFIRMED` → 用户被告知失败可能重下单重复出纸（**真出纸假失败**） | 后端 `claimed` 允许 `completed`（幂等补 printing 日志）；或 Agent printing 未 ack 不出纸 / 终态 400 后补发 printing | 高 |
| AGT-02 | P1 | agent | `task-runner.ts:451-457,601,617,715-733` | 出纸后监控窗口固定 30s，不随页数×份数放大 | 多页多份 despool >30s → `PRINT_JOB_UNCONFIRMED` failed 而纸持续出 → 重下单重复付费 | 上限按 pages×copies 放大（30s+3s/面，封顶 5min），后端 printing 超时保持更大；真机 ≥30 页×2 份实测 | 中 |
| AGT-03 | P1 | agent | `task-runner.ts:75-91,330-338` | 文件下载裸 `axios.get` 无重试，一次失败即 `markTaskDone('failed')` | 签名 URL 瞬时超时/5xx → 已付款订单直接 failed | 不写终态让下一轮 claim 重领（lease 5min 内），N 次后再 failed | 高 |
| AGT-04 | P2 | agent | `print-with-pdf-to-printer.ts:99-104` | `Promise.race` 超时不 kill SumatraPDF | 60s 报 PRINT_TIMEOUT 写 failed，随后仍出纸 | execFile 自控 + kill；或超时后仍走 monitor | 高 |
| AGT-05 | P2 | agent | `wmi.ts:111,125` | `DetectedErrorState=0`(Unknown) 报 `ready`；printerName 配错报 `unknown` 非告警 | 后台把「未知」当就绪；配错名直到首单才暴露 | 0→unknown；not_found→error | 高 |
| AGT-06 | P2 | agent | `index.ts:101-104`、`heartbeat.ts:215-222`、`task-runner-control.ts:48-50` | 服务端下发的轮询间隔只写 config，setInterval 已用旧值 | 后台调间隔无效 | 重建 timer | 高 |
| AGT-07 | P2 | agent | `task-runner.ts:322-325`、`scan-watcher.ts:309,318,333,345` | 日志打印用户原始文件名（「姓名+简历.pdf」进服务日志，§11） | 只记 taskId/ext | 高 |
| AGT-08 | P2 | agent | `scan-watcher.ts:65-66,146-160` | 写入完成判定 = 两次 lstat 500ms 一致 | SMB 分段写入停顿 >500ms 可能读半文件 | 稳定窗 ≥2s 或连续 3 次；独占打开 | 中 |
| AGT-09 | P2 | agent | `usb-files.ts:165-196` | U 盘只枚举根目录 | 简历在子目录 → 列表空无提示 | 枚举一层或提示 | 高 |
| AGT-10 | P2 | agent | `task-runner.ts:685-692` | 曾见活跃作业、下一轮 not_found 即判 completed | 两次轮询间被工作人员取消 → 上报 completed | not_found 也先查 Event 307 | 中 |
| MP-01 | P1 | miniapp+api | `utils/api.js:157-160`、`pages/policies/policies.js:51`、`policy-detail.js:27-33`；`policies.controller.ts:71-72`（注释明写无 `GET /policies/:id`） | 政策详情页调用不存在的端点 | 列表点任一条 → 404 →「未找到该内容，可能已下线」 | 后端补 `GET /policies/:id`（approved+published）；小程序不改 | 高 |
| MP-02 | P2 | miniapp | `app.json:53-54`、`api.js:1020-1040`、`community.js:57-60`、`daily-report.js:28-32` | 职业圈 8 端点与早报 1 端点后端不存在；失败文案「加载失败，下拉可重试」非「未开放」 | 深链/分享可达即误导为故障 | 复用 fail-closed 守卫或摘出 app.json | 高 |
| MP-03 | P2 | miniapp | `request.js:61-84` vs `:182-233` | `uploadFile` 不走 401 静默续签且丢 code | 30min 过期后首步是上传 → 直接「登录已失效」 | 套同一层 silentResignin | 高 |
| MP-04 | P2 | miniapp | `config.js:26` | baseUrl 硬编码生产域名，无环境切换 | 无预发验证路径 | 记录 | 高 |
| MP-05 | P2 | miniapp | `api.js:871-875,929-933` | `cancelCloudPrintOrder/cancelPackageOrder` 零调用 | 用户无法主动取消未到机订单 | 产品决定 | 高 |
| MP-06 | P2 | miniapp | `job-detail.wxml:101`、`fair-detail.wxml:121` | 外跳文案「复制来源链接」不在白名单（无黑名单词，有免责声明） | 白名单增补 | 高 |
| MP-07 | P2 | miniapp | `print-pay.js:18-20,47-49` | 支付页按 query 渲染彩色/双面标签，建单固定 black_white/simplex | 上游放开彩色后静默降级 | 透传 | 中 |

## 附表
- 小程序端点比对：98 调用 vs 481 路由，匹配 85，不匹配 13（MP-01 唯一有应用内入口；材料包 4 条已被守卫；社区 8 + 早报 1 无入口）。
- 11 条 lint error 判定：全部无害（`wmi.ts` 的 `\"` 在模板字面量内等价 `"`，PowerShell `$()` 内允许嵌套双引号，Phase 8.2B 真机跑过）。建议加 lint script 进 CI。
- `services/worker`：仅 package.json 空壳，CI/部署零引用，真实 BullMQ 处理器在 api；与 `docs/project-structure.md:16` 预留一致，非缺陷。

## 核实过无问题
printerName 无硬编码、配置必填 ✓；参数映射正确、未验证参数服务端 fail-closed ✓；重启后不重复出纸（三段落库回放）✓；租约窗口够用（无续约）✓；spool≠出纸区分、Retained 永不判 completed ✓；本地桥 127.0.0.1 + Origin 白名单 + DPAPI ✓；U 盘白名单/防穿越 ✓；跨平台路径 ✓；到机码三端契约一致（8 位数字 + 过渡 10 位）✓；小程序合规文案 0 ✓；登录降级 ✓；材料包守卫四页全覆盖 ✓；支付语义 Order-only 在 Kiosk 核销时付款属设计 ✓。


---

# 运营数据大屏 · 数据就绪度盘点（HEAD=1d7468cda）

文档 §10.3 标 ✅ 的模块里 4 个经核实不是直接可用：M4/M5 会话数、M8 时效、M12 物料打印量、M9 部分。

## 1. 模块 × 数据 × 端点
| 模块 | 指标 | 模型/字段 | 现有端点/函数 | 就绪度 | 备注 |
|---|---|---|---|---|---|
| M2 设备墙 | 在线/离线/异常/未上报 | Terminal + TerminalHeartbeat | `GET admin/device-fleet/overview` → `device-fleet.service.ts:10-34` → `device-fleet.projection.ts:74-125,286-296` | **直接可用** | 窗口 `DEVICE_FLEET_ONLINE_WINDOW_SECONDS=180`（`projection.ts:19`），响应带 `onlineWindowSeconds` |
| | 打印机就绪/缺纸/故障 | `printerStatus`；健康值 `['ok','ready','idle']`（`printer-status.ts:6`） | `listPrintersForAdmin` `terminals-admin.service.ts:671-720` | 直接可用（状态串） | 无余量数值 |
| | 按机构 | `Terminal.orgId` | 无聚合 | 需新增 | |
| M3 任务流 | 进行中打印 | `PrintTask.status` 六态 + `PrintTaskStatusLog` | `admin-ops.service.listPrintTasks:113`；`admin/print-scan/tasks?type=` | 直接可用（列表） | 缺 `groupBy(status)`；索引 `[status,terminalId,createdAt]` |
| | 扫描 | `ScanTask.status` 六态 | 同上 | 直接可用 | |
| M4 今日 | 打印份/页（黑白/彩色） | `Order.billablePages`、`itemsJson`（serviceKey `print_bw_page/print_color_page`，`pricing.service.ts:66,75`）、`channel`、`type` | 无 | **需新增** | itemsJson 无 duplex（双面不计价）；存量 channel=null 显示「未标注」 |
| | 服务人次（会话） | `KioskSession` | `kiosk-session.controller.ts` 两端点均 `{ok:true}` 桩，Service 空 | **零写入，不可用** | 替代：Order/PrintTask/AiServiceLog 按 endUserId+日去重 = 「登录会员数」，匿名不可计 |
| | 今日 AI | AiServiceLog | `admin/ai/usage` 固定近 24h | 需新增日历日 | |
| | 浏览/打开来源 | BrowseLog/ExternalJumpLog（仅登录会员；30 分钟去重） | 无全局聚合 | 需新增 | |
| | 工具箱 | ToolboxLaunchEvent | `admin/toolbox/launch-summary` `terminal-toolbox.service.ts:579-618` | 直接可用 | |
| M5 累计 | 打印页/订单 | Order/PrintTask | 无 | 需新增 | 无 TTL，可信 |
| | AI 累计 | AiServiceLog | usage 只 24h（`take:10_000` `ai-log.service.ts:564`） | 需新增 groupBy | best-effort 写入，只做趋势；AiResumeResult/MockInterviewSession 有 TTL |
| | 累计触达 | BrowseLog/ExternalJumpLog `expiresAt` | `ACTIVITY_LOG_TTL_DAYS=30`（`activity.service.ts:36`），每小时物理删（`:263-267`）；Toolbox 90 天 | **累计不可得** | 需按日聚合快照表 |
| | 注册会员 | EndUser.createdAt（无索引） | 无 | 需新增 | 低基数可 count |
| M6 AI | 调用/成功率/延迟/错误/token/成本 24h | AiServiceLog；status 仅 success/failed | `admin/ai/usage` `ai-log.service.ts:463-517`（costByOperation 三态、unmeasuredCalls、costCollectionSince） | 直接可用（24h） | **无「降级」字段**（llm.provider 绝不 fallback）、**无「拦截」字段**（敏感词静默替换不落日志） |
| | 按终端/机构 | terminalId 无索引；无 orgId；`AiUsageLedger` 不存在 | 无 | 需新增 / 字段缺失 | |
| M7 内容 | 岗位/招聘会/政策/企业各状态计数 | 四表均有 `[reviewStatus,publishStatus]` 索引；`validThrough` | Admin 无 count 端点（`admin/job-sources` 是全表 findMany `jobs-admin.service.ts:44-46`）；Partner 有 count | 需新增 groupBy | 「在架」= approved+published+未过期（`jobs-kiosk.service.ts:73-74`）；`JobFair.viewCount` 无增量路径 |
| | 平台目录/线下机构 | OnlinePlatformDirectory；OfflineAgencyProfile/Branch（正本），OfflineAgency/OfflineJob legacy | 无 | 需新增 | 别把 legacy 表重复计数 |
| | 来源机构数 | Organization(type,enabled,contentTrustStatus,archivedAt) | 无 | 需新增 | |
| | 数据源/同步 | JobSource、SyncLog | `partner/stats` 按 orgId | 需新增 admin 全局版（复用 partner-stats 去 orgId） | |
| M8 审核队列 | 待审数 | 四类 pending/reviewing | Partner 侧有；Admin 无 | 需新增 | |
| | 处理时长/SLA | `ReviewDecision` `schema:2771-2795` | **全仓零写入** | **字段缺失** | `Job.reviewedAt` 三个动作都覆盖；`syncTime` 内容未变也刷新（`job-sync.service.ts:671`）；需补 `pendingSince`；替代：AuditLog `*.review` 动作数 |
| M9 告警 | 实时告警 | 派生不落表 | `admin/alerts?view` → `listDerivedAlerts:184-235` → `derived-alerts.ts:200-265`（offline ≥3min/≥30min error；printer_issue；print_failed 24h 未核查未退款，上限 500） | 直接可用 | 无历史，MTTR 不可算 |
| | 处置态 | AlertDisposition | 同上 | 直接可用 | |
| M10 漏斗 | 看见→浏览→去来源→打印 | 无曝光日志；行为日志仅登录会员 | partner-stats `attribution.available:false` | 需新增；第一层缺 | |
| M11 机构效果 | | 无 sourceOrgId | 无 | 字段缺失 | 反查不建议（sourceOrgId 是当前归属非快照） |
| M12 招聘会 | 企业/展区/物料结构数 | FairCompany/FairZone/FairMaterial | `admin/fairs/:id/stats` `admin-fairs.service.ts:201-218` | 直接可用 | |
| | 物料打印量 | `FairMaterial.printCount` | 同上 `_sum(printCount)` | **恒 0**（无 increment） | 真路径：Bridge.fileObjectId → PrintTask.fileId completed count；FileObject 清理后 fileId SetNull 会缩水 |
| M13 耗材 | | 心跳无数值 | | 字段缺失 | 仅 `paper_empty` 布尔 |
| E2 报表 | 按终端/时段 | Order.terminalId 有索引；AiServiceLog/BrowseLog terminalId 无索引 | `admin/reports/terminal-operations` **不存在** | 需新增 | 在线率需心跳表时间覆盖率；`TerminalHeartbeat` **无任何清理**，每台每天 ≈2880 行无界增长 |

## 2. 口径不一致
- **在线阈值三套五处**：Admin 工作台/终端列表 3min 且必须有心跳（`terminals-admin.service.ts:252,313`）；device-fleet 180s、无心跳=unknown、`agent_degraded`=degraded；告警 `lastSeen=心跳??registeredAt` ≥3min（从未上报的终端注册 3 分钟即报离线）；content/toolbox/smart-campus **2 分钟**；Kiosk `printer-status` 与小程序 `listPublicTerminals` **5 分钟**。→ 大屏只认 `device-fleet.projection.ts` 并打出 `onlineWindowSeconds`。
- **待审核**：工作台拉整表前端 filter、只 2 类（不含政策/企业）；Partner 服务端 count 4 类。
- **AI 调用**：只有 24h 滚动窗，无日历日。
- **文件统计**：工作台只在前 100 条上算过期/敏感（`dashboard/index.tsx:137-143,488`）；`files/lifecycle-summary` 是全量但 findMany 全部未删文件。
- **时区**：只有 partner-stats 明确 Asia/Shanghai 并下发 `timezone`；其余为滚动窗或浏览器本地。
- **最小样本**：`MIN_AGGREGATE_SAMPLE=5` 只在 partner-stats。

## 3. 前端可复用
`packages/ui/src/charts/{TrendLineChart,FunnelCard,MetricGrid,ResumeRadarChart}`；admin 已装 recharts ^3.8.1 但无页面直接用；`Meter/SectionCard/StatusBadge`。`Page.tsx` 适合配置区块不适合 `/screen`。Admin token 存 `localStorage['admin_auth_v1']`，boot 调 `/auth/me`。API 只有一种 24h JWT，角色 admin/partner/kiosk；`RolesGuard` 无 @Roles 即任意登录用户放行。**可借鉴凭证模式**：`TerminalBindCode`（codeHash unique + expiresAt + usedAt + revokedAt，签发 `terminal-credential-security.service.ts:74-82`）最接近「只读大屏 token」；HMAC action token（无状态但无吊销）。注意 `terminals/:id/config`、`printer-status` 无 Guard 公开读，大屏不应沿用。

## 4. 查询代价
Order 有 `[createdAt]/[channel,createdAt]/[terminalId]` ✓；BrowseLog/ExternalJumpLog 无 createdAt/targetType 领头索引（30d 限界可接受）；AiServiceLog `[operation,createdAt]/[status,createdAt]` ✓ terminalId ✗，现 usage 是 findMany take 10000 后 JS 聚合（>1 万条少算），大屏改 groupBy；四内容表 `[reviewStatus,publishStatus]` ✓；EndUser 无 createdAt 索引。建议一个 `GET admin/screen/snapshot?profile=` + 服务端缓存分档（15s/60s/5min），不让大屏并发打十几个端点（工作台已是 9 个并发）。

## 5. 合规字段级
可显：终端状态与 locationLabel/orgName；任务状态计数与 errorCode 分布；页数/份数/订单/金额合计（paymentSource=free/offline/sandbox 须标注）；AI operation/status/provider 计数、延迟、token、估算成本（带 unmeasuredCalls/costCollectionSince）；内容状态计数、机构数、同步成功率；ExternalJumpLog 按 targetType/action 计数及 targetTitle/sourceName Top-N（=热门岗位/来源，非个人；N≥5；文案只能「打开来源平台入口 N 次」）；Toolbox 汇总。
不可显：EndUser 任何字段、各日志 endUserId、「最近浏览者」、FileObject 名/内容、pickupCode、扫描件、AI 结果内容；**JobApplication 任何形式**（含按 companyName/jobId 聚合）；printCount/viewCount（恒 0 → 显示「未接入」）；KioskSession 服务人次（无数据）；机构版 AiServiceLog/Order/行为日志无 orgId → 整块「未接入」；时效/降级/拦截无字段不得用代理值。

## 总结
直接可用：M2、M3（列表）、M6 24h、M9、M12 结构数、工具箱。需新增聚合：M4、M5、M6 累计/按终端、M7、M8 计数、M12 物料真实打印、E2。字段缺失/有表无写入：服务人次、审核时效、降级/拦截、机构维度、printCount/viewCount、耗材、经纬度、累计触达。运维前置：心跳表无清理；在线阈值统一。


---

# 市场与行业研究报告（2026-09-05，公开检索）

## 一、行业规模与趋势
结论：①「就业服务一体机」无全国采购口径统计，只有地方点状部署与中央示范资金；②校园自助打印只有厂商软文口径，单机经济模型可作区间参考；③AI 简历工具无独立付费统计。

| 项目 | 数据 | 来源/日期 | 可信度 |
|---|---|---|---|
| 公共就业服务能力提升示范项目 | 每示范城市中央补助 1 亿元，分两年拨付 | [财政部 财办社〔2024〕22号](http://sbs.mof.gov.cn/zhengcefabu/202412/t20241231_3950948.htm) 2024-12-31 | 官方 |
| 地方就业终端部署 | 广州海珠「海纳职通」39 个场所投放终端 | [广州市政府](https://www.gz.gov.cn/zwfw/zxfw/jyfw/content/post_9988123.html) 2024-11-22 | 官方 |
| 社保自助终端存量 | 深圳近千台 | [深圳社保局](https://hrss.sz.gov.cn/szsi/zxbs/zdyw/sbzzzd/) | 官方 |
| 就业驿站软件单项目 | 惠州驿站平台中标 69.6 万元 | [中国政府采购网](http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202403/t20240327_21692532.htm) 2024-03-27 | 官方 |
| 高校就业信息化单项目 | 哈工程平台预算 65 万，3 个月验收 | [中国政府采购网](https://www.ccgp.gov.cn/cggg/zygg/gkzb/202411/t20241119_23659644.htm) 2024-11-19 | 官方 |
| 校园共享打印市场 | 2025 年 47.3 亿元、+21.6%；保有量超 30 万台 | [灵境信息软文](https://www.csjcs.com/news/shangxun/Article-KH6DFC-447757.html) 2026-06-25 | 厂商自述，低 |
| 单机经济模型 | ≈93 页/台/日；黑白 0.15 元/页、彩色 0.5；设备 4500–15000 元/台 | 同上 | 低（区间参考） |
| 校园周边打印店价 | 黑白 0.3–0.5，彩色 1–2 元/页 | [琢贝云打印](https://www.zhuobei.cn/news-1228.html) 2025 | 商家 |
| AI 简历工具定价 | 超级简历 18 元/月、78/年、98 终身；职徒 12/30/78/93 | [wondercv](https://www.wondercv.com/)、[知乎测评](https://zhuanlan.zhihu.com/p/706495885) | 官网/媒体 |
| 应届生 AI 使用率 | 2026 届样本 2040：86%+ 春招用生成式 AI；72% 润色简历；54% 岗位定制化简历；仅 17% 完全 AI 生成；80%+ AI 模拟面试 | [前程无忧](https://finance.sina.cn/stock/jdts/2026-04-09/detail-inhtwnxc5921635.d.html) 2026-04-09 | 企业调研 |
| AI 简历付费率/客单价 | 未找到公开数据 | — | — |
| 生成式 AI 总用户 | 5.15 亿（2025-06），普及率 36.5% | [北京日报转 CNNIC](https://xinwen.bjd.com.cn/content/s690145e3e4b02424b0c232f6.html) 2025-10-29 | 官方转述 |

## 二、政策驱动
结论：2025–2026 主线是「就业公共服务下沉 + 人工智能+就业」，与产品定位吻合；政府采购验收看**服务人次、求职登记、岗位归集、接入省级就业平台**，不看设备本身。

| 政策/数据 | 要点 | 来源 |
|---|---|---|
| 2026 届毕业生 1270 万（+48 万） | 教育部汇集岗位超 1200 万 | [新华网](https://www.news.cn/20251120/ead0f25dff2948dfa7f01fa78f207882/c.html) 2025-11-20 |
| 人社部发〔2025〕21号 | 家门口就业服务站+零工市场+15 分钟就业服务圈；推进「人工智能+就业」；登记数据上传全国就业信息资源库 | [中国政府网](https://www.gov.cn/zhengce/zhengceku/202505/content_7025316.htm) 2025-04-22 |
| 国办发〔2025〕25号 稳就业 | 扩岗补助 ≤1500 元/人；社保补贴 25%、1 年 | [中央社工部转载](https://www.zyshgzb.gov.cn/n1/2025/0709/c459388-40518229.html) |
| 2025 青年就业 17 条 | 百万见习岗位、「双千」微专业 | [中国就业网](https://chinajob.mohrss.gov.cn/c/2025-04-25/432912.shtml) |
| 国新办吹风会 | 家门口服务站、零工市场、15 分钟圈 | [新华网](https://www.news.cn/20260526/3215fc57258e4f38988a102046d42604/c.html) 2026-05-26 |
| 零工市场/驿站 | 全国口径未找到；北京 18 个零工市场、前 4 月撮合 17.98 万人次；广州 275 驿站+66 高校 e 站、服务 193.15 万人次 | [北京人社](https://rsj.beijing.gov.cn/zmsxw/xwsl/202605/t20260525_4664415.html)；[广州](https://www.gz.gov.cn/zwfw/zxfw/jyfw/content/post_9416528.html) |
| 数字人社 | 2025 年建成数字化底座，「全服务上网、全业务用卡」 | [湖南省政府转载](http://www.hunan.gov.cn/zqt/zcsd/202306/t20230627_29385030.html) |
| 2025 人社工作综述 | 「就业在线」注册 1.9 亿；日均有效岗位 2000 万+ | [中国人力资源市场网](https://chrm.mohrss.gov.cn/) |
| 驿站建设标准/验收 | 广东：政策咨询、求职登记、职业指导、信息发布、岗位推荐五项基本服务，须接入省就业一体化平台；北京零工市场纳入运行监测 | [广东指引](https://www.gz.gov.cn/zwfw/zxfw/jyfw/content/post_9425503.html)；[北京](https://rsj.beijing.gov.cn/xxgk/zcwj/202406/t20240604_3704271.html) |
| 重点群体专项 | 就业援助月（大龄/残疾/长期失业）；退役军人 2025 专项行动明确「AI 赋能就业服务」 | [国务院](https://www.gov.cn/zhengce/zhengceku/202412/content_6994669.htm)；[退役军人事务部](https://www.mva.gov.cn/sy/xx/bnxx/202504/t20250414_489460.html) |

## 三、用户群体画像
| 群体 | 规模/特征 | 痛点 | 使用习惯启示 |
|---|---|---|---|
| 应届毕业生 | 1270 万；2026-07 不含在校生 16–24 岁失业率 17.9%（[国家统计局经新浪](https://finance.sina.com.cn/jjxw/2026-08-19/doc-ininvshv9435757.shtml)） | 4 成投过 50+ 份简历（[智联 2024](https://www.sdyanbao.com/detail/758986)）；岗位 -15%、投递 +20%（[猎聘](https://www.fxbaogao.com/detail/4947940)）；招转培/付费内推诈骗（[人民日报](http://society.people.com.cn/n1/2025/0723/c1008-40527494.html)） | 手机为主，AI 高频；54% 需要岗位定制化简历 |
| 灵活就业/零工 | 超 2 亿；新就业形态 8400 万 | 位置型零工以男性、中年、低学历为主（[暨大+智联](https://iesr.jnu.edu.cn/2025/0416/c17210a834071/page.htm)）；多数从未签合同（[工劳网](https://search.laborinfocn2.com/articles/101036)） | 现场即时快招；需要合同风险提示、社保补贴指引 |
| 大龄/进城务工 | 农民工 30115 万，均龄 43.3，50 岁以上 32%，初中及以下 65.4%（[国家统计局](https://www.stats.gov.cn/sj/zxfb/202604/t20260430_1963472.html) 2026-04-30） | 文字输入弱 | 大字号、语音、少步骤；适老化 ≥18dp 字号、图标 ≥10mm（[工信部规范](http://www.news.cn/info/20220104/3f20972b9de2458a9957463f8b7b478f/c.html)） |
| 残疾人 | 持证就业 891.5 万，灵活就业 275.4 万（[人民网](http://society.people.com.cn/n1/2026/0508/c1008-40716095.html)） | 无障碍访问 | 高对比度、语音朗读 |
| 退役军人 | 年度人数未找到；六项专项行动 | 专项招聘、技能转换 | 政策入口 + 专场信息 |
| 返乡青年 | 无独立统计 | 创业补贴材料 | 政策材料打印高频 |

## 四、竞品与同类产品
| 类别 | 产品 | 他们有我们没有 | 收费 | 启示 |
|---|---|---|---|---|
| 人社终端 | 乌鲁木齐「AI+求职一体机」：语音选岗→刷脸→AI 电话生成简历→直接发送企业（[新疆人社厅](https://rst.xinjiang.gov.cn/xjrst/dzdt/202503/516f0cb492e1448c8a0ba23240c07a53.shtml)） | 刷脸/支付宝联动、语音生成简历 | 政采 | **简历直发企业越界不可做**；语音生成简历可做（输出给本人） |
| 人社终端 | 广州「海纳职通」：10 秒诊断、SMART 指数、3 公里岗位地图、推送候选人 | 岗位地图、指数化报告 | 政采 | 推送候选人越界；秒出诊断+指数可借鉴 |
| 招聘会现场 | 广东 2026 春招：智能就业一体机、AI 面试舱、数据屏（[深圳市政府](https://www.sz.gov.cn/cn/xxgk/zfxxgj/tpxw/content/post_12685589.html)） | AI 面试舱、实时进场屏 | 政府活动 | 我们「去来源平台预约 + 活动资料打印」的落点 |
| 社保终端厂商 | 鸿湖万联/智慧眼/视美泰（[中华网](https://m.tech.china.com/redian/2025/0411/042025_1659419.html)） | 社保卡读卡、刷脸 | 按台 | 硬件对接社保卡是加分项 |
| 校园打印 | 灵维、小票通、印享、微图、智印、云印通、流海云印、印记 | 宿舍楼分布式、微信直接下单 | 0.15–0.5 元/页 | 「无痕打印、15 天自动清除」已成标配（[腾讯云社区](https://cloud.tencent.com/developer/news/1289138)），我们必须显式展示 |
| AI 简历 | 超级简历、职徒、知页、BOSS「职决」（诊断/推荐/优化/自动投递） | 岗位定制简历、Agent 问答、自动投递 | 12–18 元/月 | 自动续费投诉黑猫累计 22 万条（[中新网](https://www.chinanews.com.cn/cj/2026/03-14/10586915.shtml)）→ 按次付费天然规避 |
| 政务大屏 | — | — | — | 内蒙古 48 块屏 227.53 万元「平时基本关闭」被中纪委通报（[福建省政府转载](https://www.fujian.gov.cn/jdhy/hygq/202504/t20250427_6905614.htm)）；新华时评「数据出官」 |

## 五、功能优化机会清单
| # | 群体 | 痛点 | 证据 | 与现有能力 | 合规 | 价值 | 代价 |
|---|---|---|---|---|---|---|---|
| 1 | 政企采购方 | 验收要「服务人次/求职登记/岗位归集」 | 广东驿站指引、21号文 | 已有日志→按站点/月导出「服务人次报表」 | 合规 | 高（投标必备） | 小 |
| 2 | 政企采购方 | 须接入省级就业平台 | 同上 | 缺失：对外聚合/服务事件接口（不传简历） | 需改造 | 高 | 中 |
| 3 | 政企采购方 | 大屏被通报为面子工程 | 中纪委通报 | 待机屏→默认展示真实运营数据+时间戳 | 合规 | 中 | 小 |
| 4 | 大龄/务工 | 65.4% 初中及以下，小字触屏不适 | 统计局报告 | 新增「长辈模式」（≥18dp、语音播报、三步完成打印） | 合规 | 高 | 中 |
| 5 | 全部 | 打印隐私恐惧 | 行业标配无痕 | 打印完成页明示「文件已于 X 后删除」+可查删除记录 | 合规 | 高 | 小 |
| 6 | 应届生 | 54% 需岗位定制简历 | 前程无忧 | 优化链加「粘贴 JD → 针对性改写 + 逐段确认」 | 合规 | 高（付费点） | 中 |
| 7 | 应届生 | 80%+ AI 模拟练习 | 同上 | 模拟面试按 JD 出题 + 报告打印 | 合规 | 中 | 小 |
| 8 | 应届生/零工 | 招转培、付费内推诈骗 | 人民日报 | 岗位详情「防骗提示」固定条 + 来源核验状态 | 合规 | 中 | 小 |
| 9 | 全部 | 补贴材料清单复杂 | 广东人社、25号文 | 按人群生成「材料清单+申请表打印包」 | 合规 | 高（政企付费点） | 中 |
| 10 | 零工 | 从未签合同 | 工劳网 | 零工协议模板打印 + 12333 指引 | 合规 | 中 | 小 |
| 11 | 零工/大龄 | 现场即时快招 | 北京零工市场 | 零工市场官方入口「扫码去来源平台报名」专区 | 合规 | 中 | 小 |
| 12 | 零工/大龄 | 语音选岗、口述生成简历 | 新疆人社厅 | 小青语音→口述生成简历→打印/存我的 | 合规；直发企业越界 | 中 | 中 |
| 13 | 高校 | 校招季批量打印 | 广州 e 站 | 「简历套餐」（黑白 10+彩色 1+扫码存档） | 合规 | 高 | 小 |
| 14 | 高校采购方 | 65 万级预算、3 个月验收 | 哈工程采购 | 按学院/年级匿名统计 | 合规 | 中 | 小 |
| 15 | C 端 | 自动续费投诉 | 中新网 | 保持按次付费；上会员须 5 天前提醒 | 合规 | 中 | 小 |
| 16 | 残疾人 | 无障碍 | 残联公报 | 读屏/高对比度模式 | 合规 | 低–中 | 中 |
| 17 | 退役军人 | AI 赋能专项 | 退役军人事务部 | 退役军人专场/政策专区（官方来源外跳） | 合规 | 中 | 小 |
| 18 | 政企 | 社保卡全业务用卡 | 数字人社 | 社保卡/电子社保卡读卡登录 | 合规 | 中 | 大（硬件） |
| 19 | 招聘会主办 | 现场数据屏 | 广东 AI 数据屏 | 待机屏招聘会模式（导览+资料打印统计） | 合规 | 中 | 小 |
| 20 | — | 岗位地图 | 海纳职通 | 无经纬度不做；按来源机构所在区筛选 | 合规 | 低 | — |
| 21 | — | 自动投递、候选人推送 | BOSS、海纳职通 | — | **越界不可做** | — | — |

## 六、数据大屏行业惯例
行业常见指标：企业入驻数、岗位归集数、服务人次、求职登记数、供需对接人次、招聘会场次、进场人数、AI 简历优化量、培训人次、满意度。验收看：数据有无来源与时间戳、能否追溯台账、是否与省平台一致。翻车：内蒙古 48 块屏基本关闭、耒阳虚报、「数据出官」时评。

| 行业指标 | 我们能否支撑 | 口径建议 |
|---|---|---|
| 服务人次 | ✅ 打印订单+AI 日志+浏览/外跳，按用户/日去重 | 明示「本终端服务人次（去重）」 |
| 求职登记数 | ⚠️ 无登记业务；用「AI 简历建档数」 | 不得命名「求职登记」 |
| 岗位归集/招聘会数 | ✅ 已审核发布条数 | 标来源机构、同步时间 |
| 供需对接/撮合 | ❌ 招聘闭环 | 只展示「打开来源平台次数」 |
| 企业入驻数 | ⚠️ 只有来源机构数 | 命名「接入信息来源机构」 |
| AI 服务使用量 | ✅ | 按诊断/优化/面试/规划分项 |
| 打印量 | ✅ | 页数、黑白/彩色 |
| 终端在线率 | ✅ 心跳 | 展示最近心跳时间 |
| 耗材余量 | ❌ 无数值 | 只显示状态枚举 |
| 设备地图 | ❌ 无经纬度 | 站点列表 |
| 实时滚动 | ❌ 无推送 | 标「更新于」，轮询 |
| 审核队列/告警 | ✅ | 管理端用，不上公开屏 |

## 数据可信度说明
官方：教育部、统计局、人社部/国办文号、残联、政采网、地方人社、中纪委通报。企业调研/转述：CNNIC（经北京日报）、前程无忧、智联、猎聘、暨大。低可信：校园打印 47.3 亿/30 万台/单机页数（厂商软文）。未找到：一体机全国采购规模、AI 简历付费率、零工市场总数、年度退役军人数、终端闲置率。
