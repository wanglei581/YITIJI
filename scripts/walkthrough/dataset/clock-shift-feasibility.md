# 方案 A 可行性：部分可行

结论日期：2026-09-29。只做了一小套正常接口回放，没有批量造数。

同一 PostgreSQL 上另起一个时钟偏移的 API，用正常接口回放「两周前」的操作，**Prisma 写下去的业务时间会跟着偏移**。订单页能看到这单落在 **2026-09-16 10:00**（上海）。数据库自己的 `now()` 不偏移。另一个用真时钟跑着的 API（4300）会把这些「过去」的时间当成已经过期：签名链接立刻失效、终端被看成离线、短保留期文件会在下一个整点被清理、进行中的打印任务有被 30 秒回收器改判失败的窗口。

所以方案 A 可以用来铺历史业务时间，但不能在 4300 照常跑清理和回收的时候，对同一批进行中任务或短寿命文件做批量回放。

## 怎么做的

垫片 `clock-shift.cjs` 只平移零参 `new Date()`、`Date()` 和 `Date.now()`。带参数的构造原样交给真实 `Date`，避免二次偏移。`setTimeout`、Redis TTL、`process.hrtime`、PostgreSQL `now()` 都不经过它。

4301 的启动方式与走查栈的 `start-api.sh` 相同：先载入同一份环境，再覆盖 `PORT=4301`，并用 `node --require` 加载垫片。偏移量把进程时钟钉在 **2026-09-16 10:00（Asia/Shanghai）** 附近，然后随真实时间一起走，不是冻住。

健康检查 `GET /api/v1/health` 返回 `time=2026-09-16T02:00:32.000Z`（即上海 10:00:32），`db=postgres`，`status=ok`。同一时刻 `SELECT now()` 是 `2026-09-29 19:27:11+08`。

终端不用 WALK-004：库里没有这台。在 4300 的管理员设备页预创建了 **WALK-099「示例·时钟验证机」**，绑定码经标准输入交给模拟 Agent。模拟 Agent 的数据目录是 `~/.cache/walk0929/sim-agent-099`，API 指向 4301，网桥端口 4359。然后在 4301 上做完：一体机会话、游客上传一页不含个人信息的 PDF、隐私检查、0 元报价、建单、模拟 Agent 领任务并完成、会员短信登录（号码 138****0991，验证码只从 4301 日志读取）。

验证结束后按记下的 PID 停掉了 4301（20416）和模拟 Agent（20652）。4300 健康检查仍是 200。没有改 `apps/`、`services/`、`packages/`，没有直接写数据库，没有动打印机故障锁。

## 新写入的时间跟着谁

库里的时间列是 `timestamp without time zone`，存的是 UTC 的钟面数字。`2026-09-16 02:00:32` 就是 `2026-09-16T02:00:32Z`，管理后台按上海时区显示成 **2026-09-16 10:00**。

| 行 | 字段 | 库里的值（UTC 钟面） | 是否偏移 |
| --- | --- | --- | --- |
| Order `ORD-20260916-89843C4D23` | createdAt / paidAt | 2026-09-16 02:00:32.353 / .356 | 是 |
| 同一订单 | updatedAt | 2026-09-16 02:00:36.385 | 是 |
| PrintTask | createdAt | 2026-09-16 02:00:32.348 | 是 |
| PrintTask | claimedAt / claimExpiry / completedAt | 02:00:36.049 / 02:05:36.041 / 02:00:36.383 | 是 |
| PrintTaskStatusLog | 已领取→打印中、打印中→已完成 | 均为 2026-09-16 02:00:36 | 是 |
| FileObject（print_doc） | createdAt / updatedAt | 2026-09-16 02:00:32.058 | 是 |
| FileObject | expiresAt | 2026-09-17 02:00:32.056（上海 9/17 10:00） | 是 |
| KioskSession | startedAt / lastActiveAt / endedAt / createdAt | 2026-09-16 02:00:32 | 是 |
| DocumentProcessTask（pii_scan） | createdAt / expiresAt | 02:00:32.077 / 2026-09-17 02:00:32.076 | 是 |
| AuditLog | file.upload、order.mark_paid、print_job.create、terminal.bind_code.exchange | 全部在 2026-09-16 02:00 | 是 |
| TerminalHeartbeat | createdAt | 2026-09-16 02:00:26.019 | 是 |
| Terminal.lastSeenAt | 心跳更新 | 2026-09-16 02:01:16 | 是 |
| TerminalCredential | issuedAt / expiresAt | 2026-09-16 02:00:18 / 2027-09-16 02:00:18 | 是 |
| EndUser、MemberLegalConsent | createdAt / lastLoginAt | 2026-09-16 02:00:36 | 是 |
| 订单号 | `makeOrderNo()` 用 `new Date()` 的本地年月日 | `ORD-20260916-…` | 是 |

`Order.createdAt`、`FileObject.createdAt`、`AuditLog.createdAt`、`PrintTask.createdAt`、`TerminalCredential.issuedAt`、`TerminalHeartbeat.createdAt` 都在下面的数据库 `DEFAULT now()` 清单里，但实际值是偏移时间，不是 `SELECT now()` 的 9 月 29 日。Prisma 7 的查询编译器在 INSERT / UPDATE 时用 JS 的 `new Date()` 把 `@default(now())` 和 `@updatedAt` 写进语句，盖过了数据库默认值。

同一行上也能看见两个时钟。绑定码是 4300 的管理后台生成的，兑换发生在 4301：

| TerminalBindCode | 值 | 谁写的 |
| --- | --- | --- |
| createdAt、expiresAt | 2026-09-29 11:26:49 / 11:36:49（UTC） | 4300，真时钟 |
| usedAt | 2026-09-16 02:00:18（UTC） | 4301，偏移时钟 |

`Terminal.registeredAt` 同样是 4300 预创建时写下的 `2026-09-29 11:26:48`，没有被后来的 4301 心跳改掉。

会员登录成功，但这两分钟的 `AuditLog` 里没有登录动作，登录审计时间没有样本。JWT 的 `iat` 是 `2026-09-16T02:00:36Z`，`exp` 是 30 分钟后的 `2026-09-16T02:30:36Z`。

## 数据库 DEFAULT now() 的列

`public` 下有 **114** 列的默认值含 `now()` 或 `CURRENT_TIMESTAMP`。`updatedAt` 不在其中。`public` 里的触发器是终端退役 / planned 守卫，不写时间戳。

这些列**只有在 INSERT 省略该列时**才由数据库时钟填充，那时不会跟着垫片走。本次 Prisma 路径没有省略，所以上面测到的业务列跟着偏移。不要把「列上有 DEFAULT now()」理解成「4301 写下的这列一定是真实现在」。

清单：

- ActiveReleaseObservationAssignment.createdAt
- AdAsset.createdAt
- AdPlaylist.createdAt
- AdPlaylistItem.createdAt
- AdvisorArtifact.createdAt
- AdvisorPin.createdAt
- AdvisorSession.createdAt
- AgentReleaseArtifact.createdAt
- AgentReleasePlan.createdAt
- AgentReleaseTarget.createdAt
- AiResumeResult.createdAt
- AiServiceLog.createdAt
- AlertDisposition.createdAt
- AuditLog.createdAt
- BenefitActivity.createdAt
- BenefitClaim.createdAt
- BenefitGrant.createdAt
- BroadcastReadState.createdAt
- BrowseLog.createdAt
- CompanyProfile.createdAt
- CompanyProfile.syncTime
- ContractReviewTask.createdAt
- DocumentProcessTask.createdAt
- EndUser.createdAt
- ExternalJumpLog.createdAt
- FairCompany.createdAt
- FairCompanyBooth.createdAt
- FairCompanyPosition.createdAt
- FairMaterial.createdAt
- FairMaterialPrintBridge.createdAt
- FairVenueFacility.createdAt
- FairVenueGuide.createdAt
- FairVenueHall.createdAt
- FairVenueHallCompany.createdAt
- FairZone.createdAt
- Favorite.createdAt
- FeedbackReply.createdAt
- FeedbackTicket.createdAt
- FieldMappingRule.createdAt
- FileObject.createdAt
- HelpItem.createdAt
- ImportBatch.createdAt
- ImportRecord.createdAt
- Job.createdAt
- Job.syncTime
- JobAiRecommendation.createdAt
- JobAiSession.createdAt
- JobApplication.createdAt
- JobDataQualitySnapshot.checkedAt
- JobFair.createdAt
- JobFair.syncTime
- JobMaterialTemplate.createdAt
- JobSource.createdAt
- KioskActivity.createdAt
- KioskJobBoardConfig.createdAt
- KioskSession.createdAt
- KioskSession.lastActiveAt
- KioskSession.startedAt
- LegalDocVersion.createdAt
- MemberLegalConsent.createdAt
- MemberNotification.createdAt
- MockInterviewReport.createdAt
- MockInterviewSession.createdAt
- MockInterviewTurn.createdAt
- OfflineAgency.createdAt
- OfflineAgencyBranch.createdAt
- OfflineAgencyProfile.createdAt
- OfflineJob.createdAt
- OnlinePlatformDirectory.createdAt
- Order.createdAt
- OrderItem.createdAt
- OrderSubmissionLedger.createdAt
- Organization.createdAt
- PartnerOrgNotice.createdAt
- PaymentAttempt.createdAt
- PiiFinding.createdAt
- PlatformQualification.createdAt
- PolicyEligibilityRule.createdAt
- PolicyPost.createdAt
- PolicyPost.syncTime
- PriceConfig.createdAt
- PriceConfig.effectiveFrom
- PrintMaterialPack.createdAt
- PrintTask.createdAt
- PrintTaskStatusLog.createdAt
- QualificationRecord.createdAt
- RecruitmentCircuitBreak.createdAt
- RecruitmentEmergencyHold.createdAt
- RedemptionRecord.createdAt
- Refund.createdAt
- ReviewDecision.occurredAt
- ScanTask.createdAt
- ScreensaverContent.createdAt
- SyncLog.createdAt
- SystemBroadcast.createdAt
- Terminal.registeredAt
- TerminalBindCode.createdAt
- TerminalCapability.createdAt
- TerminalCredential.issuedAt
- TerminalHeartbeat.createdAt
- TerminalReleaseObservation.receivedAt
- TerminalScanDeletionAudit.receivedAt
- TerminalScreensaverConfig.createdAt
- TerminalSmartCampusConfig.createdAt
- TerminalToolboxConfig.createdAt
- ToolboxAllowedHost.createdAt
- ToolboxApp.createdAt
- ToolboxAppVersion.createdAt
- ToolboxLaunchEvent.createdAt
- User.createdAt
- UserAiConsent.grantedAt
- UserDataRequest.requestedAt
- UserNotification.createdAt
- _prisma_migrations.started_at

不经过这份垫片的写入仍然用真时钟：4300、psql、省略列的 raw SQL、以及数据库自己的 `now()`。

## 4300 管理端上落在哪一天

截图在 `~/.cache/walk0929/evidence/d3-clock/`。页面都打在 4300 的管理后台（4320），数据时间是 2026-09-29 19:28 左右。

- 订单页搜 `ORD-20260916-89843C4D23`：创建时间 **2026-09-16 10:00**，已支付、已完成，终端 WALK-099，文件「示例-时钟验证.pdf」。详情里状态流转「已领取 → 打印中」「打印中 → 已完成」也是 **2026-09-16 10:00**。见 `03-orders.png`、`04-order-detail.png`。
- 工作台「最近打印任务」按创建时间倒序，首屏是当天 19:17–19:27 的单，没有这张 9/16 的单。打印任务总数 23，与「9/29 已支付 22 单 + 9/16 这一单」一致。见 `02-dashboard.png`。在线终端显示 1/2，WALK-099 不算在线。
- 数据大屏「服务调用」：今日打印 **22**，近 30 天打印 **23**。已支付订单按上海日聚合是 2026-09-29 共 22 单、2026-09-16 共 1 单。今日看不到这单，近 30 天把 9/16 算进去了。少于 5 次的分项仍显示「少于 5」，这一单不会单独冒出来。见 `05-screen-usage-default.png`、`06-screen-usage-30d.png`。
- 政务总览把 WALK-099 画成 **离线 13 天**。设备页运行状态也是离线，生命周期仍是「运行中」。见 `07-screen-gov.png`、`08-terminal-on-4300.png`。

## 两个时钟会不会互相干扰

会，而且方向不对称：4300 用真时钟解读 4301 写下的过去时间，会当成已经过期；4301 用 9/16 的时钟去看 9/29 的数据，一般还觉得没到期。

1. **签名 URL。** 链接是相对路径，到期时刻写在 `expires` 里。校验是 `expires <= Date.now()` 就 401，不区分「过期」和「签名错」。同一条链接打 4300 得到 **401**，打 4301 得到 **200**。模拟 Agent 必须把 API 指到签发它的那个实例。
2. **JWT。** 4301 签发的会员 token，`exp` 在 9/16 10:30，4300 会判过期。Redis 会话 TTL 仍按真实秒数（30 分钟）计算，所以会出现「JWT 的绝对时间已过期，Redis 键还在」或反过来。这个 token 不能拿去打 4300。
3. **Redis TTL。** 短信冷却键的剩余 TTL 是真实秒数（抽查时还剩 4 秒），不跟着垫片。验证码键 `member:sms:code:{手机号哈希}` 不带日期，两个实例会互相覆盖。这次用了专用号，避开正在走查的号码。
4. **按小时 / 按天的限流键。** 日桶用上海日期，小时桶用 `toISOString()` 的小时。实测 `member:sms:daily` 同时有 `2026-09-16`（1 个）和 `2026-09-29`（25 个）；IP 小时键有 `2026-09-16T02` 和 `2026-09-29T11`。短信预算 `sms:budget:member` 也分成这两天。两套不抢额度。
5. **文件清理。** 4300 每小时整点跑 `cleanupExpired`，条件是调用方的 `new Date()`：`expiresAt < now` 且没有 pending / claimed / printing 的打印任务。这张 print_doc 是 24 小时保留，到期 9/17 10:00，任务已经完成，**4300 的下一个整点会把它清掉**。停进程时（19:29）`deletedAt` 仍为空，不是进程一启动就删。4301 自己的清理若在整点跑，比较的是 9/16 的现在；启动前 `expiresAt < 2026-09-16 02:00` 且未删的文件是 0，4301 运行约 3 分钟，日志里没有清理记录。
6. **心跳在线。** 在线窗口看心跳时间与调用方的现在差了多久。4301 写下的 `lastSeenAt` 是 9/16，4300 的设备页、工作台、政务大屏都把它当成离线 13 天。回放必须用独立终端，不能往正在被 4300 看护的机器上打偏移心跳。
7. **领任务回收。** 4300 每 30 秒把 `claimExpiry < 真现在` 的 claimed，或 `updatedAt < 真现在 − 10 分钟` 的 printing，标成失败，错误码 `PRINT_JOB_UNCONFIRMED`，`completedAt` 写成 4300 的现在。pending 和已完成不在条件里。这次任务在 claimed / printing 只停了约 0.3 秒就完成，没有被改判。批量回放时，只要单子在 4300 开着的时候进入 claimed 或 printing，就可能被改成「真实现在失败」。4301 的回收器用更早的钟，不会把 9/29 的在途单判超时；启动前这类会被误伤的旧单是 0。
8. **一体机会话。** `expiresAt` 是偏移现在加 30 分钟，对 4300 来说一写完就已过期。这次在回放里主动结束了会话。
9. **第二套定时任务。** 4301 也会注册队列消费者和 cron。岗位同步在托管开关关闭时直接返回，不拉岗位。实例仍然应该短命，并且避开整点。凭证 `expiresAt` 被写成 2027-09-16，按真时钟看还有效，不要拿这枚终端令牌打 4300。

## 建议

- 方案 A 适合回放 Prisma 路径上的历史业务时间。订单、任务、文件、会话、审计、会员的创建时间都会落在目标日。
- 回放用独立终端、独立手机号，模拟 Agent 只连接偏移实例。
- 短保留期文件不要和 4300 的整点清理共享「已经过期」的 `expiresAt`。要么把这次验证用的文件保留到真时钟之后，要么回放期间让 4300 的清理停一下，要么接受整点被删。进行中的 claimed / printing 不要和 4300 的 30 秒回收器重叠。
- 签名 URL 和 JWT 只在签发它们的那个实例上使用。
- 数据库 `DEFAULT now()` 本身不用改也能让本次这类 Prisma 写入跟着走。真正不跟着走的，是省略该列的写入，以及别的进程用真时钟去解释这些过去的时间。
