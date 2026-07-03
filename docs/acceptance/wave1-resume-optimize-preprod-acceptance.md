# Wave 1 AI 简历优化闭环 · 预生产验收 runbook（仅计划 + 命令清单）

> 状态：**执行清单与证据标准已定义，尚未执行**。本文件不部署、不写服务器、不改代码，只定义验收方法。
> 原始截图、命令日志、SQL 输出、浏览器 HAR、签名 URL、真实终端照片、服务器备份必须保存在**仓库外私有证据目录**；证据不进 Git，Git 只记录脱敏摘要和证据 ID。
> 候选：`origin/main = ea15764a`（含 PR #121 Wave 1）。关联：`docs/superpowers/plans/2026-07-02-resume-optimize-closure-wave1.md`。

## 一、验收边界

**在验收范围内（本轮要证明的真实闭环）：**
- 真实 LLM（`AI_PROVIDER=llm` + `LLM_API_KEY`）驱动简历优化；真实 OCR（`OCR_PROVIDER=baidu`）用于图片/扫描件诊断前置。
- 真实 PostgreSQL（`DATABASE_URL=postgres…`）+ Redis（`REDIS_URL`）+ 腾讯 COS 私有桶（`FILE_STORAGE_DRIVER=cos`）。
- 真实会员短信登录（`SMS_PROVIDER` 真实，或按 runbook 记录临时替代口径）。
- AI 简历优化：诊断 → 携带 专业/学历/目标岗位 进入优化 → 前后对比 → 结构化编辑。
- 四格式导出：PDF / Word(docx) / TXT / Markdown 各自成功进 FileObject（`assetCategory=optimized`、绑定本人、短时签名 URL）。
- `/me/documents` 浏览器可见四格式文件并可下载。
- PDF 打印确认链路：从优化版 PDF 进 `/print/confirm` → 创建 `PrintTask` / `POST /print/jobs`。

**不在本轮范围（禁止顺带做 / 诚实标注）：**
- docx / txt / md **不做直接打印**（打印链路仅 `application/pdf`）；验收只确认它们诚实走「下载」，不出现「可打印/已打印」。
- Windows 真机出纸：仅当预生产接了真实 Terminal Agent + 奔图打印机时验收出纸；否则只验收到 `PrintTask` 落库 + 状态诚实，不伪造出纸成功。
- 不做 Wave 2–6（排版/模板/语音/支付/URL 抓取/格式转换）。
- 不做支付；`assertExportFormatAllowed` 现恒放行，不得在本轮加任何计费/扣费。

## 二、前置条件（未满足则停在只读预检，不得继续）

1. **预生产已部署 Wave 1 候选**：预生产运行版本必须包含 `ea15764a`（或其后含 Wave 1 的提交）。当前预生产若仍是旧 overlay（`7e739f40`）**未含 Wave 1**，则必须先由有服务器密钥者按独立部署流程部署候选——**该部署是写操作，不在本 runbook 内，需另行确认执行**。
2. **真实服务 env 就位**（服务端 `.env`，值不入仓、不回显）：`NODE_ENV=production`、`AI_PROVIDER=llm` + `LLM_API_KEY`、`OCR_PROVIDER=baidu` + `BAIDU_OCR_API_KEY` / `BAIDU_OCR_SECRET_KEY`、`FILE_STORAGE_DRIVER=cos` + COS 凭证、`DATABASE_URL=postgres…`、`REDIS_URL`、`SMS_PROVIDER` 真实。
3. **执行者与权限**：服务器侧（env 脱敏复核、DB 抽样、COS 核验、备份）需 SSH 密钥持有者（Claude 无 SSH 密钥，不能执行服务器步骤）；浏览器 E2E 经公网 HTTPS，任何授权执行者可做。

## 三、执行原则

- 先过 RW1-G0 本地静态门禁 → 再 RW1-G1 服务器只读预检 → 再 RW1-G2 后端真实 live 冒烟 → 再 RW1-G3 浏览器 E2E → 最后 RW1-G4 隐私/合规/诚实抽样。任一 Gate 失败即停，不跳级。
- 所有证据脱敏：不得保存 token、cookie、完整签名 URL、手机号、验证码、身份证号、`DATABASE_URL` 连接串或任何密钥。
- 用合成简历与受控测试会员；验收结束清理本轮 FileObject / AiResumeResult / COS 对象 / EndUser / Redis 会话，并记录清理证据。

## 四、证据目录（仓库外）

```
EVIDENCE_ROOT=/tmp/ai-job-print-evidence/wave1-resume-optimize-$(date +%Y%m%d%H%M%S)
mkdir -p "$EVIDENCE_ROOT"/{G0,G1,G2,G3,G4}
```
证据目录**不得**包含：密钥 / 连接串 / token / cookie / 验证码 / 完整签名 URL / 真实用户文件 / 未脱敏手机号。只存脱敏摘要、命令退出码、断言 PASS/FAIL、DB 抽样的非 PII 字段、备份路径 + sha256。

## 五、RW1-G0 本地静态门禁（任何机器可跑，先决）

```bash
# 在含 Wave 1 的工作树内（DATABASE_URL 缺省时脚本回退本包 sqlite 测试库）
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api verify:resume-generate
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
pnpm --filter @ai-job-print/api verify:production-real-services
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-db-guard
pnpm --filter @ai-job-print/api verify:file-retention
git diff --check
```
通过标准：全部 `ALL PASS` / typecheck 无错 / diff 无空白错误。证据存 `G0/`（命令 + 退出码摘要）。

## 六、RW1-G1 预生产只读预检（服务器侧只读 + 公网只读）

```bash
# 公网只读（任何执行者）
curl -fsS https://120.48.13.190.sslip.io/api/v1/health            # 期望 success=true, db=postgres
curl -sS -o /dev/null -w "%{http_code}\n" https://120.48.13.190.sslip.io/        # Kiosk 200
# 服务器侧（SSH 密钥持有者）
#   1) 部署源确认：sed -n '1,80p' /srv/ai-job-print/DEPLOY_SOURCE.txt → base_commit 含 Wave 1（ea15764a 或其后）
#   2) env 脱敏复核（只输出 set/unset，绝不输出值）：
#      node - <<'NODE'
#      require('dotenv').config({path:'/srv/ai-job-print/services/api/.env'})
#      for (const k of ['NODE_ENV','AI_PROVIDER','LLM_API_KEY','OCR_PROVIDER','BAIDU_OCR_API_KEY','FILE_STORAGE_DRIVER','DATABASE_URL','REDIS_URL','SMS_PROVIDER'])
#        console.log(k+'='+(process.env[k]?'set':'unset'))
#      NODE
```
停止条件：health 非 `db=postgres`；`DEPLOY_SOURCE` 不含 Wave 1；任一必需 env `unset`。**部署源不含 Wave 1 时只能停在此，不得继续**（需先部署候选，属独立写操作）。证据存 `G1/`。

## 七、RW1-G2 后端真实 live 冒烟（服务器可信 HTTPS，受控合成数据）

用合成简历，经真实 LLM 走优化 + 四格式导出，只验后端契约，不依赖 UI：
1. `POST /api/v1/resume/parse`（合成可解析简历）→ 拿 `taskId`（匿名则记一次性 `accessToken`，只在内存，不入证据）。
2. `GET /api/v1/resume/records/:taskId/optimize`（携带鉴权）→ 真实 LLM 返回 `optimizedResume` + `modules`；断言 provider 非 mock。
3. 对 `format ∈ {pdf,docx,txt,md}` 各调 `POST /api/v1/resume/generate/export`（body 带 `taskId` + 优化版 + `format`）→ 各返回 `fileId` + `signedUrl`（**均 200，txt/md 不 400**）。
4. 每个 `signedUrl` 首次 GET 200；等待/超 TTL 后 GET 403（签名 URL 短时有效 ≤30min）。
5. 服务器侧 COS + DB 脱敏抽样（SSH 持有者）：四个 FileObject `assetCategory='optimized'`、`purpose='resume_upload'`、`createdBy='ai_resume_generate'`、mimeType/扩展名匹配、绑定该会员；COS HEAD 200。
6. **隐私红线抽样**：DB 查该 taskId 的 `AiResumeResult.payloadJson` **不含简历原文**（只结构化 report/targetContext）；服务日志不含简历正文。
停止条件：任一格式导出 400 / 非 200；provider 落回 mock；payloadJson 出现原文；签名 URL 不过期。证据存 `G2/`（脱敏摘要 + 退出码 + digest 前缀，不存完整 URL/原文）。

## 八、RW1-G3 会员浏览器 E2E（公网 HTTPS，真实链路）

用 Playwright/真实浏览器访问 `https://120.48.13.190.sslip.io`，受控测试会员：
1. 会员**短信登录**（真实 `SMS_PROVIDER`；若短信仍在审核，按 runbook 记录临时替代口径，不把验证码入证据）。
2. 上传合成简历 → 诊断报告出 6 维评分。
3. 「继续生成优化版」→ 优化页可见并可填**专业 / 学历 / 目标岗位**方向；前后 `ReactDiffViewer` 对比展示；可编辑结构化字段。
4. 导出菜单四选一：**PDF / Word / TXT / Markdown** 各导出一次，成功提示按格式显示（非 PDF 不显示假页数）。
5. `/me/documents` 出现刚导出的四个文件，可下载；**PDF 有「去打印」入口，docx/txt/md 只有「下载」**（诚实边界）。
6. 对 PDF 进 `/print/confirm` → 创建打印任务（`POST /print/jobs`）→ `/print/progress` 轮询真实状态；无真实 Agent/打印机时**不得出现伪造「打印成功」**，只到任务落库 + 诚实状态。
必须截图（脱敏，去地址栏 token/签名 URL/手机号）：诊断报告、优化前后对比、四格式导出成功、`/me/documents` 四文件、PDF 打印确认页。证据存 `G3/`。

## 九、RW1-G4 隐私 / 合规 / 诚实抽样

- 刷新 / 返回不保留简历正文；`localStorage` / `sessionStorage` 不存简历内容（只最小 taskId+token）。
- 四格式渲染无承诺/越界词（保录用 / 内推 / 一键投递 / 平台投递 / 候选人筛选 / 面试邀约 / Offer）。
- 非 PDF 全程只「下载」，无「可打印 / 已打印」表述。
- 管理员访问会员文件留 `AuditLog`（脱敏）；签名 URL TTL ≤ 30min。
- 跨账号：会员 B 不能访问会员 A 的导出文件（403）。
证据存 `G4/`。

## 十、停止条件（任一命中即停并回滚判断）

- 部署源不含 Wave 1 / health 非 postgres / 必需 env unset。
- 任一格式导出失败或 provider 落回 mock。
- `payloadJson` 或日志出现简历原文。
- 出现伪造打印成功、或非 PDF 被标为可打印。
- 证据目录出现密钥 / 连接串 / token / cookie / 验证码 / 完整签名 URL / 真实用户文件。

## 十一、证据编号

| 证据 ID | 类型 | 内容 |
| --- | --- | --- |
| RW1-G0 | 本地静态门禁 | typecheck + 8 项 verify + diff-check 退出码摘要 |
| RW1-G1 | 预生产只读预检 | health、DEPLOY_SOURCE 含 Wave 1、env set/unset 摘要 |
| RW1-G2 | 后端真实 live | 真实 LLM 优化、四格式导出 200、签名 URL 200→403、FileObject/COS 脱敏抽样、原文不落库 |
| RW1-G3 | 会员浏览器 E2E | 登录→诊断→优化(专业/学历/目标岗位)→四格式导出→/me/documents→PDF 打印确认 截图 |
| RW1-G4 | 隐私/合规/诚实 | 存储无正文、无承诺词、非 PDF 只下载、审计脱敏、跨账号 403 |
| RW1-R1 | 回滚/清理 | 本轮测试 FileObject/AiResumeResult/COS/EndUser/Redis 清理证据 |

## 十二、完成口径

以上 RW1-G0~G4 全部 PASS 且证据齐备，才可记「Wave 1 预生产验收通过」。**即使全绿也不等于**正式生产、正式自有域名 HTTPS、真实短信上线 E2E、Windows 真机出纸或商用上线完成——这些仍按 `docs/device/production-deployment-and-windows-host-checklist.md` 单独验收。
