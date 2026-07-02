# 密钥轮换对照表与 Runbook（WP1）

> 2026-07-02。配套计划 [WP1](../superpowers/plans/2026-07-02-launch-blockers-resolution-plan.md)。
> 背景：root 密码、管理员 token 在近期部署中曾暴露；上线前所有生产密钥须换成「从未在聊天/日志/仓库出现过」的新值。
> 三条前提：① 执行者是你（王），在**云控制台**重建 + 在**生产服务器 `services/api/.env`** 填新值 + 重启，Claude/Codex 均无法代做；② 新值**只出现在服务器**，不进仓库/聊天/本文件；③ 仓库侧已确认干净（无 `.env` 被跟踪、无硬编码密钥）。

---

## 0. 轮换分三类（决定能不能"改了就重启"）

| 类型 | 含义 | 轮换动作 | 副作用 |
|---|---|---|---|
| **T1 外部凭据** | 第三方服务的 key/secret | 控制台重建 → 改 env → 重启 | 无（旧值作废即可） |
| **T2 本应用签名密钥** | 本系统签 token/URL 用 | 生成强随机新值 → 改 env → 重启 | 已签发的 token/链接失效（=强制重新登录/重取链接，通常可接受） |
| **T3 加密/pepper 密钥** | 加密已落库数据 | ⚠️ **不能盲换**，见 §3 | 旧密文解不开、已有哈希映射失配 |

---

## 1. 对照表（按变量）

| 变量名 | 用途 | 读取位置 | 类型 | 轮换后验证 |
|---|---|---|---|---|
| `TENCENT_COS_SECRET_ID` / `_KEY` | 对象存储（文件/简历） | `storage/storage.service.ts:42` | T1 | `verify:cos:live`、`verify:cos:files` |
| `BAIDU_OCR_API_KEY` / `_SECRET_KEY` | OCR（简历识别） | `config/production-runtime-gates.ts:104` | T1 | `verify:ocr-baidu-live` |
| `TENCENT_SMS_SECRET_ID` / `_KEY` | 短信验证码 | `config/production-runtime-gates.ts:41` | T1 | 登录发码实测 + `verify:production-runtime-gates` |
| `TRTC_SDK_SECRET_KEY` | 音视频（AI 助手小青） | `trtc/trtc.service.ts:39` | T1 | `/assistant` 通话联通实测 |
| `AI_LLM_API_KEY`（含 `TRTC_LLM_API_KEY`） | 大模型 | `config/production-runtime-gates.ts:116` | T1 | AI 简历/问答真实调用实测 |
| `TENCENT_OCR_SECRET_ID` / `_KEY` | 备用 OCR | 同 gates | T1 | 按启用情况 |
| `JWT_SECRET` | 登录态签名 | `main.ts:56` 启动门禁 + 各模块 | T2 | 换后旧登录全失效（预期）；重新登录成功 |
| `TERMINAL_ADMIN_SECRET` | 终端管理鉴权（**曾暴露**） | `terminals/terminals.service.ts:326` | T2 | 后台终端管理操作鉴权通过 |
| `TERMINAL_ACTION_TOKEN_SECRET` | 终端动作令牌 | `terminals/terminals.service.ts:327` | T2 | 终端下发动作生效 |
| `FILE_SIGNING_SECRET` | 文件临时签名 URL | `content/content-signing.ts:19`、`files/signing.ts` | T2 | 换后旧签名链接失效（短时效，可接受）；新链接可下载 |
| `SECRET_ENCRYPTION_KEY` | **加密数据源凭据 + 手机号哈希 pepper** | `common/crypto/phone-identity.ts:26` 等 | **T3** | ⚠️ 见 §3，勿盲换 |

> 生成 T2 强随机值示例（服务器上执行，输出即新值，直接贴进 `.env`）：`openssl rand -base64 48`

---

## 2. T1 / T2 标准轮换流程

1. **T1**：登录对应云控制台（腾讯云 CAM / 百度 / LLM provider）→ 新建密钥或轮换 → **作废旧密钥**。
2. 编辑生产 `services/api/.env`，替换对应变量为新值（`.env` 权限确认 `600`）。
3. `openssl rand -base64 48` 生成 T2 各签名密钥新值，一并填入。
4. 重启 API：`pm2 restart <api 进程>`（或你的守护方式），确认无启动报错（`main.ts` 有 fail-closed 门禁，缺关键变量会拒启）。
5. 按对照表最后一列逐项验证。
6. 全绿后跑一次聚合门禁：`pnpm --filter @ai-job-print/api verify:production-runtime-gates`。

---

## 3. ⚠️ SECRET_ENCRYPTION_KEY 特别说明（T3，勿盲换）

这把 key **有两个用途**，直接换会出事：
- **加密已落库的数据源凭据**（JobSource / DataSourceConfig 的 `apiSecret` / `accessToken` / `webhookSecret` 密文）→ 换 key 后旧密文**永久解不开**，合作机构数据源全部失效。
- **手机号哈希 pepper**（`phone-identity.ts`）→ 换 key 后同一手机号算出的 hash 变了，**已有用户按手机号的匹配/登录会错乱**。

**处置决策：**
1. **先判断它是否真的需要换**：这把 key 是否曾暴露？如果从未泄露（只在服务器 `.env`），**建议不换**，保持稳定。
2. **若确需换**（确认暴露过），必须走迁移，不能直接改值：
   - a. 盘点：DB 里是否已有加密的数据源凭据密文、是否已有真实用户手机哈希。
   - b. 若**两者都为空**（尚无生产数据）→ 可安全直接换。
   - c. 若**已有数据** → 需写一次性迁移：用旧 key 解密 → 用新 key 重新加密（凭据）；手机哈希无法平滑迁移，需要求受影响用户重新绑定，或保留旧 pepper 仅用于校验。**此项须单独评审后再做，不在本轮"改 env 重启"范围内。**

> 一句话：T1/T2 这轮就能换干净；`SECRET_ENCRYPTION_KEY` 除非确认泄露，否则本轮**不动**，要动单独立项。

---

## 4. 完成标准（WP1 Done）
- T1 全部在控制台重建、旧值作废、`verify:cos:live` / `verify:ocr-baidu-live` 等联网验证通过。
- T2 全部换新、旧 token 失效、重新登录与终端操作正常。
- `SECRET_ENCRYPTION_KEY` 已做"换/不换"决策并记录理由（不写值）。
- `verify:production-runtime-gates` 通过。
- 回写 [current-progress.md](../progress/current-progress.md)：列已轮换变量名 + 决策，**不写任何密钥值**。
