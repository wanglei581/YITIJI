# 生产证据只读采集脚本

给产品负责人在生产服务器上跑一次，把上线清单里「必须 SSH / 生产 `.env` / PM2 / nginx / COS / 密钥才能确认」的 **B 类 59 条**收成可贴工单的文本。

仓库里没有 `docs/device/production-checklist-triage-2026-09.md`。这 59 条是按
`docs/device/production-deployment-and-windows-host-checklist.md` 筛的：凡是要登录服务器或读生产密钥才能证的，都覆盖；C 类（控制台截图、当面付真机、回滚演练、内容导入）脚本证不了，不装成能证。

对应脚本：`scripts/collect-production-evidence.sh`

## 怎么跑

在生产机（检出一般在 `/root/YITIJI`，运行目录 `/srv/ai-job-print`）：

```bash
bash /root/YITIJI/scripts/collect-production-evidence.sh
```

或把脚本单独拷上去再跑。stdout 整段贴进工单即可。

可选参数：`--runtime-dir` `--source-dir` `--env-file` `--pm2-app` `--api-port`。

依赖：`bash`。有 `python3`（或 `python`）才能安全解析 `.env` / `pm2 jlist` / health JSON；没有就把相关项打成 UNKNOWN，**不会退回去 `cat .env` 或打印 `pm2 env`**。`jq` 不用。

## 只读

脚本开头注释列了会执行的命令类别。除 `/tmp/collect-prod-evidence.*` 外不写任何路径，结束删掉临时目录。

不会：`pm2 restart`、`systemctl`、`nginx -s`、改 `.env`、装包、删业务文件、把密钥值打到终端。

`.env` 只做 `grep -c '^KEY='` 判断键是否存在；长度 / 样值前缀 / `DATABASE_URL` scheme 由 python 在内存里算，只打印「已配置 / 未配置 / 长度 N」。`NODE_ENV` 和 `PAYMENT_PROVIDER` 按任务要求打印取值。其它非密钥开关（`FILE_STORAGE_DRIVER`、`SMS_PROVIDER` 等）为了能判定门禁，也打印取值。

`pm2 jlist` 的 JSON 含全部环境变量，只经管道交给 python 抽允许字段，不落盘、不原样打印。

## 每项格式

```text
[Bxx 项目] 判定(OK/NG/UNKNOWN) 证据(实际读到的东西)
```

- **OK**：命令退出码成功，且对得上清单硬条件。
- **NG**：读到了，但明确不满足（例如 `NODE_ENV` 不是 production、5432 对公网、密钥过短）。
- **UNKNOWN**：工具没有、文件不可读、库连不上。不猜。

判定看退出码（以及 `curl` 的 HTTP 状态码、`openssl x509 -checkend` 退出码、`psql` 退出码），不靠日志正文里有没有 “OK” 这种词。

## B01–B59 对照清单

| ID | 清单位置 | 采什么 |
|---|---|---|
| B01 | 3.1 | OS `PRETTY_NAME` / `VERSION_ID` / kernel |
| B02 | 3.1 | `node -v` 是否在 `>=22.13 <23` |
| B03 | 3.1 | `pnpm -v` 是否 11.x |
| B04 | 3.1 / 3.4 | `psql` 连通 + `SHOW server_version`（不把 `DATABASE_URL` 放进命令行） |
| B05 | 3.1 | `redis-cli ping` + `INFO server`（不拿 `.env` 里的密码重试） |
| B06 | 3.1 | `fc-list :lang=zh` |
| B07 | 3.1 | `timedatectl` 时区是否 `Asia/Shanghai` |
| B08 | 3.1 | `df -Pk /` 余量 |
| B09 | 3.1 | `free -m` / `nproc` / loadavg |
| B10 | 3.1 | `ss -lnt`：80/443/22；5432/6379 不得 `0.0.0.0` |
| B11 | 2.1 | `/root/YITIJI` `git rev-parse HEAD` + dirty 行数 |
| B12 | 3.8 | `/srv/ai-job-print/DEPLOY_SOURCE.txt` |
| B13 | 3.8 | PM2 cwd / script / node / pid |
| B14 | 2.2 | `.env` mode 600 + 源码 index 里没有 `.env` |
| B15 | 3.8 | PM2 `status=online` |
| B16 | 3.8 | `restart_time` / `unstable_restarts` |
| B17 | 3.8 | error log **行数** + mtime（不打印正文） |
| B18 | 3.8 | `pm2 conf pm2-logrotate`（只读，不 `pm2 set`） |
| B19 | 3.7 | `client_max_body_size` |
| B20 | 3.7 | `proxy_pass` 是否指向 `127.0.0.1:3010` |
| B21 | 3.7 | `proxy_read_timeout` / `proxy_send_timeout` / `client_body_timeout` |
| B22 | 3.7 | Upgrade / Connection / `proxy_http_version` |
| B23 | 3.7 | `root` / `server_name` / 有没有 `/opc` location |
| B24 | 3.1 | `openssl x509 -checkend 0`（读 crt，不读 key） |
| B25 | 3.2 | `NODE_ENV`：`.env` + PM2 + `/proc/<pid>/environ` 取值 |
| B26 | 3.2 | `PAYMENT_PROVIDER` 取值（不得含 sandbox） |
| B27 | 3.2 | `FILE_STORAGE_DRIVER=cos` |
| B28 | 3.2 | `SMS_PROVIDER=tencent` `OCR_PROVIDER=baidu` `AI_PROVIDER=llm` |
| B29 | 3.2 | `PRINT_REQUIRE_PII_SCAN=true` 等三键 |
| B30 | 3.2 | `TERMINAL_LEGACY_REGISTER_ENABLED=false`；planned 显式 true\|false |
| B31 | 3.2 | `TRUST_PROXY_HOPS` 为 1..9 |
| B32 | 3.2 | `CONVERSION_ENGINE` + `SOFFICE_PATH` 可执行绝对路径且不是裸 `/usr/bin/soffice` |
| B33 | 3.2 闸门 | JWT / 签名 / pepper / 支付会话 / 终端两个 secret：已配置 + 长度 + 非样值 |
| B34 | 3.2 | COS 四件套是否存在（桶名只报 present/length） |
| B35 | 3.2 | 短信 5 键、百度 OCR 2 键、至少一把 LLM key；TRTC/ASR 只报有无 |
| B36 | 3.2 | 支付渠道键有无；`SANDBOX_PAYMENT_SECRET` / 已删的先付后印开关 / `DEMO_SEED_CONFIRM` 应缺 |
| B37 | 3.4 | `_prisma_migrations` 最新一条 + 条数 |
| B38 | 3.4 | `"User"` 行数（>0 则不是全新空库） |
| B39 | 3.4 | admin/owner 的 `tokenVersion` + `passwordProofState`（不选 `passwordHash`） |
| B40 | 3.4 | `AuditLog` 里 action 含 bootstrap 的条数（不读 `payloadJson`） |
| B41 | 3.4 | `pg_constraint` 中 p/f/u 数量 |
| B42 | 3.5 | 同一 `terminalId` 活跃 `ScanTask` 是否重复 |
| B43 | 3.5 | `TerminalCapability.capabilityKey='scan'` |
| B44 | 3.5 | `/srv` `/var/backups` 下排除 `node_modules` 的 sqlite/db |
| B45 | 3.4 | `db:seed` / `DEMO_SEED_CONFIRM` **命中行数**（不打印命中行） |
| B46 | 3.8 | `GET http://127.0.0.1:3010/api/v1/health` |
| B47 | 3.8 | `GET /api/v1/health/ready` |
| B48 | 3.2 / 3.6 | `GET /document-conversion/capabilities` |
| B49 | 3.6 | 日志里疑似密钥模式的 **行数**（不打印命中行） |
| B50 | 3.8 | `LOG_LEVEL` + 转换相关日志行数 |
| B51 | 3.1 | LibreOffice 包 + `/usr/local/bin/soffice-sandboxed` + `soffice-runner` 用户 |
| B52 | 3.1 | `fonts-noto-cjk` 等包 |
| B53 | 3.2 | `CORS_ALLOWED_ORIGINS` |
| B54 | 3.2 | `PAYMENT_NOTIFY_BASE_URL` 必须 `https://`；付款码收敛开关 |
| B55 | 3.2 | `TENCENT_COS_SIGN_URL_EXPIRES_SECONDS` ≤ 1800 |
| B56 | 3.3.1 | nginx `root` 目录名抽样（确认是前端 dist） |
| B57 | 3.4 | `*admin*cred*` / `*bootstrap*` / `*pass*.txt` 残留路径（不 cat） |
| B58 | 3.4 | out log 里 postgres vs sqlite **行数** |
| B59 | 7.1 | 库体积、`pg_stat_activity`、Redis `used_memory_human`、`PrintTask` 按状态计数 |

运行闸门要求的密钥（`production-runtime-gates.ts`）集中在 B25–B36：存在性 + 长度 + 非样值；取值只打非密钥开关。

## 脚本不会替你做的

- COS 控制台生命周期截图
- 当面付两笔真机
- 故意失败后的回滚演练
- 岗位/招聘会/政策内容导入（公网 `total=0` 是内容阻塞，不是 SSH 能填上的）
- 管理员口令、`GET /health/cjk-font`（要 Bearer，本脚本不索取、不代持）

## 本机冒烟

在开发机跑会得到大量 UNKNOWN/NG（没有 `/srv/ai-job-print`、没有生产库），这是预期。只要合计仍是 59 项、临时目录被删掉、stdout 里没有密钥值，脚本本身就算通。
