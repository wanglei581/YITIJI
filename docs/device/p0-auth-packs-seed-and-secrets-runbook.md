# 上线前 P0 授权包 — seed 口令确认 / 密钥轮换举证

> 最后更新：2026-07-25  
> 对应 `docs/progress/next-tasks.md` 当前执行 §7a / §7b。  
> **本文不代替用户改密或轮换密钥**；AI/运维不得在聊天中索取、代填或回显密码与密钥值。

## 边界

| 包 | 允许 | 禁止 |
|----|------|------|
| `SEED_PASSWORD_CONFIRM` | 用户确认后台账号已非 seed 默认口令或已禁用；可选由用户本机改密 | AI 猜试默认口令登录；把密码发到聊天/仓库 |
| `SECRETS_ROTATION_EVIDENCE` | 用户提供控制台「已轮换」截图/变更时间（可打码密钥） | 密钥明文进仓库、PR、聊天、日志 |

与本包无关（须另授权）：G5 退款、F1 Genesis、close-unpaid Phase B、切 live 支付、Windows 现场（`WINDOWS_FIELD_RECHECK`）。

## 7a — `SEED_PASSWORD_CONFIRM`

### 背景

- Seed 历史账号：`admin` / `partner1` / `partner2`（明文曾出现在 `prisma/seed.ts`）
- 2026-07-25 预发只读：公网 Admin/Partner **登录页与 dist 无** `partner1` 等默认口令展示文案；Admin dist 中「初始密码（至少 8 位）」为**设密表单项标签**，不是泄露的默认口令
- 登录痕迹 ≠ 已改强密；清单 §2.2 只能由用户确认后勾选

### 用户操作（本机，勿贴密码）

1. 用本人掌握的强密码登录预发 Admin / Partner（或确认已禁用 `partner1`/`partner2`）
2. 若仍为 seed 默认：在「账号设置」改密后重新登录验证
3. 回复下方授权模板（**不要**附带新旧密码）

### 授权回复模板

```text
授权 SEED_PASSWORD_CONFIRM
环境：预生产
确认：admin / partner1 / partner2 均已非 seed 默认口令，或已禁用未使用的 partner 账号
窗口：2026-07-25 起
说明：密码不进聊天；仅确认结果
```

确认后可将 `production-deployment-and-windows-host-checklist.md` §2.2 勾选，并写一条脱敏进度。

## 7b — `SECRETS_ROTATION_EVIDENCE`

### 范围（名称级，不读值）

预发已配置名称级项（2026-07-25 盘点；同日用户口头确认「密钥在 .env」后复核仍成立）：百度 OCR、腾讯 COS（`TENCENT_COS_*`）、SMS（tencent）、TRTC（含 `TRTC_SDK_SECRET_KEY` 等），health `ok/postgres`。  
**重要区分**：服务器 `.env` 已写入密钥名/值 = **运行时已配置**；**不等于**控制台「暴露后已轮换」的举证。清单 §2.2 密钥项要求的是后者。

上线前须证明**曾在控制台轮换**（尤其历史有聊天暴露风险的百度 OCR）。历史附录（2026-06-13）曾记 OCR/COS live 复验通过，**默认不能自动勾选今日 §2.2**；若用户书面接受该历史清关仍适用于当前预发，也只能覆盖 OCR/COS，SMS/TRTC/LLM 仍须另确认。

### 用户提供（任选其一形态）

- 控制台「密钥已重置 / 更新时间」截图（密钥打码）
- 或书面：`OCR/COS/SMS/TRTC 已于 <日期> 在控制台轮换，运行时 .env 已同步且服务已验证健康`

### 授权回复模板（请原样粘贴后填日期）

```text
授权 SECRETS_ROTATION_EVIDENCE
环境：预生产
证据：OCR 控制台轮换日期 ____；COS 控制台轮换日期 ____；SMS 控制台轮换日期 ____；TRTC 控制台轮换日期 ____；（可选 LLM ____）
说明：密钥明文不进聊天；仅确认控制台已轮换且 .env 已同步
禁止：密钥明文进仓库或聊天
```

若只想沿用历史 OCR/COS（2026-06-13）清关、其余稍后补：

```text
授权 SECRETS_ROTATION_EVIDENCE（部分）
环境：预生产
确认：接受清单附录 2026-06-13 OCR/COS 控制台轮换结论仍适用于当前预发 .env
未覆盖：SMS / TRTC / LLM 仍待书面轮换日期或打码截图
禁止：密钥明文进仓库或聊天
```

## 当前状态（2026-07-25）

- close-unpaid Phase A：预生产 `DEPLOY_SOURCE=7e59243c` 复检仍 **`pending=0` / `eligible=0`** → 不进 Phase B
- 7a `SEED_PASSWORD_CONFIRM` + 7a2 `SEED_PASSWORD_ROTATE`：**已完成**（partner1/partner2 已离 seed 默认；清单 §2.2 seed 项已勾选）
- 7d `PARTNER_SMOKE_LOGIN`：**已完成**（partner `wanglei` + admin `admin` 只读 GET 200；凭据不入库）
- 7b `SECRETS_ROTATION_EVIDENCE`：**已完成（方案 C，2026-07-25）**——用户确认「可以，继续」：OCR/COS 沿用 2026-06-13；SMS/TRTC 为当前生产密钥且 `.env` 同步、今日不换。已勾 §2.2 OCR/COS/ASR·TTS·SMS·TRTC CAM 项；短信签名审核等仍开
- 7c `WINDOWS_FIELD_RECHECK`：**远程 Phase R 已复检**；**现场 Phase F 未做**——清单 `docs/device/windows-field-recheck-phase-f-runbook.md`——**推荐下一步（须人到场）**
  - R（2026-07-25）：`printer-status` → `ready` + `isOnline=true`；`Terminal` enabled + 近实时 `lastSeenAt`；近 30min 心跳多条；active PrintTask=0；`TerminalCapability` 0 行（managed 空表不证明扫描/USB）
  - F：一体机上按该 runbook 做 F1–F6，回执模板见该文；**未完成不得勾总清单 §五全部通过**
- 提醒：`/root/ai-job-print-seed-password-rotate-20260725T205537+0800.txt` 若仍在，请用户 SSH 取密后 `shred -u`
