# 百宝箱预生产验收执行包

> STATIC DOC CHECK ONLY
> 状态：执行清单与证据标准已定义，不代表预生产 migration、真实终端配置、Kiosk 操作或 Admin 统计抽样已经完成。
> 原始截图、命令日志、SQL 输出、浏览器 HAR、真实终端照片和服务器备份必须保存在仓库外私有证据目录；证据不进 Git，Git 仓库只记录脱敏摘要和证据 ID。

## 一、验收边界

本执行包只覆盖百宝箱 / 智慧校园应用上架、外部 H5 / 二维码启动安全提示、匿名使用事件和 Admin 基础统计。

允许证明的能力：

- Admin 按真实终端配置站内功能、外部 H5、二维码、小程序码和投放位置。
- Kiosk 从统一终端配置读取百宝箱 / 智慧校园上架项。
- 外部 H5 先展示第三方服务离场确认，再由用户选择是否继续。
- 二维码 / 小程序码展示运营方声明目标或服务说明。
- 匿名事件只记录 `show_qr`、`open_external_notice`、`open_external_confirmed`、`cancel_external` 等一体机交互动作。
- Admin 只看最近 7 天匿名聚合统计和 Top 功能项。

禁止证明或暗示的能力：

- 第三方页面办理结果回传。
- 第三方登录状态、验证码、账号、身份证号或支付信息采集。
- 完整外部 URL、query、token、签名参数或 Cookie 留存。
- 平台内一键投递、立即投递、平台投递。
- 候选人筛选、面试邀约、Offer 管理或向企业推荐候选人。
- 外部 skill / 小程序运行沙箱、插件市场、自动化执行第三方业务。

## 二、执行原则

- 先完成本地静态门禁，再执行服务器只读预检。
- 预生产执行前必须先做 PostgreSQL 备份；备份只保存在服务器私有目录，不进入 Git。
- 只有用户明确确认后，才能执行 `prisma migrate deploy`、修改预生产 env、配置真实终端或打开公网 Kiosk。
- 所有证据必须脱敏；不得保存 token、cookie、完整 URL、手机号、身份证号、验证码、数据库连接串或密钥。
- 验收统计只代表匿名交互近似值，不代表真实扫码完成、第三方办理成功或商业转化完成。

## 三、证据目录

Mac 本地：

```bash
export EVIDENCE_ROOT="/tmp/ai-job-print-evidence/toolbox-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{TB-G0,TB-G1,TB-G2,TB-G3,TB-G4}
printf '%s\n' "$EVIDENCE_ROOT"
```

服务器：

```bash
export EVIDENCE_ROOT="/srv/ai-job-print-evidence/toolbox-$(date +%Y%m%d%H%M%S)"
mkdir -p "$EVIDENCE_ROOT"/{TB-G1,TB-G2,TB-G3,TB-G4}
chmod 700 "$EVIDENCE_ROOT"
printf '%s\n' "$EVIDENCE_ROOT"
```

证据目录不得包含：

- `.env`、密钥备份、数据库连接串。
- 截图里的完整签名 URL、完整外部 URL、手机号、验证码、cookie、JWT。
- 真实用户上传文件、简历正文、第三方页面表单内容。

## 四、TB-G0 本地静态门禁

目标：证明当前候选代码、双数据库 schema、Kiosk / Admin 接线和防回退验证可复跑。

```bash
git branch --show-current | tee "$EVIDENCE_ROOT/TB-G0/git-branch.log"
git rev-parse --short HEAD | tee "$EVIDENCE_ROOT/TB-G0/git-head.log"
git status --short --branch | tee "$EVIDENCE_ROOT/TB-G0/git-status.log"

pnpm --filter @ai-job-print/shared typecheck 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/shared-typecheck.log"
pnpm --filter @ai-job-print/api typecheck 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/api-typecheck.log"
pnpm --filter @ai-job-print/api verify:toolbox-launch-events 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/verify-toolbox-launch-events.log"
pnpm --filter @ai-job-print/api verify:toolbox-preprod-acceptance 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/verify-toolbox-preprod-acceptance.log"
pnpm --filter @ai-job-print/api verify:terminal-device-config 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/verify-terminal-device-config.log"
pnpm --filter @ai-job-print/api db:pg:sync:check 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/pg-sync-check.log"
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/verify-home-toolbox-ui.log"
pnpm --filter @ai-job-print/kiosk typecheck 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/kiosk-typecheck.log"
pnpm --filter @ai-job-print/admin typecheck 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/admin-typecheck.log"
git diff --check 2>&1 | tee "$EVIDENCE_ROOT/TB-G0/git-diff-check.log"
```

通过标准：

- 所有命令退出码为 0。
- `verify:toolbox-launch-events` 输出匿名事件 DTO 不接收 URL / host、targetHost 服务端派生、Admin 统计接线和 Kiosk `sendBeacon` PASS。
- `verify:terminal-device-config` 输出 Admin 读取保留待修复项、public 读取隐藏非法项、外部域名白名单漂移不打挂整份配置。
- `git status` 中如存在与本验收无关的脏文件，必须在摘要中标注“未纳入本轮验收候选”。

## 五、TB-G1 预生产只读预检

目标：确认预生产运行环境具备 PostgreSQL、API health、Kiosk / Admin 静态入口和当前部署来源信息。此阶段不得写数据库。

```bash
cd <PREPROD_ROOT>/current

node -v 2>&1 | tee "$EVIDENCE_ROOT/TB-G1/node-version.log"
pnpm -v 2>&1 | tee "$EVIDENCE_ROOT/TB-G1/pnpm-version.log"
test -f DEPLOY_SOURCE.txt && sed -n '1,80p' DEPLOY_SOURCE.txt | tee "$EVIDENCE_ROOT/TB-G1/deploy-source.log"

curl -fsS "http://127.0.0.1:<API_LOCAL_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G1/api-health-local.log"

curl -fsS "http://<PREPROD_PUBLIC_HOST>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G1/api-health-public.log"

curl -I "http://<PREPROD_PUBLIC_HOST>/admin" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G1/admin-head.log"

curl -I "http://<PREPROD_PUBLIC_HOST>/" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G1/kiosk-head.log"
```

通过标准：

- health 返回成功且数据库为 PostgreSQL。
- Kiosk / Admin 入口可达。
- 日志不包含连接串、token、cookie、密钥或完整外部 URL。
- 如果部署源不是本次候选，只能停止在只读预检，不得继续执行 migration。

## 六、TB-G2 PostgreSQL migration 与环境变量复核

目标：执行 additive migration，并复核百宝箱外部应用白名单环境变量。

执行前必须确认：

- 用户明确同意执行预生产 migration。
- 已完成 PostgreSQL 备份。
- 当前候选代码包含 `20260701123000_add_toolbox_launch_events` 双迁移。
- 整库备份不得写入证据目录；必须写入服务器私有备份目录，证据目录只保存备份路径、sha256 和 `pg_restore -l` 可读性日志。

```bash
cd <PREPROD_ROOT>/current

test -n "$DATABASE_URL" || { echo "DATABASE_URL missing"; exit 1; }

export DB_BACKUP_DIR="/srv/ai-job-print-db-backups"
mkdir -p "$DB_BACKUP_DIR"
chmod 700 "$DB_BACKUP_DIR"
export DB_BACKUP_PATH="$DB_BACKUP_DIR/pre-toolbox-$(date +%Y%m%d%H%M%S).dump"

pg_dump --format=custom --file="$DB_BACKUP_PATH" "$DATABASE_URL"
sha256sum "$DB_BACKUP_PATH" | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-01-backup-sha256.log"
printf 'backup_path=%s\n' "$DB_BACKUP_PATH" | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-01-backup-path.log"
pg_restore -l "$DB_BACKUP_PATH" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-01-backup-readable.log"

pnpm --filter @ai-job-print/api db:pg:deploy \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-02-migrate-deploy.log"

pnpm --filter @ai-job-print/api db:pg:sync:check \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-03-pg-sync-check.log"

curl -fsS "http://127.0.0.1:<API_LOCAL_PORT>/api/v1/health" \
  2>&1 | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-04-api-health-after-migration.log"
```

环境变量脱敏复核：

```bash
node - <<'NODE' | tee "$EVIDENCE_ROOT/TB-G2/TB-G2-05-env-redacted.log"
const keys = [
  'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
  'KIOSK_QR_TARGET_ALLOWED_HOSTS',
  'NODE_ENV',
  'FILE_STORAGE_DRIVER',
]
for (const key of keys) {
  const value = process.env[key] || ''
  const state = value ? 'set' : 'unset'
  const count = value ? value.split(',').filter(Boolean).length : 0
  console.log(`${key}=${state}${count ? ` entries=${count}` : ''}`)
}
NODE
```

通过标准：

- PostgreSQL 备份可读。
- migration 成功或目标库已 up to date。
- `db:pg:sync:check` 通过。
- `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` 至少包含本轮外部 H5 域名。
- `KIOSK_QR_TARGET_ALLOWED_HOSTS` 如配置二维码目标地址，必须包含本轮二维码目标域名；未配置时明确记录回退使用外部 H5 白名单。
- 不输出完整 env 值、数据库 URL、Redis URL 或密钥。

## 七、TB-G3 Admin 真实终端配置验收

目标：通过 Admin 给真实终端配置 1-2 个站内功能、1 个白名单外部 H5、1 个二维码或小程序码项，并确认非法配置被拒绝。

执行方式：

1. 登录 Admin。
2. 打开“百宝箱 / 智慧校园上架”页面。
3. 选择真实终端。
4. 保存以下功能项：
   - 站内功能：`/resume/source` 或当前已上线站内路径。
   - 外部 H5：使用已加入 `KIOSK_EXTERNAL_APP_ALLOWED_HOSTS` 的 HTTPS 域名。
   - 二维码：二维码图片地址使用站内资源或白名单 HTTPS 地址；二维码目标地址只填白名单 HTTPS 域名。
   - 小程序码：目标说明只填 AppID、页面路径或服务名称，不填协议式 URL。
5. 额外尝试保存一个未加入白名单的外部 H5，确认后端拒绝。

必须记录的脱敏证据：

- Admin 页面截图：终端编号可保留，外部 URL 只保留 host，query 必须打码。
- 保存成功的响应摘要：只记录 `terminalId`、`enabled`、item key、launchMode、placements。
- 保存失败的错误码：例如 `TOOLBOX_EXTERNAL_HOST_NOT_ALLOWED`，不得记录完整失败 URL。
- AuditLog 摘要：只确认 `toolbox_config.update` 存在，不保存完整 payload。

通过标准：

- 有功能项时 Kiosk 下发配置包含对应 item。
- 白名单外部 H5 / 二维码目标可保存。
- 未白名单域名被后端拒绝。
- AuditLog 只保留 before / after 摘要，不记录完整 URL 或 query。

## 八、TB-G4 Kiosk 真实终端交互与 Admin 统计抽样

目标：在真实 Kiosk 上验证展示、离场确认、二维码提示和匿名统计增长。

Kiosk 流程：

1. 打开 Kiosk 首页，确认百宝箱在智慧校园前展示。
2. 空配置时保留“待配置”占位；有配置后展示功能卡片。
3. 点击站内功能，进入站内页面，不产生第三方离场弹窗。
4. 点击外部 H5 功能，先展示“即将进入第三方服务”弹窗。
5. 点击“返回首页”，Admin 统计中的外部取消数应增加。
6. 再次点击外部 H5 功能并点击“继续打开”，记录确认打开事件；如真实环境不允许离开 Kiosk，可在完成记录后由运维返回首页。
7. 点击二维码或小程序码功能，弹窗展示二维码图片和运营方声明目标 / 服务说明。
8. Admin 百宝箱页刷新，确认最近 7 天总事件、外部确认打开、二维码展示数、外部取消数和 Top 功能项增长。

数据库脱敏抽样模板：

```sql
select "terminalId", "itemKey", "launchMode", "action", "placement",
       case when "targetHost" is null then 'none' else "targetHost" end as target_host,
       count(*) as count
from "ToolboxLaunchEvent"
where "createdAt" >= now() - interval '1 day'
  and "terminalId" = '<TERMINAL_CODE>'
group by "terminalId", "itemKey", "launchMode", "action", "placement", "targetHost"
order by count desc;
```

通过标准：

- `targetHost` 只出现纯主机名，不出现 `http://`、`https://`、`/`、`?`、`=`、`&`、token 或 query。
- `action` 仅包含 `show_qr`、`open_external_notice`、`open_external_confirmed`、`cancel_external`。
- 未上架、禁用或未知 item 不入库。
- Admin 统计数字和数据库抽样方向一致。
- 统计口径写成“二维码展示数”，不得写成真实扫码完成数。

## 九、停止条件

出现任一情况必须停止验收：

- Kiosk 或 Admin 出现“一键投递”“立即投递”“平台投递”等禁止文案。
- 事件表出现 `endUserId`、手机号、身份证号、完整外部 URL、query、token、cookie 或第三方办理结果。
- `targetHost` 出现 scheme、path、query 或非主机名字符。
- 白名单外部域名被保存成功。
- 未知终端或停用终端仍能写入事件。
- Admin 统计接口未鉴权即可访问。
- Kiosk 直接点击卡片就跳出外部 H5，没有离场确认。
- `sendBeacon` / keepalive 失败导致确认打开事件完全无法记录，且没有明确降级说明。
- PostgreSQL migration 失败、health 异常或 `db:pg:sync:check` 不通过。
- 证据目录出现密钥、连接串、token、cookie、验证码、完整签名 URL 或真实用户文件。

## 十、证据编号

| 证据 ID | 类型 | 内容 |
| --- | --- | --- |
| TB-G0 | 本地静态门禁 | typecheck、verify、schema sync、diff check |
| TB-G1 | 预生产只读预检 | health、部署源、Kiosk / Admin 可达性 |
| TB-G2 | 数据库与环境 | PostgreSQL 备份、migration、白名单 env 脱敏摘要 |
| TB-G3 | Admin 配置 | 真实终端配置、保存成功/失败、AuditLog 摘要 |
| TB-G4 | Kiosk 交互 | 站内、外部 H5、二维码、小程序码、统计增长 |
| TB-R1 | 回滚证据 | 备份路径、配置回滚、health 复核 |

## 十一、回滚标准

如果 TB-G2 migration 后发现 API health 异常：

- 立即停止 Kiosk / Admin 继续验收。
- 保留 migration 日志和 health 日志。
- 使用 TB-G2 前备份恢复到新的隔离库或按运维策略回滚。
- 复核 health 后再决定是否重试；不得在失败状态下继续做真实终端操作。

如果 TB-G3 / TB-G4 配置错误：

- Admin 将目标终端百宝箱配置关闭或删除错误功能项。
- 清空或更正白名单环境变量后重启 API。
- 用 Kiosk 刷新确认功能项隐藏或修正。
- Admin 统计历史事件不物理删除，除非确认是测试污染且有备份；删除前必须记录 SQL 和审批。

## 十二、结论模板

```text
百宝箱预生产验收：未执行 / 已执行未通过 / 已执行待复验 / 已执行通过
执行环境：
部署 commit：
证据目录：
已通过 Gate：
未通过 Gate：
停止条件是否触发：
是否执行 PostgreSQL migration：
是否配置真实终端：
是否完成 Kiosk 真实交互：
是否完成 Admin 统计抽样：
残余风险：
结论：不得在 TB-G2~TB-G4 均通过前宣称百宝箱生产/预生产验收完成。
```
