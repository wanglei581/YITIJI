# 用户中心 Wave 0 真值基线验收

> 验收日期：2026-07-16  
> 分支：`codex/user-center-wave0-truth-baseline`  
> 状态：本地候选通过；未 push、未 merge、未 deploy，未运行 GitHub CI

## 一、范围与结论

本轮只处理用户中心“页面表达必须等于真实能力”和“隐私工单状态必须等于真实执行结果”两条基线，不新增入口、数据模型、迁移或外部依赖。

- Profile 保留 22 个已接真目的地；删除重复“招聘会权益活动”，隐藏招聘会扫码凭证、求职打印套餐、AI 服务套餐。
- 登录页只展示手机号和扫码登录；既有扫码流程保持不变，不展示不可用邮箱登录。
- 账号设置保留真实的登录状态、协议、退出和切换账号能力；明确手机号换绑、账号注销、数据导出尚未开放。
- 真实导出/注销执行器上线前，`export→completed`、`delete→completed`、`delete→rejected` 均 fail closed；失败尝试保持工单 `pending`，不写完成/拒绝审计。`revoke_consent→completed` 继续允许。

实现提交：

- `320647c4`：先建立 Wave 0 页面真值失败守卫并接入 CI。
- `e93375f4`：删除重复和占位 Profile 入口。
- `bd211a1a`：删除不可用邮箱登录入口。
- `33a9c134`：对齐账号设置真值文案。
- `0f622e32`：收紧既有 Profile 商用守卫的本批精确白名单。
- `5f0b8629`：先复现隐私工单虚假完成/拒绝。
- `bf30fee0`：在真实执行器上线前 fail closed，并保留撤回同意的真实完成路径。

## 二、隐私工单状态矩阵

| 请求类型 | 尝试状态 | Wave 0 结果 | 数据与审计 |
|---|---|---|---|
| `export` | `completed` | 拒绝，`DATA_REQUEST_EXECUTION_INCOMPLETE` | 工单保持 `pending`；不写完成审计 |
| `delete` | `completed` | 拒绝，`DATA_REQUEST_EXECUTION_INCOMPLETE` | 工单保持 `pending`；不写完成审计 |
| `delete` | `rejected` | 拒绝，`DATA_REQUEST_EXECUTION_INCOMPLETE` | 工单保持 `pending`；不写拒绝审计 |
| `revoke_consent` | `completed` | 允许 | 按既有同步撤回路径完成并审计 |

## 三、自动化验证

| 验证面 | 命令 / 检查 | 结果 |
|---|---|---|
| Wave 0 页面真值 | `pnpm --filter @ai-job-print/kiosk verify:user-center-wave0` | PASS |
| 登录扫码回归 | `pnpm --filter @ai-job-print/kiosk verify:qr-login-ui` | PASS |
| Profile 回归 | `verify:profile-inkpaper-home`、`verify:lightflow-profile-entry`、`verify:lightflow-4188-layout-parity`、`verify:profile-commercial-first-batch`、`verify:member-session-closure` | PASS |
| 隐私工单真值 | `pnpm --filter @ai-job-print/api verify:member-data-request-truth` | SQLite / PostgreSQL 均 PASS |
| 既有隐私治理 | `pnpm --filter @ai-job-print/api verify:job-ai-privacy` | PASS |
| 类型检查 | Kiosk、API `typecheck` | PASS |
| 构建 | API、Kiosk production、Admin build | PASS；仅有既有 Vite chunk-size warning |
| schema 镜像 | `pnpm --filter @ai-job-print/api db:pg:sync:check` | PASS |

### SQLite 空库

- 使用仅属于本次验收的 `services/api/prisma/wave0-verify.db`，先确认目标不存在，再创建空文件并执行正式 `prisma migrate deploy`。
- 57 个 SQLite migration 全部成功。
- `verify:member-data-request-truth`、`verify:member-print-orders`、`verify:benefit-redemption` 全部通过。
- 验证完成后临时数据库文件已删除。

### PostgreSQL 空库

- 使用本机 PostgreSQL 16.14 的一次性空库 `ai_job_print_wave0_verify_20260716_1807`，未复用任何共享或生产数据库。
- 29 个 PostgreSQL migration 全部成功；PostgreSQL Prisma Client 生成成功。
- `verify:member-data-request-truth`、`verify:member-print-orders`、`verify:benefit-redemption` 全部通过。
- 验证完成后临时数据库已 drop，并复核不存在。

## 四、浏览器验收

本地 Kiosk production preview 通过 Playwright 验收；API 请求以空成功响应隔离，目的是只验证本轮页面表达和响应式布局，不将 mock 当作业务数据闭环证据。

| 视口 | 页面 | 验收结果 |
|---|---|---|
| 540×960 | `/profile` | 四个禁用/重复入口均不可见；“权益与政策”分组可见；无横向溢出；控制台 0 error / 0 warning |
| 540×960 | `/login` | 只有“手机号”“扫码登录”；扫码页既有三步说明可见；无邮箱入口 |
| 540×960 | `/me/settings` | 未开放能力说明可见；无“身份切换”文案；控制台 0 error / 0 warning |
| 1080×1920 | `/profile` | `scrollWidth=1080`，无横向溢出 |

## 五、明确边界

- 本轮未实现真实数据导出、账户注销执行器、手机号换绑、step-up 或 Admin 隐私工单运营页；这些属于 Wave 1/2。
- 未推送、合并、部署或运行 GitHub CI；未验证真实短信、线上 PostgreSQL/COS/Redis、Windows 一体机或打印。
- 未修改 Prisma schema、migration、生产配置、密钥、账号、订单或打印任务。
- Wave 1 必须另起独立分支；法务留存矩阵和不可逆注销开关未满足前，只能继续 fail closed。
