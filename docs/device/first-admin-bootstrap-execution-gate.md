# 生产首个管理员 bootstrap 执行授权门禁

> 状态：**NO-GO（2026-08-07）**。本文档只定义授权要素、执行步骤与验收证据，**本身不是授权**。
> 适用范围：`services/api/scripts/bootstrap-first-admin.ts`（PR #510，已合入 `main@19f7e715`）。

## 1. 授权要素

只有下列要素**全部**满足，才可进入执行窗口；缺任意一项即保持 **NO-GO**，不运行 CLI：

1. **具名生产授权**：业主负责人明确授权“在生产 PostgreSQL 空库运行首个管理员 bootstrap”，并给出本次窗口。
2. **受控执行环境**：受控 Linux 账户 + 生产数据库凭据；`DATABASE_URL` 指向生产 PostgreSQL，非本地/预生产。
3. **双人审批**：执行人（operator）与独立核对人（verifier）各自完成只读核对并分别记录，AI 技术核对不构成审批。
4. **精确确认短语**：`FIRST_ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_PRODUCTION_ADMIN`（仅防误操作，不是身份认证）。
5. **10 分钟窗口**：`FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL` 为 RFC3339 时间，且距执行时刻 >0 且 ≤10 分钟；以生产主机 NTP 时间为准。

## 2. 执行前只读核对（证据清单）

逐项核对并记录（仓库外证据文件，不含任何密钥）：

- [ ] `productionF1` 状态：须有明确 GO 结论与证据（当前仍为 **NO-GO**）。
- [ ] 生产确为空库：只读查询 `User` 表 count = 0（含软删语义核对，若有）。
- [ ] 目标主机 NTP 已同步；`date -u` 与授权窗口一致。
- [ ] 凭据目录所在磁盘已静态加密，且不会被未加密备份、日志采集或制品归档收集。
- [ ] 执行账户为受控 Linux 账户；记录 `id`、`whoami`、仓库 checkout HEAD（须为审定的 main SHA）。
- [ ] 凭据父目录：`install -d -m 700 /root/ai-job-print-bootstrap`，属主为当前用户，group/other 无任何权限。
- [ ] 环境变量注入方式不写入 shell 历史、聊天、仓库或日志（受控 env 文件/会话）。

## 3. 执行步骤

```bash
# 先建立仅当前 Linux 用户可访问的仓库外目录
install -d -m 700 /root/ai-job-print-bootstrap

# NODE_ENV / DATABASE_URL 从受控生产环境读取，不把数据库口令写入命令历史
export FIRST_ADMIN_BOOTSTRAP_CONFIRM=CREATE_FIRST_PRODUCTION_ADMIN
export FIRST_ADMIN_BOOTSTRAP_AUTHORIZED_UNTIL='<未来10分钟内的RFC3339时间>'
export FIRST_ADMIN_USERNAME='<首个管理员账号>'
export FIRST_ADMIN_NAME='<管理员显示名>'
export FIRST_ADMIN_CREDENTIALS_OUT=/root/ai-job-print-bootstrap/first-admin.json
pnpm --filter @ai-job-print/api bootstrap:first-admin
```

预期成功输出（stdout 不含密码）：

```json
{
  "ok": true,
  "userId": "...",
  "username": "...",
  "credentialsPath": "/root/ai-job-print-bootstrap/first-admin.json"
}
```

预期失败码及处理：

| 失败码                                                                | 含义 / 处理                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `FIRST_ADMIN_BOOTSTRAP_ENV_FORBIDDEN`                                 | `NODE_ENV` 非 production；停止，不重跑。                    |
| `FIRST_ADMIN_BOOTSTRAP_POSTGRES_REQUIRED`                             | `DATABASE_URL` 非 PostgreSQL；停止。                        |
| `FIRST_ADMIN_BOOTSTRAP_CONFIRMATION_REQUIRED`                         | 确认短语缺失/错误；停止。                                   |
| `FIRST_ADMIN_BOOTSTRAP_WINDOW_INVALID`                                | 窗口过期或超过 10 分钟；重新申请窗口。                      |
| `FIRST_ADMIN_USERNAME_INVALID` / `FIRST_ADMIN_NAME_INVALID`           | 参数不合法；修正后重新申请窗口。                            |
| `FIRST_ADMIN_CREDENTIALS_PARENT_*` / `FIRST_ADMIN_CREDENTIALS_PATH_*` | 凭据目录不安全；修正后重新申请窗口。                        |
| `FIRST_ADMIN_BOOTSTRAP_NOT_EMPTY`                                     | 库非空；停止并人工核对，不得覆盖。                          |
| `FIRST_ADMIN_BOOTSTRAP_CONFLICT`                                      | 并发冲突（P2034 / 40001）；核对 `User` 与审计后决定。       |
| `FIRST_ADMIN_BOOTSTRAP_RECONCILIATION_REQUIRED`                       | 提交状态不确定；**先只读核对，不得重跑或删凭据**（见 §5）。 |

## 4. 首次登录与改密

1. 通过 HTTPS 管理后台用初始密码登录；temporary admin **不签发管理 JWT**，只签发 10 分钟 Redis 单次改密 ticket。
2. 设置新密码：至少 12 位，且至少命中大写、小写、数字、特殊字符中的 3 类；UTF-8 字节数 ≤ 72。
3. 改密后核对：`passwordProofState=owner_managed`、`tokenVersion` 已递增、`auth.first_admin_bootstrap.password_changed` 审计存在。
4. 用新密码重新登录成功，且旧初始密码已失效。
5. 全部通过后，删除 0600 初始凭据文件，并记录删除证据。

## 5. 三态 reconciliation

CLI 返回 `FIRST_ADMIN_BOOTSTRAP_RECONCILIATION_REQUIRED` 时，只读核对 `User` 与 `auth.first_admin_bootstrap.created` 审计：

- `User=1` 且存在匹配审计：数据库可能已提交，保留凭据文件，继续首次改密流程。
- `User=0` 且无匹配审计：数据库未提交，人工删除 0600 凭据文件后重新申请执行窗口。
- 其他组合：状态不一致，保持 **NO-GO**，备份并人工审查；不得用 seed 或直接 SQL 补写。

## 6. 验收证据（仓库外，脱敏）

- 授权窗口 RFC3339、执行人/核对人标识、main SHA、生产只读核对输出摘要。
- CLI stdout 摘要、`User` count 前后值、两条审计动作及时间、改密完成时间、凭据文件删除证明。
- 失败场景下保留原始错误与 reconciliation 核对结论；不把聊天记录当正式证据。

## 7. 禁止项

- 未获 §1 全部授权要素前不运行 CLI；AI 或聊天确认不等于生产授权。
- 凭据不得进入仓库、聊天、日志、截图或制品；初始密码不写入 stdout。
- 不因失败立即重跑；不删除 `RECONCILIATION_REQUIRED` 状态下的凭据文件。
- 不得用 demo seed、直接 SQL 或第三方工具补建首个管理员。
- 代码合入授权（PR #510/#516 的 `[skip ci]` 合并）与生产执行授权互不等同。
