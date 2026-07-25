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

预发已配置名称级项（2026-07-25 盘点）：百度 OCR、COS、SMS（tencent）、TRTC、以及 LLM 相关（若启用）。  
上线前须证明**曾在控制台轮换**（尤其历史有聊天暴露风险的百度 OCR）。

### 用户提供（任选其一形态）

- 控制台「密钥已重置 / 更新时间」截图（密钥打码）
- 或书面：`OCR/COS/SMS/TRTC 已于 <日期> 在控制台轮换，运行时 .env 已同步且服务已验证健康`

### 授权回复模板

```text
授权 SECRETS_ROTATION_EVIDENCE
环境：预生产
证据：<截图路径在仓库外 / 或书面轮换日期列表>
范围：百度 OCR、COS、SMS、TRTC（及已启用的 LLM）
禁止：密钥明文进仓库或聊天
```

## 当前状态（2026-07-25）

- close-unpaid Phase A：预生产 `DEPLOY_SOURCE=7e59243c` 复检仍 **`pending=0` / `eligible=0`** → 不进 Phase B
- 7a / 7b：**等待用户书面授权确认**
- 7c Windows 现场、7d Partner 登录冒烟：另包
