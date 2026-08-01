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

- 主机管理员已在仓库外预先创建 `D2_GOVERNANCE_ROOT`；程序不会创建该 root，也不会调用 `sudo`；
- governance root 是 realpath 后不变的本地文件系统真实目录，owner 为演练账户的有效 UID，mode 精确为
  `0700`，不是符号链接；
- governance root 与 clone、evidence、archive、`services/api/scripts/d2-same-host/.work` 及其他 cleanup root
  必须双向隔离：任何一方都不能等于、包含或被另一方包含；
- `uname -s` 为 `Linux`，且 `/sys/fs/cgroup/cgroup.controllers` 可读；
- user systemd manager 可用，目标账户 `Linger=yes`，transient unit 能真实应用 cgroup v2 controller；
- canonical executable PATH `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` 中已有真实 Git、Node.js、pnpm、
  PM2、Nginx、systemd 工具；脚本不安装软件、不使用 sudo，且所有命令都只从该固定 PATH 解析；
- loopback `3010`、`3011` 和演练 Nginx 端口均空闲；
- `services/api/dist/release-provenance/` 来自当前待审 commit 的 fresh build；
- shell 中没有脚本拒绝的生产 DB、Redis、对象存储凭据变量；子进程始终通过 `env -i` 获得最小环境。

governance root 中任何 incomplete reservation/invocation、截断、损坏、权限或关系异常都必须 NO-GO。
已取得的 identity 或 invocation 永不自动回滚、删除、补写或恢复；治理状态丢失、不可读或真实性无法证明时，
不得用新建空目录恢复同一 retake。

governance root 的 owner 能为任意合格 clone 发起预约，这是本合同明确的主机账户威胁边界。该 root 必须仅由
获授权的演练账户持有；本治理不声称抵御同一 Unix UID 或 root 主动篡改 state root、Git、Node、内核或运行时代码。

演练 transient unit 固定使用 `MemoryMax=256MiB`、`CPUQuota=25%`、`TasksMax=64`、
`LimitNOFILE=256`。这些值只用于让 keeper、PM2 daemon 与 managed API 可运行并观察内核节流；它们
不是 production 容量配置。preflight 只证明 controller 和 effective value 可应用，不替代真实负载
可达性；full drill 必须实际观察应用 membership 与 `nr_throttled` 增长。

## 3. 未来授权模板：reserve → invoke 单一路径

> 本节命令只定义未来另行授权时的唯一操作模板。本任务不执行 reserve、full drill、post-drill verify，
> 不启动 systemd、PM2、Nginx 或 API，也不授权 fresh retake、production 或 D3–D6。

未来授权包必须先固定以下 operator-local 输入：预配置的 `D2_GOVERNANCE_ROOT`、获批 source repository
的绝对路径、全新 task ID、完整期望 branch、完整 40/64 位 baseline OID、尚不存在的独立 clean clone
绝对路径、尚不存在且唯一的 evidence/archive 目标，以及独立 RFC3339 执行窗口。`D2_CLONE_ROOT` 必须
正是随后执行 `run.sh` 的代码树；不能在 clone A 预约后从 clone B 调用，也不能使用 linked worktree、
`.git` gitfile 或预约后被替换/改动的 clone。

`D2_EVIDENCE_OUT` 与 `D2_ARCHIVE_OUT` 是操作者在当前授权 shell 中持有的绝对目标。它们只作为预约输入；
evidence 路径在 invoke 成功后由 owner-only manifest 经私有 fd 3 交给 `run.sh`，不得再通过 full-drill 环境
传入第二份真值。`D2_APPROVED_PATH` 不是 operator-local 输入；以下命令段拒绝任何预先定义，再将它固定并
锁为只读 canonical 值。source preflight、clone、build、治理 verifier、旧 contract、reserve、invoke 和
post verifier 共用这一项工具链真值，禁止用 PATH A 建链/预约后再用 PATH B invoke：

```bash
set -euo pipefail
if [[ "${D2_APPROVED_PATH+x}" == x ]]; then
  printf '%s\n' 'D2_PRIME_APPROVED_PATH_INPUT_FORBIDDEN' >&2
  exit 2
fi
readonly D2_APPROVED_PATH='/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
```

首行启用的 errexit、nounset 与 pipefail 对本节后续所有命令块持续生效；不得在 reserve 前开启新的 shell、
使用 `set +e`，或以其他方式忽略 source preflight、clone 复核、build、任一 verifier 的非零退出。任何一步
失败都必须立即停止，不能继续 clone 或 reserve。

先在尚未创建目标 clone 的同一 Bash 授权 shell 中，仅从稳定、已审的 source repository 执行以下 preflight。
它把 source 解析为物理 Git top-level，并证明 source 的 HEAD、index、tracked/untracked worktree 都精确符合
获批 baseline；任一检查失败都不得创建 clone 或预约：

```bash
: "${D2_SOURCE_REPOSITORY:?missing exact approved source repository}"
: "${D2_BASELINE_OID:?missing exact baseline OID}"
: "${D2_BRANCH:?missing exact fresh branch}"
: "${D2_CLONE_ROOT:?missing exact fresh clone path}"
D2_SOURCE_ROOT="$(cd -P -- "$D2_SOURCE_REPOSITORY" && pwd -P)"
cd -P -- "$D2_SOURCE_ROOT"
[[ "$(git rev-parse --show-toplevel)" == "$D2_SOURCE_ROOT" ]]
[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_OID" ]]
git diff --quiet --ignore-submodules --
git diff --cached --quiet --ignore-submodules --
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]]
```

source preflight 成功后，仍在同一授权 shell 中用 `--no-local` 创建唯一 clone；目标必须是绝对、尚不存在、
非符号链接且按物理 parent 复算后仍为授权路径。随后从获批 baseline 创建全新 branch，并在任何 build 或
reserve 前复核 standalone `.git`、物理 top-level、HEAD、symbolic branch、index 及完整 worktree：

```bash
[[ "$D2_CLONE_ROOT" == /* ]]
[[ ! -e "$D2_CLONE_ROOT" && ! -L "$D2_CLONE_ROOT" ]]
D2_CLONE_PARENT="$(dirname -- "$D2_CLONE_ROOT")"
D2_CLONE_NAME="$(basename -- "$D2_CLONE_ROOT")"
[[ -n "$D2_CLONE_NAME" && "$D2_CLONE_NAME" != '.' && "$D2_CLONE_NAME" != '..' ]]
D2_CLONE_PHYSICAL_TARGET="$(cd -P -- "$D2_CLONE_PARENT" && pwd -P)/$D2_CLONE_NAME"
[[ "$D2_CLONE_ROOT" == "$D2_CLONE_PHYSICAL_TARGET" ]]
git clone --no-local -- "$D2_SOURCE_ROOT" "$D2_CLONE_ROOT"
cd -P -- "$D2_CLONE_ROOT"
git switch -c "$D2_BRANCH" "$D2_BASELINE_OID"
[[ "$(pwd -P)" == "$D2_CLONE_ROOT" ]]
[[ "$(git rev-parse --show-toplevel)" == "$D2_CLONE_ROOT" ]]
[[ "$(git rev-parse --git-dir)" == '.git' && -d .git && ! -L .git ]]
[[ "$(git rev-parse HEAD)" == "$D2_BASELINE_OID" ]]
[[ "$(git symbolic-ref --quiet --short HEAD)" == "$D2_BRANCH" ]]
git diff --quiet --ignore-submodules --
git diff --cached --quiet --ignore-submodules --
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]]
```

上述复核全部成功后，才在该 clone 根目录执行 fresh build 与两个独立离线合同；全部通过后才允许执行本节
后续唯一 reserve：

```bash
env -i \
  PATH="$D2_APPROVED_PATH" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  pnpm --filter @ai-job-print/api build
env -i \
  PATH="$D2_APPROVED_PATH" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  pnpm --filter @ai-job-print/api verify:d2-same-host-governance
env -i \
  PATH="$D2_APPROVED_PATH" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

在同一 Bash 授权 shell、同一 clone 中仅执行一次以下预约。command substitution 内只在 Node 成功后用
Bash builtin `printf` 追加固定控制字符 sentinel，使 Node stdout 的尾随换行不会被 command substitution
吞掉；父侧要求 sentinel 唯一且位于末尾，剥离后 payload 必须精确以单个换行结束，去掉该换行后不得再含
任何换行。只有剩余单行精确匹配 `D2_PRIME_GOVERNANCE_RESERVED <32 位小写十六进制 ID>` 时，才导出
裸 opaque ID。Node 非零（即使此前输出合法行）、零行、合法行后额外空行、两行、错误前缀或错误 ID 均固定
exit 2；预约可能已写入不可变状态，因此**绝不能第二次执行 reserve 来重新取值**。任何冲突、部分写入、
崩溃或损坏都消耗已取得的 identity 并保持 NO-GO，不得删除 state 后重试：

```bash
readonly D2_GOVERNANCE_RESERVE_SENTINEL=$'\034'
if D2_GOVERNANCE_RESERVE_FRAME="$(
  env -i \
    PATH="$D2_APPROVED_PATH" \
    HOME="$HOME" \
    LANG=C.UTF-8 \
    node services/api/scripts/d2-same-host/governance.mjs reserve \
      --state-root "$D2_GOVERNANCE_ROOT" \
      --task-id "$D2_TASK_ID" \
      --branch "$D2_BRANCH" \
      --baseline "$D2_BASELINE_OID" \
      --clone "$D2_CLONE_ROOT" \
      --evidence "$D2_EVIDENCE_OUT" \
      --archive "$D2_ARCHIVE_OUT" &&
    builtin printf '%s' "$D2_GOVERNANCE_RESERVE_SENTINEL"
)"; then
  :
else
  printf '%s\n' 'D2_PRIME_GOVERNANCE_RESERVE_FAILED' >&2
  exit 2
fi
if [[ "$D2_GOVERNANCE_RESERVE_FRAME" != *"$D2_GOVERNANCE_RESERVE_SENTINEL" ]]; then
  printf '%s\n' 'D2_PRIME_GOVERNANCE_RESERVE_OUTPUT_INVALID' >&2
  exit 2
fi
D2_GOVERNANCE_RESERVE_PAYLOAD="${D2_GOVERNANCE_RESERVE_FRAME%"$D2_GOVERNANCE_RESERVE_SENTINEL"}"
if [[ "$D2_GOVERNANCE_RESERVE_PAYLOAD" == *"$D2_GOVERNANCE_RESERVE_SENTINEL"* ||
  "$D2_GOVERNANCE_RESERVE_PAYLOAD" != *$'\n' ]]; then
  printf '%s\n' 'D2_PRIME_GOVERNANCE_RESERVE_OUTPUT_INVALID' >&2
  exit 2
fi
D2_GOVERNANCE_RESERVE_LINE="${D2_GOVERNANCE_RESERVE_PAYLOAD%$'\n'}"
if [[ "$D2_GOVERNANCE_RESERVE_LINE" == *$'\n'* ||
  ! "$D2_GOVERNANCE_RESERVE_LINE" =~ ^D2_PRIME_GOVERNANCE_RESERVED\ ([0-9a-f]{32})$ ]]; then
  printf '%s\n' 'D2_PRIME_GOVERNANCE_RESERVE_OUTPUT_INVALID' >&2
  exit 2
fi
export D2_GOVERNANCE_RESERVATION_ID="${BASH_REMATCH[1]}"
unset D2_GOVERNANCE_RESERVE_FRAME D2_GOVERNANCE_RESERVE_PAYLOAD D2_GOVERNANCE_RESERVE_LINE
```

`D2_APPROVED_PATH` 是上述 runbook 固定且只读的 executable PATH，不接受操作者覆盖；不得传入 clone 或
repository path，也不得在 reserve 与 invoke 之间更换。缺失 Git 或其他必需命令时保持 NO-GO，不得改用
另一条 PATH 或回退到 caller PATH。

canonical PATH 对应当前既有非生产 Colima 的工具链布局；如果目标环境的 required commands 不在这些
目录中，必须先按独立代码任务同步更新 runbook 与 offline contract 并重新审查，不能在授权窗口内临时改命令。

<!-- D2_FRESH_RETAKE_COMMAND_START -->
```bash
env -i \
  PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  D2_APPROVED_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  D2_GOVERNANCE_ROOT="$D2_GOVERNANCE_ROOT" \
  D2_GOVERNANCE_RESERVATION_ID="$D2_GOVERNANCE_RESERVATION_ID" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
```
<!-- D2_FRESH_RETAKE_COMMAND_END -->

canonical command 会在任何 production-env/cgroup/port 等后续 preflight 前调用唯一 invoke 门禁。
invocation tombstone 一旦落盘，本次调用即永久消耗；即使后续 preflight、nonce、systemd、evidence 或 cleanup
失败，也不得在同一 reservation 或授权窗口重跑。重新预约必须等待新的独立用户授权，并使用全新的全部身份与目标。

full drill 结束后，独立 verifier 才使用操作者在预约时保留的同一个 `D2_EVIDENCE_OUT`：

```bash
env -i \
  PATH="$D2_APPROVED_PATH" \
  HOME="$HOME" \
  LANG=C.UTF-8 \
  node services/api/scripts/d2-same-host/verify-contract.mjs \
    --evidence "$D2_EVIDENCE_OUT"
```

不得设置 skip/mock/partial-pass 开关，也不得向 canonical command 增加未列出的输入。`D2_WORK_DIR`、
`D2_EVIDENCE_DIR` 和 `D2_EVIDENCE_OUT` 都不是 `run.sh` override，不能进入 full-drill env；workspace 固定由
脚本管理，evidence 真值只来自已预约 manifest。操作者持有的 evidence 变量仅用于上面的预约参数和事后
只读 verifier，不能绕过 Linux/systemd/cgroup/production-env 或唯一调用门禁。

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

cleanup 永不触碰仓库外 governance root、reservation/identity/invocation tombstone、manifest 或 immutable
event。若 root 与任何 cleanup 范围无法证明隔离，必须在预约前 NO-GO，而不是依赖 cleanup 排除规则补救。

## 7. 与旧 D2、D3–D6 的关系

[旧 Docker D2](./f1-d2-docker-isolation-runbook.md) 继续证明 provenance 与 rollback 基线，但它没有
同 namespace 双端口、双 PM2 daemon、真实 Nginx 和 managed cgroup 证据，不能替代 D2′。D2′ 即使
fresh PASS，也不提供 production 值，不授权现有线上服务器上的任何动作；下一步仍是单独申请 D3
只读预检，production F1 继续 NO-GO。
