# 项目综合审查报告（2026-08-18）

> 状态：一次性只读审查快照，**不是**当前进度、功能范围或合规红线的替代信源。  
> 实时阶段仍以 [`docs/progress/current-progress.md`](../progress/current-progress.md) 和 [`docs/progress/next-tasks.md`](../progress/next-tasks.md) 为准。  
> 主基线：`origin/main@22127deaf`（2026-08-18 项目图谱 PR #716）。  
> 本机工作区：`claude/miniapp-life-circle-port-2026-08@dda23e36c`，相对 `origin/main` **behind 26 / ahead 2**，工作区干净。  
> 审查方式：对 `origin/main` 与当前工作区做源码核对；对照正式入口文档与既有审查。  
> **未做**：连接生产库、SSH 生产机、Windows/奔图真机、真实支付/短信/TRTC、浏览器 E2E、CI 重跑。  
> 本文件不授权部署、不授权生产写入、不把本地候选写成商用完成。

---

## 1. 最终结论

| 判定层级 | 结论 | 原因 |
|---|---|---|
| 产品定位与合规边界 | **通过（保持）** | 非招聘平台、来源四要素、白名单 CTA 仍是硬约束；审查未发现应改边界的理由 |
| 主干软件能力 | **有条件通过** | 打印核销止血、内容信任发布闸、小程序隐私闸、管理端 Redis 降级已在 `origin/main` |
| 当前工作区相对主干 | **偏离** | 本机分支落后 main 26 个提交；不得把本工作区当 main 或生产事实 |
| 微信小程序正式发布 | **NO-GO** | 代码候选存在；正式 AppID 真机、体验版授权上传、与生产 API 同 SHA 发布未完成 |
| Terminal Agent / 打印扫描现场 | **NO-GO** | Windows CI 不能替代 SMB/ACL/杀毒、扫码器、奔图出纸照片 |
| 生产内容供给 | **NO-GO** | 公开岗位/招聘会曾治理为空；Wave 2 治理事实未补齐前不得切 writer |
| 付费市场 / 财务对外口径 | **NO-GO** | 0i Gate 未完成；TAM/BOM/毛利继续冻结 |
| **整体商用发布** | **NO-GO** | 任一 P0 外部门禁未关，不得宣称可商用、可复制铺点 |

一句话：工程主体已经超过「能不能做出来」；当前阻塞是 **现场履约、真实内容、付费试点、工作区与主干对齐**，不是再写一份创业评价。

---

## 2. 审查范围与证据边界

### 2.1 已核对

- `origin/main@22127deaf` 与当前分支 tip 的相对位置。
- 打印权益核销：`services/api/src/benefit-redemption/benefit-redemption.service.ts`。
- 内容信任发布闸：`services/api/src/common/content-trust.ts`（main 已含 `#687`）。
- 小程序打印闸：`apps/miniapp/pages/print-upload/print-upload.js` 的 `_passPrintGate()`。
- 管理端 Redis 降级：`services/api/src/common/redis/redis-degradation.ts`、`jwt-auth.guard.ts`。
- 会员鉴权：`services/api/src/common/guards/end-user-auth.guard.ts`。
- 账号会话失效：`services/api/src/orgs/admin-orgs.service.ts` `invalidateAccountSession`。
- 告警截断：`services/api/src/admin-ops/admin-ops.service.ts:203`。
- 正式入口：`CLAUDE.md` / `AGENTS.md`、`feature-scope.md`、`compliance-boundary.md`、`next-tasks.md` 顶部平台可靠性遗留与 0i Gate。

### 2.2 明确未冒充完成

- 未对生产 PostgreSQL 重跑 2026-08-10 的只读盘点；219 Job / 公网空态沿用当时受限报告，标注为**过期基线**，不能单独产生新的 GO。
- 未验证 `zyidai.cn` 当前运行 SHA 是否等于 `22127deaf`。
- 未打开微信开发者工具，未上传体验版。
- 未在 Windows 一体机或奔图上执行出纸/扫描。

### 2.3 和上一份「综合评估」的关系

2026-08-18 聊天里的创业评估（Canvas）是给创始人的阶段判断，**不是**本仓库的审查真值。  
本文件才按项目审查口径写：基线 SHA、可定位缺陷、已关闭项、外部门禁、禁止事项。  
`docs/reviews/` 属过程材料，引用前须与第一节正式入口交叉验证。

---

## 3. 基线与工作区偏差

| 对象 | SHA / 状态 | 审查含义 |
|---|---|---|
| `origin/main` | `22127deaf` | 本报告软件结论的主基线 |
| 当前工作区分支 | `dda23e36c` | 仅多 2 个小程序「职业生活圈」提交；**落后 main 26 提交** |
| 工作区 | 干净 | 本轮无未提交脏改干扰取证 |
| 生产运行目录 | 未 readback | 不得把 main tip 写成已上线 |

当前工作区独有提交：

- `89783f735` `feat(miniapp): 职业生活圈改版移植到最新 main`
- `dda23e36c` `fix(miniapp): 未开放能力在入口就说明原因`

**[P1] 用落后 26 提交的工作区继续「完善全项目」会误修、漏修、回退已合入能力。**  
继续开发前应先从干净 `origin/main` 建分支，或把本分支 rebase/merge 到 `22127deaf` 后再改。`docs/README.md` 已记录过「读了过期材料 / 看了脏工作区 → 改错东西」。

---

## 4. 不要再当未修缺陷的项（已在 main）

下列问题在 8 月中曾以「未合入候选」出现在进度里。对 `origin/main@22127deaf` 核对后，**代码闸门已在主干**，不得再写成「仓库里还没修」。它们仍然 **未等于生产已部署 / 真机已验收**。

| 原问题 | 主干证据 | 仍未关闭的部分 |
|---|---|---|
| 打印券整单免单 | `redeemForOrder()` 对 `order.type === 'print'` 抛 `REDEEM_PRINT_ORDER_UNSUPPORTED`（`benefit-redemption.service.ts:173-180`） | `BenefitGrant` 仍无面值/抵扣上限；接前端抵扣前必须先补模型，不能只拆闸 |
| 未授权来源可发布 | `content-trust.ts` + 发布路径；`#687` 已在 main | 存量已发布内容、机构 `contentTrustStatus` 回填属生产写，须具名授权 |
| 小程序预览绕过隐私确认 | `_passPrintGate()` 是预览与下单唯一闸（`print-upload.js:194-250`） | 正式 AppID 真机未验 |
| 管理端 Redis 故障全 500 | `tryRedis()` + `JwtAuthGuard` 回源数据库 | 会员端见 §5.1；`invalidateAccountSession` 见 §5.2 |

近期 main 还合入了与资损/运营直接相关的修复，例如 `#711`（打印确认/预览色彩按真实参数）、`#710`（Admin「内容可信」控件）、`#708`（政策库与内置指引分开）。这些按「已在主干」理解，不在本报告重复当新 bug。

---

## 5. 缺陷（按严重度，均可定位）

只列当前仍成立、作者知道后通常会修的问题。外部门禁见第 6 节，不混进「代码 bug」。

### 5.1 [P0] 会员鉴权在 Redis 不可达时无界等待，失败形态不诚实

`services/api/src/common/guards/end-user-auth.guard.ts:56-59`

`EndUserAuthGuard` 用 `this.redis.get(memberSessionKey(sessionId))` 作为会话真源。Redis 就是会员会话真源，**读不到必须拒绝**，不能改成放行。  
缺口是：没有有界等待，也没有 `MEMBER_SESSION_STORE_UNAVAILABLE`。`next-tasks.md` 记录单请求实测 **23.6 秒**后塌成通用 500。Redis 抖动时会占满连接，会员端看起来像整站挂了。

要求：保持拒绝；加上界 + 503 + 明确错误码。不要复用管理端「回源数据库放行」——两边会话模型不同。

### 5.2 [P0] 账号写成功后 Redis 失效抛错，管理员看到失败，重试会跳过失效

`services/api/src/orgs/admin-orgs.service.ts:733-735`

```733:735:services/api/src/orgs/admin-orgs.service.ts
  private async invalidateAccountSession(userId: string): Promise<void> {
    await this.redis.del(this.sessionStateKey(userId))
  }
```

启停 / 改密 / 换邮箱在数据库提交之后调用该方法。`redis.del` 无超时包装、失败会冒泡成 500。管理员以为没改成；重试时状态已是目标值，整段被跳过，**连缓存失效也不做**。最长约 60 秒陈旧会话窗口。`/health` 已声明 `internal-console-redis-actions=unavailable`，代码未改。

要求：DB 提交与缓存失效解耦；失效失败记告警并返回「已保存、会话刷新延迟」，禁止用 500 否定已提交写入。须同时规定「写失败、读成功」时的窗口处置。

### 5.3 [P1] 告警列表 `take: 50` 静默截断

`services/api/src/admin-ops/admin-ops.service.ts:194-218`

近 24h 失败打印任务 `findMany({ take: 50 })` 后直接 `return { data: alerts }`。无 `total`、无 `truncated`。批量故障正是最需要看全的时候，接口层无法发现少了多少条。

要求：返回 `total` / `truncated`，或分页；禁止把截断集合呈现为全集。

### 5.4 [P1] 权益模型仍不能安全计价，止血闸不能当成产品完成

`BenefitGrant` 只有 `quantityTotal` / `quantityRemaining`。打印路径已 fail-closed，这是正确的止血，不是核销能力已就绪。  
Kiosk 确认页若重新接线 `/orders/:id/redeem` 而不先补面值、抵扣上限、适用范围，会再次打开资损。

要求：补字段与部分抵扣结算后，才能拆止血闸并改断言。在此之前前端必须保持不调用。

### 5.5 [P1] 打印参数能力与展示必须继续诚实

主干已限制未验证的彩色 / 双面 / N-up，`#711` 修了确认/预览按真实参数展示。  
现场仍只应开放 **黑白 + 单面 + 1 页合一**，直到奔图驱动参数与真机出纸关闭该项。不得把硬件「支持彩色」写成开放 API 已可用。

### 5.6 [P2] 任务文档自身是多时代叠写，不能当唯一施工队列

`docs/progress/next-tasks.md` 同时堆积 V6 W1–W8、商用 Wave、招聘 Wave 2、文件现场验收、0i Gate。部分条目已过时或与更新的 handoff 互相覆盖。  
执行前必须用文件顶部「当前最高优先级」和正式入口交叉验证，不能按文件后半段旧队列开工。

---

## 6. 外部门禁（不是修 bug 能关的）

这些是发布阻塞，但关闭条件在仓库外。代码代理可以准备清单、修对接、写门禁，**不能在证据未齐时改判定为 GO**。

| ID | 门禁 | 通过标准 | 当前 |
|---|---|---|---|
| E1 | Windows + 奔图打印闭环 | 本人测试 PDF：小程序建单 → 扫码/到机码 → 支付 → Agent claim → 出纸 → 回流；保留 orderId/taskId、脱敏日志、出纸照片；覆盖错码/过期/未支付/刷新不重打 | 未验收 |
| E2 | 扫描现场 | 目标机 LocalSystem + 真实 SMB/ACL/杀毒/占用/服务重启；普通 PDF/JPG/PNG | Windows CI ≠ 现场 |
| E3 | 正式小程序 | 正式 AppID 真机：登录、隐私、报价、建单、扫码撤码；与生产 API 同 SHA 后再授权上传 | 未上传/未发布 |
| E4 | 真实内容 | 至少 1 个授权来源走导入→审核→信任标记→发布；公网 `total>0` 且来源四要素可见 | 公开空态/治理 blocker（2026-08-10 盘点，须重验） |
| E5 | 0i 付费市场 | 12–15 家预算负责人；1 个付费试点或书面采购启动；2 个落地点；100 人双选会观察；≥2 份 RFQ；采购/法务书面核验 | 未完成 |
| E6 | 密钥 / 法务 / 支付商户 | 上线清单逐项有证据；百度 OCR 密钥曾暴露须轮换 | 未关 |
| E7 | 生产发布对齐 | 具名 SHA、备份、`DEPLOY_API_ENABLED` 窗口、发布后改回 `false`；禁止把服务器源码 HEAD 当成运行版本 | 未对本基线做生产 readback |

---

## 7. 若继续完善：允许的修复顺序

只批准与首单试点直接相关的工作。不批准借审查重开 V6 全页、第二套后台或新 AI 入口。

1. **对齐主干**：从 `origin/main@22127deaf`（或更新的干净 main）建分支；本生活圈分支只能选择性 rebase，禁止在落后 26 提交的树上做全项目修复。
2. **收 P0 代码**：§5.1 会员 Redis 有界拒绝；§5.2 账号写后缓存失效语义。两项都有现成门禁位置，不得改判定方向。
3. **收 P1 可见性**：§5.3 告警截断标记。
4. **对接一条履约链**：小程序 → 到机码 → Kiosk → 支付 → Agent → 出纸。软件侧补齐失败态；GO 只能由 E1 证据改。
5. **对接一条内容链**：复用现有 Partner/Admin，不新建导入系统。GO 只能由 E4 改。
6. **停止加功能**：证件照、签约审查开放、补贴资金项目、双后台 48 页补齐，全部排到 E1+E4 之后。

---

## 8. 合规与禁止项（本轮重申）

审查范围内未发现必须放宽红线的产品理由。继续禁止：

- 平台内投递、代收简历、企业筛选/邀约/Offer、按录用收费、向企业回流简历或画像。
- 用 seed/演示数据填生产岗位页。
- 把 CI 绿、Playwright capture、合成 PDF 缩略图写成「打印可用」或「像素封板」。
- 对外发布 TAM/SAM/SOM、竞品价、BOM、毛利、回本、「市场窗口」。
- 用「年底预算必须花完 / 迎检政绩」做销售或产品优先级。

---

## 9. 残留风险

- **文档过期**：`current-progress.md` 体量极大，顶部是当日开发流水，容易把未合入候选读成 main。取证必须对 `origin/main` 做 `git show` / `git ls-tree`。
- **审查文件膨胀**：`docs/reviews/` 已有数十份，约一半结论已被更新基线覆盖。本文件 30 天后若未在正式入口引用，视为过期快照。
- **双 SHA 风险**：生活圈分支与 main 并行。未对齐前，任何「全量修 bug」都会在错误的树上改。

---

## 10. 总评

项目具备进入**首台付费试点准备**的软件基础，不具备**商用 GO**。

可以立刻做的，是 §5.1–5.3 三个仍在主干上的缺陷，以及把工作区拉回 main。  
不能用代码关闭的，是 E1–E7。这些不关，整体继续 **NO-GO**。

上一份聊天评估回答的是「值不值得做、卡在哪一类」；本文件回答的是「以哪条 SHA 为准、哪些已修、哪些还能修、哪些修了也不能改判定」。
