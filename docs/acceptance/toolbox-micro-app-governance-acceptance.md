# 百宝箱微应用审核发布真实验收执行包

> STATIC DOC CHECK ONLY
> 状态：Phase 2D 执行包与证据标准已定义，不代表预生产 migration、真实管理员异人审批、真实终端发布投影、熔断演练或首批微应用商用上线已经完成。
> 原始截图、命令日志、SQL 输出、浏览器 HAR、真实终端照片、服务器备份和管理员操作录屏必须保存在仓库外私有证据目录；证据不进 Git，Git 仓库只记录脱敏摘要和证据 ID。

## 一、验收目标

本执行包只覆盖百宝箱微应用平台 Phase 2B / Phase 2C 的真实验收：

- Admin 创建微应用、创建版本、提交审核、异人审批、驳回、发布和熔断。
- 允许域名提交、异人审核、激活、暂停、过期和归档。
- 发布 gate 对高风险免责声明、DB 审核表、环境白名单、外部 H5 开关、红线文案和禁止能力 fail-closed。
- 审核通过的版本投影为 `app:${appKey}` 并进入真实终端 `TerminalToolboxConfig.itemsJson`。
- Kiosk 真实终端展示已发布微应用，熔断后移除投影。
- Admin 终端投放配置页面对 `app:${appKey}` 治理投影项只读。

本执行包不证明：

- 第三方 JS / WASM / 任意外部 skill 包执行。
- 外部小程序或第三方网页的办理结果回传。
- 平台内一键投递、立即投递、平台投递。
- 企业端候选人筛选、面试邀约、Offer 管理或候选人推荐。
- 法律 / 合同 / 试卷 / 文件类微应用已经可商用上线。
- 生产环境已完成、试运营已完成或可对外宣传为正式商用。

## 二、证据目录

Mac 本地：

```bash
export EVIDENCE_ROOT="/tmp/ai-job-print-evidence/toolbox-governance-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{TMG-G0,TMG-G1,TMG-G2,TMG-G3,TMG-G4,TMG-G5}
printf '%s\n' "$EVIDENCE_ROOT"
```

预生产服务器：

```bash
export EVIDENCE_ROOT="/srv/ai-job-print-evidence/toolbox-governance-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{TMG-G1,TMG-G2,TMG-G3,TMG-G4,TMG-G5}
chmod 700 "$EVIDENCE_ROOT"
printf '%s\n' "$EVIDENCE_ROOT"
```

证据目录不得包含：

- `.env`、数据库连接串、Redis URL、COS 密钥、LLM 密钥、短信密钥。
- cookie、JWT、验证码、手机号、身份证号、真实简历正文、合同全文、法律争议原文。
- 完整外部 URL、query、token、签名 URL、第三方页面表单内容。
- PostgreSQL 整库备份文件；备份必须保存在服务器私有备份目录，证据只保存路径、sha256 和可读性日志。

## 三、TMG-G0 本地静态门禁

目标：证明候选代码具备审核发布 UI、后端治理工作流、双数据库 schema、文档边界和防回退门禁。

```bash
git branch --show-current | tee "$EVIDENCE_ROOT/TMG-G0/git-branch.log"
git rev-parse --short HEAD | tee "$EVIDENCE_ROOT/TMG-G0/git-head.log"
git status --short --branch | tee "$EVIDENCE_ROOT/TMG-G0/git-status.log"

pnpm --filter @ai-job-print/shared typecheck 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/shared-typecheck.log"
pnpm --filter @ai-job-print/api typecheck 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/api-typecheck.log"
pnpm --filter @ai-job-print/admin typecheck 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/admin-typecheck.log"
pnpm --filter @ai-job-print/admin build 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/admin-build.log"

pnpm --filter @ai-job-print/api verify:toolbox-micro-app-platform 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/verify-toolbox-micro-app-platform.log"
pnpm --filter @ai-job-print/api verify:toolbox-review-workflow 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/verify-toolbox-review-workflow.log"
pnpm --filter @ai-job-print/admin verify:toolbox-review-ui 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/verify-toolbox-review-ui.log"
pnpm --filter @ai-job-print/api verify:toolbox-governance-acceptance 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/verify-toolbox-governance-acceptance.log"
pnpm --filter @ai-job-print/api db:pg:sync:check 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/pg-sync-check.log"

git diff --check 2>&1 | tee "$EVIDENCE_ROOT/TMG-G0/git-diff-check.log"
```

通过标准：

- 所有命令退出码为 0。
- `verify:toolbox-review-workflow` 检查 `ToolboxApp`、`ToolboxAppVersion`、`ToolboxAllowedHost`、AuditLog、发布 gate、投影和 `app:` 保留逻辑。
- `verify:toolbox-review-ui` 检查 Admin UI、blocked reason、双白名单、安全文案和治理投影只读。
- `git status` 如存在与本验收无关的脏文件，必须在执行记录中标注“不纳入本轮候选”。

## 四、TMG-G1 预生产只读预检

目标：确认当前预生产部署来源、PostgreSQL health、Admin / Kiosk 静态入口和 API 路由可达。此阶段不得写数据库。

```bash
cd <PREPROD_ROOT>/current

test -f DEPLOY_SOURCE.txt && sed -n '1,120p' DEPLOY_SOURCE.txt | tee "$EVIDENCE_ROOT/TMG-G1/deploy-source.log"

curl -fsS "http://127.0.0.1:<API_LOCAL_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/TMG-G1/api-health-local.log"

curl -fsS "http://<PREPROD_PUBLIC_HOST>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/TMG-G1/api-health-public.log"

curl -I "http://<PREPROD_PUBLIC_HOST>/admin" \
  2>&1 | tee "$EVIDENCE_ROOT/TMG-G1/admin-head.log"

curl -I "http://<PREPROD_PUBLIC_HOST>/" \
  2>&1 | tee "$EVIDENCE_ROOT/TMG-G1/kiosk-head.log"
```

通过标准：

- health 成功且数据库为 PostgreSQL。
- 部署来源明确指向包含 Phase 2B / 2C 的候选代码。
- Admin 与 Kiosk 静态入口可达。
- 未输出密钥、连接串、cookie、token 或完整第三方 URL。
- 若部署来源不是本次候选，只能停止在只读预检，不得执行 TMG-G2。

## 五、TMG-G2 PostgreSQL migration 与环境白名单复核

目标：执行 additive migration，并复核微应用外部入口需要的环境白名单。

执行前必须满足：

- 用户明确同意执行预生产 migration。
- 已完成 PostgreSQL 备份。
- 当前候选包含 `20260702002000_add_toolbox_governance` SQLite / PostgreSQL 双迁移。
- 备份不进入 Git，也不放在证据目录。

```bash
cd <PREPROD_ROOT>/current
test -n "$DATABASE_URL" || { echo "DATABASE_URL missing"; exit 1; }

export DB_BACKUP_DIR="/srv/ai-job-print-db-backups"
mkdir -p "$DB_BACKUP_DIR"
chmod 700 "$DB_BACKUP_DIR"
export DB_BACKUP_PATH="$DB_BACKUP_DIR/pre-toolbox-governance-$(date +%Y%m%d%H%M%S).dump"

pg_dump --format=custom --file="$DB_BACKUP_PATH" "$DATABASE_URL"
sha256sum "$DB_BACKUP_PATH" | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-01-backup-sha256.log"
printf 'backup_path=%s\n' "$DB_BACKUP_PATH" | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-01-backup-path.log"
pg_restore -l "$DB_BACKUP_PATH" 2>&1 | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-01-backup-readable.log"

pnpm --filter @ai-job-print/api db:pg:deploy 2>&1 | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-02-migrate-deploy.log"
pnpm --filter @ai-job-print/api db:pg:sync:check 2>&1 | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-03-pg-sync-check.log"
```

环境变量脱敏复核：

```bash
node - <<'NODE' | tee "$EVIDENCE_ROOT/TMG-G2/TMG-G2-04-env-redacted.log"
const keys = [
  'TOOLBOX_ALLOW_EXTERNAL_URL',
  'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
  'KIOSK_QR_TARGET_ALLOWED_HOSTS',
  'NODE_ENV',
]
for (const key of keys) {
  const value = process.env[key] || ''
  const state = value ? 'set' : 'unset'
  const entries = value.includes(',') ? value.split(',').filter(Boolean).length : (value ? 1 : 0)
  console.log(`${key}=${state}${entries ? ` entries=${entries}` : ''}`)
}
NODE
```

通过标准：

- 备份可读，sha256 已记录。
- migration 成功或目标库已 up to date。
- `db:pg:sync:check` 通过。
- 如果本轮要发布外部 H5，`TOOLBOX_ALLOW_EXTERNAL_URL=true` 且 `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` 已配置。
- 如果本轮要发布二维码目标 URL，`KIOSK_QR_TARGET_ALLOWED_HOSTS` 已配置对应 host 或明确复用外部 H5 白名单。
- 不输出完整 env 值、连接串或密钥。

## 六、TMG-G3 管理员异人审批与域名审核

目标：用两个真实 Admin 账号证明提交人与审核人不同，且自审批 fail-closed。

建议准备：

- Admin A：提交人。
- Admin B：审核人。
- 低风险 AI 技能候选：`salary-negotiation` 或 `hr-qa`。
- 外部 H5 候选：只使用预先批准的测试 host。

执行步骤：

1. Admin A 登录 Admin `/toolbox`。
2. 创建应用：`salary-negotiation`，风险等级 `low`，分类 `career`。
3. 创建版本：入口类型 `ai_skill`，assistant intent 使用 `salary_negotiation`，填写免责声明。
4. Admin A 提交审核。
5. Admin A 尝试审核自己提交的版本，必须失败，记录错误码 `TOOLBOX_SELF_REVIEW_FORBIDDEN` 或等价自审批阻断。
6. Admin B 登录，通过该版本审核。
7. 对一个外部 H5 host 执行域名提交：Admin A upsert 后应为 `pending_review`。
8. Admin A 尝试激活自己提交的 host，必须失败。
9. Admin B 激活 host，状态变为 `active`。
10. 额外提交一个未进入环境白名单的 host，保留为后续发布阻断用例。

必须记录的脱敏证据：

- Admin A / Admin B 操作截图，用户名只保留角色，不保留真实手机号或 token。
- API 响应摘要：只记录 `appKey`、`version`、`status`、`host`、`purpose`、错误码。
- AuditLog 摘要：只确认 `toolbox_version.submit`、`toolbox_version.approve`、`toolbox_allowed_host.upsert`、`toolbox_allowed_host.review` 存在。

通过标准：

- 自审批被拒绝。
- 异人审批成功。
- host 自审批被拒绝。
- host 异人审核成功。
- AuditLog 不包含合同、简历、法律争议、完整 URL、cookie、token 或第三方办理结果。

## 七、TMG-G4 发布投影、Kiosk 展示与熔断移除

目标：证明审核通过的版本能发布到真实终端，Kiosk 可见；熔断后投影移除。

执行步骤：

1. 选择一个启用的真实终端。
2. Admin B 发布已审核版本；如果指定终端，`terminalIds` 必须是真实终端 ID 或 terminalCode。
3. 查询 Admin 终端投放配置，确认出现 `app:${appKey}` 投影项，并显示治理发布只读标识。
4. 在真实 Kiosk 刷新首页，确认百宝箱展示该微应用。
5. 点击 AI 技能类微应用，应进入站内 Assistant intent，不出现第三方离场弹窗；若该 intent 处理器尚未接线，允许回退到通用 `/assistant` 并在执行记录中标注为“接线准备待完成”。
6. 若测试外部 H5 类微应用，必须先展示第三方服务离场确认。
7. Admin B 执行熔断。
8. 查询终端配置，确认 `app:${appKey}` 被移除。
9. Kiosk 刷新后，该微应用不再展示。

数据库脱敏抽样：

```sql
select "terminalId", "enabled", "itemsJson"
from "TerminalToolboxConfig"
where "terminalId" = '<TERMINAL_CODE>';
```

抽样处理要求：

- `itemsJson` 截图或日志中只保留 item key、title、launchMode、placements。
- 外部 URL 只保留 host；不得保留 query、token、签名参数。

通过标准：

- 发布返回 `status=published` 和 `projectionKey=app:${appKey}`。
- 终端配置包含 `app:${appKey}`。
- Admin UI 不能编辑或删除该 `app:` 投影项。
- 熔断返回 `status=suspended`，终端配置不再包含对应 `app:${appKey}`。
- Kiosk 展示与熔断结果一致。

## 八、TMG-G5 首批低风险微应用接线准备

目标：只验证低风险 AI 技能进入“可接线候选”状态，不验证法律、合同、试卷和版权高风险应用。

优先候选：

- `salary-negotiation`：薪资谈判话术。
- `hr-qa`：HR 知识问答。
- `offer-compare`：Offer 对比。

准备标准：

- 均走 `ai_skill` 或站内路由，不开放第三方 JS / WASM。
- 不上传合同、简历原文或高敏文件到第三方微应用。
- 必须保留免责声明：结果仅供个人参考，不构成录用、涨薪、法律意见或官方政策承诺。
- Assistant intent 需要可回退到现有 `/assistant`，不新增重复入口。
- Kiosk 入口文案不得出现平台内一键投递、立即投递、平台投递、候选人筛选、面试邀约或 Offer 管理。

不允许作为首批低风险上线：

- `contract-review`：必须先完成合同文件留存、隐私删除、法务评审。
- `legal-risk-check`：必须先完成法律责任边界和法务评审。
- `exam-paper-print`：必须先完成版权、授权材料来源和真机打印验收。
- `ielts-practice` 或英语模拟练习：必须确认品牌 / 商标 / 题库版权和合作授权。

## 九、停止条件

出现任一情况必须停止：

- 自审批成功。
- 未审核版本发布成功。
- 高风险 / 受限应用缺免责声明仍发布成功。
- 白名单外 host 发布成功。
- `app:${appKey}` 可以在终端配置页被手工删除或改写。
- 熔断后 Kiosk 仍展示该微应用。
- AuditLog、ToolboxLaunchEvent 或证据目录出现完整外部 URL、token、cookie、手机号、身份证号、简历正文、合同全文或第三方办理结果。
- 出现平台内一键投递、立即投递、平台投递、候选人筛选、面试邀约、Offer 管理、候选人推荐给企业等招聘闭环文案或能力。

## 十、回滚标准

如果 TMG-G3 / TMG-G4 执行失败：

- 先熔断测试应用，确保终端配置移除对应 `app:${appKey}`。
- 将测试 host review 为 `suspended` 或 `archived`。
- 如 migration 后业务异常，按预生产备份恢复流程执行，不在 Git 文档中保存备份文件。
- 更新执行记录，明确失败 gate、错误码、回滚动作和剩余风险。

## 十一、完成口径

只有 TMG-G0 至 TMG-G5 均通过，且证据记录完成，才可以在执行记录中填写：

- “TMG-G0~TMG-G5 证据齐备，微应用审核发布预生产链路已按本执行包完成脱敏记录。”

仍不得在对外材料或进度文档中写：

- “百宝箱微应用平台已生产上线”。
- “第三方小程序 / skill 包已商用上线”。
- “法律、合同、试卷类微应用已经可对外使用”。
- “平台具备投递、筛选、面试、Offer 或候选人推荐能力”。
