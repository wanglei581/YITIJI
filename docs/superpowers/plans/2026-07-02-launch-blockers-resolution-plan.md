# 上线阻塞项解决方案与执行计划（交接 Codex）

> 创建：2026-07-02。用途：把当前所有上线阻塞项拆成可执行工作包，交给 Codex 推进。
> 权威清单以 [production-deployment-and-windows-host-checklist.md](../../device/production-deployment-and-windows-host-checklist.md) 为准，本文件是「怎么把它做完」的执行计划，不重复其验收口径。
> 进度回写 [current-progress.md](../../progress/current-progress.md)，不新建交接记录文件。

## 给 Codex 的入口（一句话）

> 读本文件，从 WP0 按序推进到 WP9。每个工作包已标注负责人：**[C]** 你（Codex）直接做；**[你]** 只产出 runbook/清单交给王本人执行，**不要**尝试代做云控制台 / 服务器 / 硬件 / 法务操作；**[C→你]** 你备料、王执行。遵守「通用纪律」。逐条命令见下方配套 runbook。

### 配套 runbook 清单（命令级，已就绪）

| 工作包 | 配套 runbook | 状态 |
|---|---|---|
| WP1 密钥轮换 | [secret-rotation-runbook.md](../../device/secret-rotation-runbook.md) | ✅ 就绪（含 `SECRET_ENCRYPTION_KEY` 勿盲换告警） |
| WP3 HTTPS | [https-temporary-trusted-setup-runbook.md](../../device/https-temporary-trusted-setup-runbook.md) | ✅ 就绪（临时→正式四阶段） |
| WP4+WP5 PG/verify | [production-acceptance-verify-runbook.md](../../device/production-acceptance-verify-runbook.md) | ✅ 就绪（执行顺序+命令串） |
| WP6 浏览器验收 | checklist [§4](../../device/production-deployment-and-windows-host-checklist.md) | ✅ 已有口径，按 §4 执行 |
| WP7 真机验收 | checklist [§5](../../device/production-deployment-and-windows-host-checklist.md) | ✅ 已有口径，按 §5 执行 |
| WP2/WP8/WP9 | 见本文件对应小节 | ✅ 步骤内联 |

## 0. 交给 Codex 前必须理解的前提（重要）

**「交给 Codex」不改变「谁能做」。** Codex 是 AI 代理，和 Claude 一样受同样的边界约束：

- ❌ Codex **不能**：轮换云控制台密钥、改 root/OS 密码、在生产服务器输入凭据、注册/备案域名、操作物理打印机/扫描仪/U盘、审定或接受法律条款。
- ✅ Codex **能**：改代码/配置/脚本、审计仓库密钥、补齐 `.env.example`、生成 nginx/certbot 配置模板、准备一键 verify 汇总、生成「你照着做不漏项」的服务器 runbook、回写文档。

因此每个工作包标注三种负责人：

- **[C]** = Codex 独立执行（代码/配置/文档，安全、可回滚、不碰真实密钥值与服务器）
- **[你]** = 只能你本人在控制台/服务器/现场执行
- **[C→你]** = Codex 先准备产物，你照着执行（交接点）

**通用纪律（每个工作包都遵守）：** 从干净 `main` 开 feature 分支；禁止 `git add .`，显式列路径；不硬编码任何密钥值（只动变量名/占位）；不触碰 `apps/` 业务 UI（本计划与 UI 无关）；改动 >30 行跑 `verify-change` / `verify-quality`；每个包完成回写 current-progress。

---

## 工作包总览与优先级

| # | 工作包 | 负责人 | 阻塞级别 |
|---|---|---|---|
| WP0 | 分支与仓库密钥审计 | [C] | 前置 |
| WP1 | 应用层密钥轮换（JWT/admin/COS/OCR/SMS/LLM…） | [C→你] | P0 |
| WP2 | root OS 密码与服务器访问收口 | [你]（C 出自检） | P0 |
| WP3 | HTTPS 受信证书落地（临时先行→正式替换） | [C→你] | P0（临时方案可先解除） |
| WP4 | PostgreSQL 生产实例验收 | [C→你] | P0 |
| WP5 | 核心 verify 在生产全绿 | [C→你] | P0 |
| WP6 | 线上浏览器业务验收 | [你]（C 出脚本化清单） | P0 |
| WP7 | Windows 真机 + 打印扫描验收 | [你]（物理） | P0 |
| WP8 | 合规法务（用户协议/隐私政策审定） | [你/法务] | P0 |
| WP9 | 收口：清单勾选 + 进度回写 | [C] | 收尾 |

**执行顺序：** WP0 →（WP1/WP2/WP3 并行准备）→ WP4/WP5 → WP6/WP7/WP8 → WP9。
WP3 采用「临时可信先解除阻塞 → 正式域名+备案后替换」：临时方案不需要域名，可立即上；正式域名+ICP 备案周期长，**建议现在就并行启动办域名**，别等。

---

## WP0 — 分支与仓库密钥审计　[C]

**目标：** 建好工作分支，确认仓库侧无密钥泄露、`main` 为待部署版本。

**步骤：**
1. 从干净 `main` 新建 `chore/launch-blockers-closure` 分支。
2. 审计（已由 Claude 初查为干净，Codex 复核并固化为脚本）：
   - `git ls-files | grep -iE '(^|/)\.env'` 应只返回 `.env.example`。
   - 全仓 grep 明文密钥赋值模式（`SECRET|KEY|TOKEN|PASSWORD` 直接等号接长串字面量，排除 `process.env`/example/占位）应为空。
   - 确认曾暴露标识（如百度旧 AppID）只出现在文档记录，不在代码。
3. 对照 checklist §2.1，确认 `main` = 待部署版本（`git log main..HEAD` 无遗漏关键提交）。

**验证：** 审计脚本输出全部 OK；`main` diff 干净。
**禁止：** 不修改任何 `.env`；不删历史文档里的暴露记录（它们是审计证据）。
**Done：** 分支建好 + 审计报告写入 current-progress。

---

## WP1 — 应用层密钥轮换　[C→你]

**目标：** 所有生产密钥使用「从未在聊天/日志出现过」的新值，且代码只从 env 读取。
**可执行对照表 + Runbook：** [secret-rotation-runbook.md](../../device/secret-rotation-runbook.md) —— 逐变量的用途/读取位置/轮换类型/验证脚本；含 `SECRET_ENCRYPTION_KEY` 勿盲换的告警。

**涉及 env 变量（`services/api/.env.example` 实名，只列名不列值）：**
`JWT_SECRET`、`TERMINAL_ADMIN_SECRET`、`TERMINAL_ACTION_TOKEN_SECRET`、`SECRET_ENCRYPTION_KEY`、`FILE_SIGNING_SECRET`、`TENCENT_COS_SECRET_ID/KEY`、`TENCENT_OCR_SECRET_ID/KEY`、`TENCENT_SMS_SECRET_ID/KEY`、`TENCENT_SECRET_ID/KEY`、`BAIDU_OCR_API_KEY/SECRET_KEY`、`BAIDU_ASR_API_KEY/SECRET_KEY`、`TRTC_SDK_SECRET_KEY`、`AI_LLM_API_KEY`、`AI_IMAGE_API_KEY`、`TRTC_LLM_API_KEY`。

> 注：百度 OCR（旧 AppID 7841387）文档记录已于 2026-06-13 轮换完成，本轮复核即可，无需再重建，除非近期又暴露。

**[C] Codex 做：**
1. 生成「密钥轮换对照表」（文档）：每个变量 → 由哪个服务/控制台签发 → 读取它的代码位置 → 轮换后跑哪个 verify。
2. 校验所有 `.env.example`（根 + 4 个 app + api）变量名齐全、有占位与注释，确保你在生产 `.env` 不会漏项。
3. 确认代码里这些值**全部**经 `process.env` 读取，无回退明文默认值（重点查 `SECRET_ENCRYPTION_KEY`、`JWT_SECRET`、`TERMINAL_ADMIN_SECRET`）。
4. 准备轮换后一键验证脚本清单（见验证）。

**[你] 你做（Codex 无法代做）：**
1. 在腾讯云 CAM / 百度 / LLM provider 控制台**重建或轮换**对应密钥，作废旧值。
2. 把新值填入生产服务器 `services/api/.env`（值只出现在服务器，不进仓库、不进聊天）。
3. 重启 API 进程加载新值。

**验证（你在服务器跑，或贴输出给 Claude/Codex 判读）：**
- `pnpm --filter @ai-job-print/api verify:cos:live`（COS 新密钥联网）
- `pnpm --filter @ai-job-print/api verify:ocr-baidu-live`（OCR 新密钥联网）
- `pnpm --filter @ai-job-print/api verify:production-runtime-gates`（生产运行门禁）
- 登录后台确认 admin token / JWT 新值生效、旧 token 失效。

**禁止：** Codex 不得把任何真实密钥值写入仓库、脚本、文档或日志。
**Done：** 对照表交付 + 你完成轮换 + 上述 verify 全绿。

---

## WP2 — root OS 密码与服务器访问收口　[你]（C 出自检）

**背景：** 2026-06-23 已加固（fail2ban + 禁 SSH 密码登录 + 轮换 root 密码）；但 TAS-G1（2026-07-02）记录 root 密码与管理员 token 在部署 overlay 时**再次暴露**，需再轮换。

**[C] Codex 做：** 出一份服务器自检清单（只读命令）：确认 `PasswordAuthentication no`、fail2ban 运行中、无异常登录、`.env` 权限 `600`、无历史命令泄露密钥（`history` 清理建议）。

**[你] 你做：**
1. 在服务器轮换 root/OS 密码为新强口令（不在任何聊天/文档出现）。
2. 确认仅密钥登录；轮换后跑 Codex 的自检清单。

**验证：** 自检清单全 OK；新密码未在任何可检索位置留存。
**Done：** 密码已轮换 + 自检通过，回写 current-progress（不写密码值）。

---

## WP3 — HTTPS 受信证书落地（临时可信 → 正式替换）　[C→你]

**策略（已按用户 2026-07-02 确认）：** 先上临时可信 HTTPS 解除阻塞，正式域名 + ICP 备案通过后无缝替换。按访问面分两条临时路径。
**可执行 runbook（逐条命令）：** [https-temporary-trusted-setup-runbook.md](../../device/https-temporary-trusted-setup-runbook.md) —— 下面各阶段的实际命令都在里面。

**两条诚实前提（Codex 与执行人都必须认账）：**
- Codex/Claude **够不到生产服务器与一体机**，无法直接部署证书。本 WP 产物是「照着跑就通」的 runbook + 配置文件；**真正解除阻塞发生在执行人（王）在机器上跑完那一刻**。
- **可信证书 ≠ 修好本地调用**：Kiosk HTTPS 页面调 `http://127.0.0.1:<localApiPort>` 的 mixed-content / PNA 问题独立存在（阶段三），不得因证书不再告警就宣称扫码登录可用。

### 阶段一（临时）· 一体机现场 —— 私有 CA（mkcert）　[C 出 runbook →〔你〕执行]
- **[C]** 产出：mkcert 安装/签发 runbook、nginx 证书片段、`rootCA.pem` 分发说明。
- **[你]** 执行：① 装 mkcert，`mkcert -install` 把本地根 CA 装进各一体机 Windows 信任库；② 签发 IP 叶证书 `mkcert 120.48.13.190 127.0.0.1 localhost`；③ nginx/本地服务加载 cert+key；④ 每台一体机导入 `rootCA.pem`（`mkcert -CAROOT`）。
- **验证：** 一体机浏览器访问 `https://120.48.13.190` 无告警（仅这些受控设备上可信，公网陌生浏览器不认属预期）。

### 阶段二（临时）· 后台公网访问 —— 二选一　[C 出配置 →〔你〕执行]
- **选项 A · Cloudflare Tunnel（最快，先试）：** 服务器装 `cloudflared`，`cloudflared tunnel --url http://localhost:8081`（partner 同理 8082）→ 得 `*.trycloudflare.com` 可信 HTTPS 入口。注意：流量经 Cloudflare（数据出境考量）、国内可达性/延迟需实测。
- **选项 B · sslip.io + Let's Encrypt：** 用 `120-48-13-190.sslip.io` 主机名 certbot HTTP-01 签发。注意 LE 频率限制。
- **验证：** 外部浏览器访问临时 URL 证书链完整无告警。

### 阶段三（必做）· mixed-content / PNA 评估　[C 独立完成]
- **[C]** 评估并给结论（对照 checklist §2.78、§4）：Kiosk 走 HTTPS 后调本地 http API 是否被浏览器阻断；给备选（受信本地桥接 / 本地 API 也上同一私有 CA 的 HTTPS / 现场访问策略）。

### 阶段四（正式替换）· 域名 + 备案 + 正式证书　[〔你〕前置，C 出替换 runbook]
- **[你]**（周期长，**建议现在并行启动**）：注册域名 → ICP 备案 → 解析到 `120.48.13.190`。
- **[C]** 出替换 runbook：certbot 正式签发（HTTP-01/DNS-01）、nginx 证书路径热替换、下线临时方案、开 HSTS。
- **验证：** `https://<域名>` 正式证书生效，临时方案已移除。

**中国大陆约束：** 大陆服务器域名跑 80/443 仍需备案；未备案前，后台对外走阶段二（Cloudflare 入口在境外 / 或纯 IP），不要用未备案域名对外服务。

**Done（阻塞项口径）：** 阶段一 + 阶段二 + 阶段三完成 = HTTPS 阻塞项按「临时可信」**已解除**；阶段四为正式终态，另行推进，不阻塞试运营上线。

---

## WP4 — PostgreSQL 生产实例验收　[C→你]

**可执行 runbook：** [production-acceptance-verify-runbook.md](../../device/production-acceptance-verify-runbook.md)（A 段 PG 部署 + B 段连接自检）。

**[C] Codex 做：** 准备生产 PG 验收 runbook，串起真实脚本：`db:pg:deploy`（空库部署）、`verify:production-db-guard`（生产库守门）、健康端点自检（`services/api/src/common/health.controller.ts`，期望 `db=postgres`）。对照 checklist §3.4 / §3.5。

**[你] 你做：** 在生产服务器按 runbook 执行；如有 SQLite 旧数据按 §3.5 走迁移演练。

**验证：** `db:pg:deploy` 成功；`verify:production-db-guard` 通过；`/health` 返回 `db=postgres`；CI 的 `postgres-readiness` job（`.github/workflows/ci.yml`）绿。
**Done：** 生产 PG 空库部署 + 守门 verify 通过，回写。

---

## WP5 — 核心 verify 在生产全绿　[C→你]

**可执行 runbook：** [production-acceptance-verify-runbook.md](../../device/production-acceptance-verify-runbook.md)（C 核心 verify + D 生产门禁 + E 联网真实服务）。

**[C] Codex 做：** 整理一个「生产核心 verify 汇总」执行清单（对照 checklist §3.6），至少含：
`verify:production-runtime-gates`、`verify:production-real-services`、`verify:cos:live`、`verify:ocr-baidu-live`、`verify:toolbox-preprod-acceptance`、`verify:member-login-data-closure`（聚合）。标注每条的前置（需哪些密钥/服务就绪）。

**[你] 你做：** 在生产/预生产按清单逐条跑，输出贴回。

**验证：** 清单全绿；失败项定位到 WP1（密钥）或环境变量缺失。
**Done：** 核心 verify 全通过。

---

## WP6 — 线上浏览器业务验收　[你]（C 出脚本化清单）

**[C] Codex 做：** 把 checklist §4（账号资产 / AI 简历闭环 / 打印文件闭环 / 岗位招聘会政策 / AI 外部服务）转成一份可勾选的浏览器验收脚本清单，标注每步的预期结果与合规检查点（按钮文案白名单、不伪造已完成状态）。

**[你] 你做：** 在线上逐项点验，回填结果与截图。

**验证：** §4 全部项通过，无越界文案、无假状态。
**Done：** 浏览器验收记录回写。

---

## WP7 — Windows 真机 + 打印扫描验收　[你]（物理，Codex 无法代做）

**[C] Codex 做：** 把 checklist §5（Windows 环境 / 打印机驱动 / Terminal Agent / 心跳 / 本地通信 / 真机打印 / 扫描 U盘外设）整理成现场执行卡，含 `printerName` 配置项确认（禁硬编码型号）。

**[你] 你做：** 在 Windows 一体机现场执行：驱动安装、Agent 自启、真机彩色/双面打印、扫描生成 PDF、U盘、心跳上报。

**验证：** §5 全部项通过；真机能出纸、能扫描、能上报在线/离线/故障。
**Done：** 真机验收记录回写。

---

## WP8 — 合规法务　[你/法务]

**[你] 你做：** 用户协议 / 隐私政策由法务审定，替换当前试运营文本（checklist §2.3 / §4.40 标注为阻塞）。Codex/Claude 不得替你审定或接受法律条款。

**[C] Codex 可辅助：** 核对前台展示的协议入口链接可达、版本号一致、生效日期占位正确。

**Done：** 法务定稿文本上线 + 入口可达。

---

## WP9 — 收口　[C]

**[C] Codex 做：**
1. 按各 WP 实际结果逐项勾选 [production-deployment-and-windows-host-checklist.md](../../device/production-deployment-and-windows-host-checklist.md)。
2. 回写 current-progress.md：哪些已解除、哪些仍阻塞、证据链接。
3. 严守口径：未完成 WP1–WP8 全部项前，**不得宣称「上线服务器无问题」或「可商用上线」**。

**Done：** 清单与进度文档与真实状态一致。

---

## 附：给 Codex 的一句话入口

> 从干净 `main` 建 `chore/launch-blockers-closure` 分支，按 WP0→WP9 顺序推进。凡标 [你] 的任务只产出 runbook/清单交给王本人执行，不要尝试代做控制台/服务器/硬件/法务操作。凡标 [C] 的任务遵守通用纪律（不硬编码密钥、显式 git add、跑 verify、回写进度）。每个工作包完成后在 current-progress.md 记录证据。
