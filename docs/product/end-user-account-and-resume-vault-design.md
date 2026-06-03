# C端求职者账号 + 简历云端库 + 使用记录 + 支付 方案设计

> 创建：2026-06-03
> 状态：**阶段 A（C 端账号体系）实施中**；B/C/D 待评审
> 决策依据：本方案由项目决策者于 2026-06-03 拍板，确认：
> 1. 简历云端存储采用 **账号级长期存储 + 可续期**（阶段 B）
> 2. C 端登录采用 **手机号 + 短信验证码**（阶段 A）
> 3. 先出完整方案设计文档，再分阶段实施
> 4. **本轮只做阶段 A（C 端账号体系）**，不做简历库 / 使用记录 / 支付
>
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [compliance-boundary.md](../compliance/compliance-boundary.md) | [feature-scope.md](./feature-scope.md) | [schema.prisma](../../services/api/prisma/schema.prisma)

---

## 一、背景与目标

### 1.1 痛点

当前 C 端求职者在一体机上是**匿名 session**（关 tab / 空闲超时即清）。每次到一体机都要重新本地上传简历，体验繁琐，简历无法跨次复用。

### 1.2 目标（全量，分阶段交付）

1. **账号体系**（阶段 A）：手机号 + 短信验证码登录，记录使用习惯。
2. **简历云端库**（阶段 B）：登录后简历长期保存在账号下，扫码/本地/扫描上传，随取随用，可直接修改或打印。
3. **使用记录**（阶段 C）：打印次数、AI 服务调用、岗位浏览等（仅限合规允许清单）。
4. **支付**（阶段 D）：打印 / AI 服务收费，商户号扫码付 + 退款 + 订单。

### 1.3 与现有规划的关系

| 现有规划 | 本方案的变化 |
|---------|-------------|
| [feature-scope.md](./feature-scope.md) "我的-我的简历"(P0) | 从"会话级临时列表"升级为"账号级持久库"（阶段 B） |
| "账号设置-手机号/密码"(P1) | 落地为独立 C 端账号体系（短信验证码，非密码）（阶段 A） |
| FileObject "简历 6h 即删"（[schema.prisma:262](../../services/api/prisma/schema.prisma#L262)） | 阶段 B 新增 `vault` 长期保留类（**身份证类仍即删**） |
| 打印/AI 暂未收费 | 阶段 D 新增订单 + 支付 + 退款 |

---

## 二、合规边界声明（最重要，先读）

### 2.1 招聘红线：不触碰 ✅

简历**只存在用户本人账号下，只由本人取用、修改、打印**，从头到尾不流向企业。这是工具服务，不是招聘闭环，不触碰 [compliance-boundary.md](../compliance/compliance-boundary.md) 第二节任何一条。

### 2.2 必须死守的护栏（架构级强制）

> **企业 / 合作机构（partner）端永远无法读取 `EndUser` / 简历库 / 简历类 `FileObject` 的任何字段。**

- partner 后台**不新增**任何读取用户文件 / 简历库 / 用户画像的路由或接口。
- **不建立**简历的全文检索、标签化、"人才库"能力——否则命中红线第 4、6 条。
- 外部岗位跳转**只记录"跳转行为"，不记录投递结果**（[compliance-boundary.md:105](../compliance/compliance-boundary.md#L105)）。
- C 端 JWT 与内部（admin/partner）JWT **隔离**：C 端 token 带 `aud=enduser`，内部 guard 拒绝；C 端 guard 也拒绝内部 token。

### 2.3 隐私 / 数据保留边界（阶段 B 才扩展，阶段 A 不改治理文档）

简历长期存储是对 [compliance-boundary.md 第五条](../compliance/compliance-boundary.md#L112)"不长期保存简历"的**主动扩展**，须在**阶段 B 评审签字后**才更新治理文档。

> **阶段 A 不修改 [compliance-boundary.md](../compliance/compliance-boundary.md)。** 账号体系本身不长期保存任何简历/证件文件，不触碰第五条。

阶段 B 扩展时须满足 PIPL：单独同意、最小必要（身份证类仍即删）、明确期限、可删可导出、公共终端会话安全、管理员访问留痕。

---

## 三、总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  Kiosk 一体机前台 (apps/kiosk)                                  │
│  ┌────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ C端登录【A】│  │ 简历库【B】 │  │ 我的记录【C】│ │ 收银台【D】│  │
│  │ 手机号+验证码│  │ 上传/选择/打印│  │ 打印/AI  │  │ 扫码付    │  │
│  └─────┬──────┘  └──────┬──────┘  └────┬─────┘  └────┬─────┘  │
└────────┼────────────────┼──────────────┼─────────────┼────────┘
         │ EndUser JWT (aud=enduser, jti, 30min, 内存/sessionStorage)
         ▼                ▼              ▼             ▼
┌──────────────────────────────────────────────────────────────┐
│  services/api  (NestJS, /api/v1/member/*)                      │
│  ┌──────────────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ member-auth 【A】│ │ vault【B】│ │ usage【C】│ │payments【D】│ │
│  │ EndUserAuthGuard │ └──────────┘ └──────────┘ └──────────┘  │
│  └────────┬─────────┘                                          │
│   Redis: 会话(jti) + 验证码(TTL5min) + 多维频控               │
└───────────┼────────────────────────────────────────────────────┘
            ▼
       短信服务商(阿里/腾讯, 阶段A接口预留, 真接入待选型)

  ❌ partner 后台无任何指向 EndUser 的箭头（架构级护栏）
```

技术栈沿用现有：NestJS + Prisma + `@nestjs/jwt` + ioredis（已是依赖）+ `@nestjs/throttler`（已全局）+ AES-256-GCM（复用 [secret-cipher.ts](../../services/api/src/common/crypto/secret-cipher.ts)）。

---

## 四、模块一：C 端账号体系（阶段 A，本轮实施）

### 4.1 为什么不复用现有 `User` 表

现有 [`User`](../../services/api/prisma/schema.prisma#L110) 是 admin/partner/kiosk **内部运营账号**，且 [`AuditLog.actor`](../../services/api/prisma/schema.prisma#L514) 只 FK 到它。C 端求职者权限模型完全不同，**必须独立建表**。

### 4.2 数据模型（阶段 A 只建这一张表）

> **手机号隐私设计（约束 1）**：用 `phoneHash` 做唯一查找，手机号**不存明文列**；可恢复的明文以 AES-256-GCM 加密存于 `phoneEnc`，仅服务端解密用于派生脱敏展示。**API 永不返回手机号明文，前端只见 `phoneMasked`（如 138****1234）。**

```prisma
// C 端求职者账号 — 与内部 User 完全隔离。阶段 A 只建此表。
model EndUser {
  id          String    @id @default(cuid())
  phoneHash   String    @unique          // HMAC-SHA256(手机号, pepper),唯一查找用,不可逆
  phoneEnc    String                      // AES-256-GCM 加密手机号,仅服务端可解,用于派生脱敏展示
  nickname    String?
  enabled     Boolean   @default(true)
  lastLoginAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

注意：**无 passwordHash**（验证码登录）。**阶段 A 不创建** `ResumeVaultItem` / `UsageEvent` / `Order` / `Refund`，也不在 `EndUser` 上提前加它们的关系字段（约束 2，migration 按阶段拆分）。`consentVaultAt` 等字段留到阶段 B 再加。

### 4.3 登录流程（手机号 + 短信验证码）

```
1. POST /api/v1/member/auth/sms-code { phone, deviceId? }
   - 规范化+校验手机号(1[3-9]\d{9}) → phoneHash
   - 多维频控(约束 5):
       · 单手机号冷却 60s   (Redis SET NX EX 60)
       · 单手机号日上限     (Redis INCR + EXPIRE 86400, 上限 10)
       · 单 IP 时上限       (Redis INCR + EXPIRE 3600, 上限 20)
       · 单设备(deviceId)时上限 (同上)
   - 生成 6 位数字验证码 → Redis SETEX sms:code:{phoneHash} 300 (TTL 5min, 约束 5)
   - 重置该号的尝试计数
   - 经 SmsSender 下发(dev: 仅服务端日志, 不返回明文验证码)
2. POST /api/v1/member/auth/login { phone, code, deviceId? }
   - 取 Redis 验证码; 不存在/过期 → 401
   - 尝试计数 INCR; >5 次 → 删码 + 401 (防 6 位码爆破)
   - 比对; 不符 → 401
   - 成功: 立即 DEL 验证码 + 尝试计数 (用后删除, 约束 5, 防重放)
   - upsert EndUser(by phoneHash); 停用 → 403
   - 生成 sessionId(jti) → Redis SETEX member:session:{jti} 1800 = endUserId
   - 签发 JWT { sub:endUserId, aud:'enduser', jti:sessionId }, expiresIn 30m (约束 3)
   - 更新 lastLoginAt
   - 返回 { token, user:{ id, phoneMasked, nickname } } (无明文手机号)
3. POST /api/v1/member/auth/logout (EndUserAuthGuard)
   - DEL member:session:{jti} → 会话立即失效 (约束 3)
4. GET /api/v1/member/me (EndUserAuthGuard)
   - 回 { id, phoneMasked, nickname }
```

### 4.4 公共终端会话安全（硬要求）

| 机制 | 设计 | 约束 |
|------|------|------|
| Token 短期 | EndUser JWT TTL **30 分钟**，带 `aud=enduser` + `jti`(=sessionId) | 3 |
| 服务端会话 | Redis `member:session:{jti}`，`EndUserAuthGuard` 每次校验该 key 存在且 == sub；不存在即 401 | 3 |
| 会话失效 | logout 与 idle logout 都 DEL 该 key → token 即使未过期也失效 | 3 |
| 空闲登出 | 前端 Kiosk 层 **5 分钟**无操作 → 调 logout + 清前端态 + 跳首页 | 4 |
| 不持久化 | 前端 token **只放内存 + sessionStorage**，**禁止 localStorage**（关 tab / 换人即清） | 4 |
| 隔离 | C 端 JWT 带 `aud=enduser`；`EndUserAuthGuard` 校验 aud；内部 `JwtAuthGuard` 拒绝 `aud=enduser` 的 token | 2/3 |

### 4.5 短信发送抽象（阶段 A 预留接口）

`SmsSender` 接口 + dev 用 `LogSmsSender`（仅服务端日志打印验证码，便于本地联调，**不返回前端**）。真实服务商（阿里云短信 / 腾讯云短信）作为"待决策"项后续接入，密钥进 `services/api/.env`。

---

## 五、模块二：简历云端库（阶段 B，待评审）

> 本轮不实施。设计要点保留：`ResumeVaultItem` 包一层账号级生命周期，简历本体仍存 `FileObject`（新增 `sensitiveLevel='vault'` 保留类，cleanup cron 按 `retainUntil` 而非 `expiresAt` 处理）；身份证类（`id_scan`）**永不入库**；入库前弹"单独同意"记 `consentVaultAt`；列表只回元数据，访问签发 ≤30min 临时 URL；用户可删（软删+删除日志）可导出；扫码上传 token 绑定 endUserId。

接口（阶段 B）：`GET/POST /member/resumes`、`/:id/url`、`/:id/renew`、`PATCH /:id`、`DELETE /:id`、`/export`、`POST /member/consent/vault`。

---

## 六、模块三：使用记录（阶段 C，待评审）

> 本轮不实施。严格按 [compliance-boundary.md:99-108](../compliance/compliance-boundary.md#L99-L108) 允许清单：打印、AI 调用、岗位浏览/收藏、外部跳转行为、招聘会浏览。`UsageEvent.eventType` 白名单校验。打印记录归属账号：`PrintTask.endUserId`（阶段 C migration 再加）。

---

## 七、模块四：支付（阶段 D，待评审）

> 本轮不实施。商户号扫码付即可，**不做二清**；支付凭证只存服务端；回调验签 + 幂等（复用 W3 Pantum/Webhook 模式）。模型 `Order` / `Refund`（阶段 D migration 再加）。

---

## 八、合规护栏自查清单（每阶段过；阶段 A 适用项已标）

- [ ] **【A】** C 端 JWT 与内部 JWT 隔离（`aud=enduser` + 独立 guard，互拒）
- [ ] **【A】** 手机号不存明文列；API 不返回明文；前端只见 `phoneMasked`
- [ ] **【A】** 验证码只存 Redis，TTL 5min，用后删除，多维频控 + 尝试上限
- [ ] **【A】** 空闲 5min 强制登出 + 显式登出 + token 不入 localStorage
- [ ] **【A】** logout / idle logout 让 Redis 会话失效
- [ ] **【A】** 阶段 A 不创建 vault/usage/order 表，不改 compliance-boundary.md
- [ ] 【B】身份证类不入库仍即删；入库前单独同意；≤30min 临时 URL；可删可导出
- [ ] partner/企业端无任何读取 EndUser / 简历库的路径（全程）
- [ ] 【D】支付凭证只存服务端；回调验签+幂等；不做二清

---

## 九、分阶段实施计划

> 每阶段独立可交付、可验收，均不越线。已从 `main` 开 `feat/end-user-account` 分支，禁止在 main 提交。**migration 按阶段拆分（约束 2）**。

| 阶段 | 范围 | migration | 关键交付 |
|------|------|-----------|---------|
| **A. C 端账号** ←本轮 | EndUser + 短信验证码登录 + 会话安全 | `add_end_user`（**仅 EndUser 一张表**） | member-auth 模块、EndUserAuthGuard、Redis 会话/频控、Kiosk 登录页+空闲登出 |
| B. 简历云端库 | ResumeVaultItem + vault 保留类 + 同意 + 续期/删除/导出 + 扫码上传 | `add_resume_vault` | resume-vault 模块、"我的-简历库"页 |
| C. 使用记录 | UsageEvent + PrintTask.endUserId | `add_usage_event` | usage 模块 |
| D. 支付 | Order/Refund + 商户号下单 + 回调 | `add_order_refund` | payments 模块、收银台 |

### 阶段 A migration（只这一张表）

```prisma
+ model EndUser   // 新增,仅此表;不提前建 vault/usage/order/refund
```

---

## 十、待决策 / 风险

| 项 | 说明 | 建议 |
|----|------|------|
| 短信服务商 | 阿里云短信 / 腾讯云短信 | 阶段 A 先用 LogSmsSender 联调；真接入按现有云资源选 |
| 续期默认期限（阶段 B） | 暂定 90 天 | 90 天 + 到期前 7 天提醒 |
| 支付渠道资质（阶段 D） | 商户号申请周期长 | 阶段 D 前先启动申请 |
| 微信扫码登录 | 本期定手机号+验证码 | 后续可加，账号体系预留绑定 |
| Redis 必需 | 会话/验证码/频控强依赖 Redis | `.env` 已配 `REDIS_URL`，部署须保证 Redis 在线 |

---

## 十一、评审通过后的行动项（阶段 B 起）

1. 阶段 B 评审签字后，更新 [compliance-boundary.md](../compliance/compliance-boundary.md) 第五条，新增"简历云端库受控长期存储"小节。
2. 在 [feature-scope.md](./feature-scope.md) "我的"小节标注简历库从临时升级为账号级。
3. 进度写入 [current-progress.md](../progress/current-progress.md) / [next-tasks.md](../progress/next-tasks.md)。
