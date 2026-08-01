# F1 D2′ — 同机双端口隔离演练 Runbook

> 状态：候选演练说明；当前未在合格 Linux 生成 fresh PASS evidence。
> 范围：非生产 Linux 上证明 legacy `3010` 与 managed `3011` 同机并存、控制面隔离、真实 Nginx
> 原子切换、managed-only rollback 与 cgroup v2 资源门禁。
> 结论边界：D2′ 通过也只关闭非生产演练，不授权 production F1、SSH 或 D3–D6。

## 1. 允许与禁止

| 允许 | 禁止 |
| --- | --- |
| 合格的非生产 Linux；本仓库已构建 commit；演练专用临时目录；loopback `3010/3011`；演练专用 Nginx 端口 | production 主机/PM2/Nginx/数据平面；SSH；生产凭据；migration/DDL/seed；第二 worker/cron/consumer |
| 两套临时 `HOME` / `PM2_HOME` / daemon / app name / log / release path | 复用宿主或 legacy 的 PM2 控制面；停止、改端口、reload 或重命名真实 legacy |
| transient user systemd unit + cgroup v2；真实 `nginx -t` / reload；脱敏 evidence | Docker/旧 D2、macOS skip、离线 CI 或代码 review 冒充 D2′ PASS |

本演练不要求新增云主机，也不要求在 production 安装 Docker。当前唯一线上服务器不能用来制造故障或
做 D2′；它只在未来取得独立授权后用于 D3 只读预检。D2′ 需要的是满足下述条件的非生产 Linux
执行面，可以是现有安全测试环境；没有时保持 NO-GO，不借用线上服务器。

## 2. 环境前置

必须同时满足：

- `uname -s` 为 `Linux`，且 `/sys/fs/cgroup/cgroup.controllers` 可读；
- user systemd manager 可用，目标账户 `Linger=yes`，transient unit 能真实应用 cgroup v2 controller；
- executable PATH 中已有真实 Node.js、pnpm、PM2、Nginx、systemd 工具；脚本不安装软件、不使用 sudo；
- loopback `3010`、`3011` 和演练 Nginx 端口均空闲；
- `services/api/dist/release-provenance/` 来自当前待审 commit 的 fresh build；
- shell 中没有脚本拒绝的生产 DB、Redis、对象存储凭据变量；子进程始终通过 `env -i` 获得最小环境。

演练 transient unit 固定使用 `MemoryMax=256MiB`、`CPUQuota=25%`、`TasksMax=64`、
`LimitNOFILE=256`。这些值只用于让 keeper、PM2 daemon 与 managed API 可运行并观察内核节流；它们
不是 production 容量配置。preflight 只证明 controller 和 effective value 可应用，不替代真实负载
可达性；full drill 必须实际观察应用 membership 与 `nr_throttled` 增长。

## 3. 最小执行命令

在待审 worktree 根目录执行：

```bash
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

授权包必须先把精确绝对路径写入当前 shell 的 `D2_EVIDENCE_DIR` 与 `D2_EVIDENCE_OUT`；两者缺失时，
`run.sh` 自身和下述唯一 canonical full-drill command 都会在生成 nonce 前 fail closed。`D2_EVIDENCE_OUT`
必须位于 `D2_EVIDENCE_DIR` 的物理目录内。`D2_APPROVED_PATH` 是冒号分隔的 **executable PATH**，只能
指向仓库外的既有二进制目录；不得传入 fresh clone / repository path，指向仓库内部的符号链接同样会被
物理路径检查拒绝，脚本也不会在非法值或缺失命令时回退到 caller PATH。

canonical PATH 对应当前既有非生产 Colima 的工具链布局；如果目标环境的 required commands 不在这些
目录中，必须先按独立代码任务同步更新 runbook 与 offline contract 并重新审查，不能在授权窗口内临时改命令。

<!-- D2_FRESH_RETAKE_COMMAND_START -->
```bash
: "${D2_EVIDENCE_DIR:?missing exact authorized evidence directory}"
: "${D2_EVIDENCE_OUT:?missing exact authorized evidence path}"
env -i \
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  D2_APPROVED_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  D2_EVIDENCE_DIR="$D2_EVIDENCE_DIR" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
```
<!-- D2_FRESH_RETAKE_COMMAND_END -->

full drill 结束后，独立 verifier 使用同一授权 evidence 路径：

```bash
node services/api/scripts/d2-same-host/verify-contract.mjs \
  --evidence "$D2_EVIDENCE_OUT"
```

不得设置 skip/mock/partial-pass 开关。`D2_NGINX_PORT`、`D2_EVIDENCE_DIR`、`D2_WORK_DIR` 或
`D2_EVIDENCE_OUT` 如需覆盖，仍必须满足脚本的绝对路径、owner、权限、端口和独立 evidence 目录约束；
不能用它们绕过 Linux/systemd/cgroup/production-env 检查。完整 full drill 每个授权窗口只允许调用一次，
失败后不得用修改变量的方式在同一窗口重跑。

## 4. PASS 与 NO-GO

只有 full drill exit 0 并输出以下两行，且独立 verifier 对磁盘 JSON 输出后续三行，才是 D2′ PASS：

```text
D2_PRIME_PASS
productionF1=NO-GO
```

```text
evidenceVerdict=D2_PRIME_PASS
productionF1=NO-GO
D2_PRIME_EVIDENCE_PASS
```

macOS、缺 cgroup v2/systemd delegation/linger/Nginx/PM2、端口占用、资源限值不生效、CPU 未观察到
throttling、legacy probe 失败、Nginx mixed target、回滚触碰 legacy、evidence 不合法或任何 cleanup
残留，均必须 `D2_PRIME_NO_GO` / exit 2。当前仓库状态属于“候选已离线验证，full D2′ 尚未证明”，
不得记录为 PASS。

延迟行 `D2_PRIME_LATENCY` 只记录本次非生产串行 loopback 请求的 baseline/load p50/p95，供诊断；
它不是并发容量测试、生产 SLA 或 D3 容量批准。硬判定只有 load 期间 legacy 请求零失败/超时。

## 5. Evidence 白名单

JSON 只允许固定 schema：版本/plane/verdict/`productionF1`、三进程 network namespace inode、两套
PM2/home/daemon/name/release/log 的摘要 ID、固定 managed health URL 与 legacy probe count、真实
Nginx 版本和 invalid/valid candidate 结果、r1→r2→不健康 r3→r2 的 release chain、cgroup effective
values 与 `nr_throttled`、七个 data-safety 布尔值、RFC3339 时间。

禁止写入真实 path、环境值、秘密、PM2 dump、日志正文、header、IP、用户或业务数据。validator 会
拒绝未知/缺失字段，并从 raw measurement 重算所有派生布尔值和 verdict；异常路径只允许写固定脱敏
failure measurements，不能复用可能已组成 PASS 的实时 measurements。`productionF1` 永远为 `NO-GO`。

## 6. 精确 cleanup

每次运行创建随机 nonce workspace。finally/EXIT 只清理该 nonce 的：演练 Nginx master、legacy
PM2 app/daemon、managed app、managed keeper transient unit 和临时 release workspace。Nginx 与 unit
按精确 PID/name 等待退出；若仍存活则保留 workspace 并 exit 2，避免删掉在用文件。脚本不使用宿主
默认 `PM2_HOME`，不使用宽泛进程名或 glob，不触碰 production/其他本地 PM2。

## 7. 与旧 D2、D3–D6 的关系

[旧 Docker D2](./f1-d2-docker-isolation-runbook.md) 继续证明 provenance 与 rollback 基线，但它没有
同 namespace 双端口、双 PM2 daemon、真实 Nginx 和 managed cgroup 证据，不能替代 D2′。D2′ 即使
fresh PASS，也不提供 production 值，不授权现有线上服务器上的任何动作；下一步仍是单独申请 D3
只读预检，production F1 继续 NO-GO。
