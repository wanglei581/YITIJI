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

## 3. 两阶段最小执行协议

两个阶段必须按下述顺序执行，且使用同一组不变的七项身份：`D2_GOVERNANCE_ROOT`、
`D2_TASK_ID`、`D2_BASELINE_SHA`、`D2_BRANCH_NAME`、`D2_CLONE_PATH`、`D2_EVIDENCE_OUT`
和 `D2_ARCHIVE_PATH`。授权包只能向当前 shell 提供精确值；本 runbook 不记录任何已过期窗口、
nonce 或具体授权值。父 shell 还必须提供绝对路径 `D2_SOURCE_REPOSITORY`；它只标识治理脚本的获批来源，
不属于 reservation facet，也不进入 reserve/consume 身份。

### 3.1 阶段一：clone 创建前预留

必须从稳定、已审且已通过离线合同的仓库执行预留，不得从尚未创建的 fresh clone 执行。
`D2_GOVERNANCE_ROOT` 必须事先存在，是位于任何 repository 与目标 clone 之外的真实目录，
当前账户为 owner，mode 精确为 `0700`。`D2_CLONE_PATH`、`D2_EVIDENCE_OUT`、`D2_ARCHIVE_PATH`
各自的物理 parent 必须事先存在且可解析，由当前 UID 拥有，group/world 均不可写（建议 mode `0700`）；
三个目标本身在预留前都必须不存在。`D2_EVIDENCE_DIR` 也必须事先满足相同的可解析、owner 和权限条件，
且 evidence 的物理 parent 必须位于 `D2_EVIDENCE_DIR` 的物理目录内。不得用符号链接、已有目标或仓库内
governance root 绕过这些约束。

先在父 shell 中执行且仅执行下述 source preflight，证明治理脚本来自获批 commit；该 block 固定 PATH，
将 `D2_SOURCE_REPOSITORY` 解析为物理 top-level，并核对 HEAD、tracked worktree 与 index 均符合授权：

```bash
: "${D2_SOURCE_REPOSITORY:?missing exact approved source repository}" && \
: "${D2_BASELINE_SHA:?missing exact baseline}" && \
PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" && \
export PATH && \
D2_SOURCE_ROOT="$(cd -P -- "$D2_SOURCE_REPOSITORY" && pwd -P)" && \
cd -P -- "$D2_SOURCE_ROOT" && \
[[ "$(git rev-parse --show-toplevel)" == "$D2_SOURCE_ROOT" ]] && \
[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_SHA" ]] && \
git diff --quiet --ignore-submodules -- && \
git diff --cached --quiet --ignore-submodules --
```

source preflight 成功后，必须保持同一父 shell 与同一组授权值，紧接着执行唯一 reserve block：

<!-- D2_INVOCATION_RESERVE_COMMAND_START -->
```bash
: "${D2_GOVERNANCE_ROOT:?missing exact governance root}"
: "${D2_TASK_ID:?missing exact task id}"
: "${D2_BASELINE_SHA:?missing exact baseline}"
: "${D2_BRANCH_NAME:?missing exact branch}"
: "${D2_CLONE_PATH:?missing exact fresh clone path}"
: "${D2_EVIDENCE_OUT:?missing exact evidence path}"
: "${D2_ARCHIVE_PATH:?missing exact archive target}"
env -i \
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_TASK_ID="$D2_TASK_ID" \
  D2_BASELINE_SHA="$D2_BASELINE_SHA" \
  D2_BRANCH_NAME="$D2_BRANCH_NAME" \
  D2_CLONE_PATH="$D2_CLONE_PATH" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  D2_ARCHIVE_PATH="$D2_ARCHIVE_PATH" \
node services/api/scripts/d2-same-host/invocation-governance.mjs --reserve
```
<!-- D2_INVOCATION_RESERVE_COMMAND_END -->

`reserve` 只在 governance root 中持久化 reservation 和脱敏 ledger 事件；它不创建 clone、nonce、
evidence 或 archive，也不调用 full drill。只有 `reserve` 成功后，才能在 `D2_CLONE_PATH`
创建 fresh clone，并且只能使用下述 block 从相同 source 创建非本地 clone、从获批 baseline 新建唯一 branch，
再复核物理 top-level、HEAD、symbolic branch、tracked worktree 与 index：

```bash
: "${D2_SOURCE_REPOSITORY:?missing exact approved source repository}" && \
: "${D2_BASELINE_SHA:?missing exact baseline}" && \
: "${D2_BRANCH_NAME:?missing exact branch}" && \
: "${D2_CLONE_PATH:?missing exact fresh clone path}" && \
PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" && \
export PATH && \
git clone --no-local -- "$D2_SOURCE_REPOSITORY" "$D2_CLONE_PATH" && \
cd -P -- "$D2_CLONE_PATH" && \
git switch -c "$D2_BRANCH_NAME" "$D2_BASELINE_SHA" && \
D2_CLONE_ROOT="$(pwd -P)" && \
[[ "$(git rev-parse --show-toplevel)" == "$D2_CLONE_ROOT" ]] && \
[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_SHA" ]] && \
[[ "$(git symbolic-ref --quiet --short HEAD)" == "$D2_BRANCH_NAME" ]] && \
git diff --quiet --ignore-submodules -- && \
git diff --cached --quiet --ignore-submodules --
```

上述复核全部成功后，才在该 clone 根目录执行构建与离线合同：

```bash
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

### 3.2 阶段二：fresh clone 内唯一 full drill

授权包还必须把精确绝对路径写入当前 shell 的 `D2_EVIDENCE_DIR` 与 `D2_EVIDENCE_OUT`；两者缺失时，
`run.sh` 和下述唯一 canonical full-drill command 都会在生成 nonce 前 fail closed。`D2_EVIDENCE_OUT`
必须位于 `D2_EVIDENCE_DIR` 的物理目录内。`D2_APPROVED_PATH` 是冒号分隔的 **executable PATH**，只能
指向仓库外的既有二进制目录；不得传入 fresh clone / repository path，指向仓库内部的符号链接同样会被
物理路径检查拒绝，脚本也不会在非法值或缺失命令时回退到 caller PATH。

canonical PATH 对应当前既有非生产 Colima 的工具链布局；如果目标环境的 required commands 不在这些
目录中，必须先按独立代码任务同步更新 runbook 与 offline contract 并重新审查，不能在授权窗口内临时改命令。

下述 block 必须在刚创建的 `D2_CLONE_PATH` 根目录执行，七项身份必须与阶段一完全一致。
`run.sh` 会在 Linux、toolchain、preflight 和 nonce 边界之前自动 consume 已有 reservation；
当前身份和授权窗口内不存在第二次调用。

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
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_TASK_ID="$D2_TASK_ID" \
  D2_BASELINE_SHA="$D2_BASELINE_SHA" \
  D2_BRANCH_NAME="$D2_BRANCH_NAME" \
  D2_CLONE_PATH="$D2_CLONE_PATH" \
  D2_EVIDENCE_OUT="$D2_EVIDENCE_OUT" \
  D2_ARCHIVE_PATH="$D2_ARCHIVE_PATH" \
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
不能用它们绕过 Linux/systemd/cgroup/production-env 检查。archive 目标在 reserve 和 consume 时都必须不存在，
只能在调用结束后创建。

reservation 以及 ledger 中的 `RESERVED` / `INVOKED` 事件都不属于 cleanup，任何普通 cleanup 或演练清理都不得删除它们。
`reservation.lock` 残留表示临界区内存在无法证明状态的部分持久变更；当前窗口不得删除、恢复或绕过 stale lock。
无论 reserve 失败、consume 失败，还是 consume 后的基线复核、preflight 或 full drill 失败，都不得在同一身份或授权窗口重跑。
后续重试必须更换全部六个 facet：task、baseline、branch、clone、evidence、archive，并重新建立授权窗口与 reservation。
governance root 只有在不存在 busy tombstone 且 ledger 健康时才可复用；否则必须停止并另立法证/恢复任务，不得在当前窗口修复。

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
