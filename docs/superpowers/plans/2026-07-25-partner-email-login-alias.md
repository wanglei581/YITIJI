# Partner Email Login Alias (Wave 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partner 密码登录支持已验证邮箱别名；Admin 合作机构账号可代绑/换绑登录邮箱（人工核验，无 SMTP）。

**Architecture:** 镜像手机号身份：`emailHash`（HMAC 唯一查找）+ `emailEnc`（AES 展示）+ `emailVerifiedAt` + `emailVerifyMethod='admin_manual'`。`findUserByLoginId` 按 phone → email → username 解析；Admin `POST/PATCH .../accounts/:id/email` 写库并 `tokenVersion++`。不做邮箱 OTP / 找回 / Partner 自助绑定。

**Tech Stack:** NestJS, Prisma (SQLite+PostgreSQL), React Admin/Partner, Node verify 脚本

**Spec:** [docs/reviews/partner-account-email-bind-commercial-proposal-2026-07-25.md](../../reviews/partner-account-email-bind-commercial-proposal-2026-07-25.md)

---

## File budget

| Action | Path |
|--------|------|
| Create | `services/api/src/common/crypto/email-identity.ts` |
| Create | `services/api/prisma/migrations/20260725180000_add_user_email_login_alias/migration.sql` |
| Create | `services/api/prisma/postgres/migrations/20260725180000_add_user_email_login_alias/migration.sql` |
| Create | `services/api/src/orgs/dto/bind-account-email.dto.ts` |
| Create | `services/api/scripts/verify-partner-email-login-alias.ts` |
| Modify | `services/api/prisma/schema.prisma` + `postgres/schema.prisma` (`User`) |
| Modify | `services/api/src/auth/auth.service.ts` |
| Modify | `services/api/src/orgs/admin-orgs.{controller,service}.ts` |
| Modify | `services/api/src/orgs/admin-org-account-view.ts` |
| Modify | `apps/admin/src/services/api/orgsAdmin.ts` |
| Modify | `apps/admin/src/routes/partners/PartnerAccountManager.tsx` |
| Modify | `apps/partner/src/routes/login/index.tsx` |
| Modify | root `package.json` / CI（接入 `verify:partner-email-login-alias`） |
| Modify | `docs/progress/current-progress.md`, `next-tasks.md` |

**禁止：** SMTP、邮箱 OTP、Kiosk/会员登录、Organization 联系邮箱当登录身份、支付/打印/生产配置。

---

### Task 1: email-identity + schema

- [ ] 新增 `email-identity.ts`（normalize/hash/encrypt/mask，镜像 phone-identity）
- [ ] 双 schema `User` 加 `emailHash` `@unique`、`emailEnc`、`emailVerifiedAt`、`emailVerifyMethod`
- [ ] 双轨 migration `20260725180000_add_user_email_login_alias`

### Task 2: login alias

- [ ] 扩展 `findUserByLoginId`：已验证 emailHash 可登录
- [ ] 登录失败统一 `INVALID_CREDENTIALS`；短信路径不接受邮箱

### Task 3: Admin bind API + view

- [ ] DTO：`email` + `confirmVerified: true`（必须）
- [ ] `bindAccountEmail`：唯一性 CAS、写 verifiedAt/method、`invalidateAccountSession`
- [ ] `deleteAccount` 清 email 字段；列表视图返回 `emailMasked` 等

### Task 4: Admin + Partner UI

- [ ] PartnerAccountManager：展示/绑定/换绑 + 二次确认
- [ ] Partner 登录文案三别名；短信 Tab 诚实边界

### Task 5: verify + docs

- [ ] `verify:partner-email-login-alias`（绑/登录/未验证拒绝/换绑踢会话/脱敏）
- [ ] 接入 CI；更新 progress 文档
