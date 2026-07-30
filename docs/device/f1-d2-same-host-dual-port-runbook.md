# F1 D2′ — 同机双端口隔离演练 Runbook

> 状态：历史 Colima fresh retake 保持 NO-GO；历史候选 `166fe9dc` 的独立非生产 Lima
> fresh drill PASS 保持有效；当前 latest-main 本地集成候选已包含后续安全修复，D2′ 重新为
> NO-GO / 待验证。`productionF1` 继续 NO-GO。
> 范围：非生产 Linux 上证明 legacy `3010` 与 managed `3011` 同机并存、控制面隔离、真实 Nginx
> 原子切换、managed-only rollback 与 cgroup v2 资源门禁。
> 结论边界：D2′ 通过也只关闭非生产演练，不授权 production F1、SSH 或 D3–D6。

> 2026-07-30 时间线：`main@e721f87a` 在现有非生产 Colima 的 fresh retake 于生成
> nonce/evidence 前因缺少可信 `XDG_RUNTIME_DIR` 返回 exit `2`，结论锁定 NO-GO。
> 随后在新授权窗口中，候选 `166fe9dc3f612d8b6780951261d23540568a456b` 于独立非生产
> Lima 完成唯一一次 fresh full drill；guest drill exit `0` 且独立磁盘 evidence verifier 输出
> `D2_PRIME_EVIDENCE_PASS`。evidence SHA-256 为
> `7ff420424937c191f9485bb31e666ec3cbeb4a8f41db6411c2f94e0bf1327a2f`，drill log SHA-256 为
> `0e14e99f8b4aa20f7db80ae8aa3f6526aac1def403f3e1da5d97ac4b5648f5ba`；演练结束后端口、
> D2 units/processes/control roots/work entries 与默认 PM2 daemon 清理复核全零。

> 2026-07-31 候选边界：当前 latest-main 本地集成候选在 `166fe9dc` 基础上又增加了
> user-systemd CLI `env -i`、transient unit `env -i` 白名单与
> `systemd-run --expand-environment=no` 安全修复；这些修复及离线合同已 GREEN，语法、build 与 lint
> 也已通过，但这些都不是 full drill 证据，且尚未对这个新精确候选重跑 full drill。
> 因此上述 evidence 只证明
> 历史 `166fe9dc` PASS，不得作为当前待推送集成候选的 D2′ PASS evidence。

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
- `/run/user/<uid>` 必须由目标账户拥有、mode `0700` 且不是 symlink；其 `bus` socket 也必须由目标
  账户拥有且不是 symlink。入口自派生并校验可信 `XDG_RUNTIME_DIR`；所有需要 user bus 的
  `systemctl` / `systemd-run` 调用及演练工作负载均经净化环境，不扩大为任意普通子进程；
- PATH 中已有真实 Node.js、pnpm、PM2、Nginx、systemd 工具；脚本不安装软件、不使用 sudo；
- loopback `3010`、`3011` 和演练 Nginx 端口均空闲；
- `services/api/dist/release-provenance/` 来自当前待审 commit 的 fresh build；
- shell 中没有脚本拒绝的生产 DB、Redis、对象存储凭据变量；需要 user bus 的
  `systemctl` / `systemd-run` 调用及演练工作负载通过 `env -i` 获得白名单最小环境。

演练 transient unit 固定使用 `MemoryMax=256MiB`、`CPUQuota=25%`、`TasksMax=64`、
`LimitNOFILE=256`。这些值只用于让 keeper、PM2 daemon 与 managed API 可运行并观察内核节流；它们
不是 production 容量配置。preflight 只证明 controller 和 effective value 可应用，不替代真实负载
可达性；full drill 必须实际观察应用 membership 与 `nr_throttled` 增长。

## 3. 最小执行命令

在待审 worktree 根目录执行：

```bash
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/api verify:d2-same-host-contract

D2_EVIDENCE_OUT="$(pwd)/services/api/scripts/d2-same-host/.evidence/final-review.json" \
  pnpm --filter @ai-job-print/api drill:d2-same-host

node services/api/scripts/d2-same-host/verify-contract.mjs \
  --evidence "$(pwd)/services/api/scripts/d2-same-host/.evidence/final-review.json"
```

不得设置 skip/mock/partial-pass 开关。`D2_APPROVED_PATH`、`D2_NGINX_PORT`、`D2_EVIDENCE_DIR`、
`D2_WORK_DIR` 或 `D2_EVIDENCE_OUT` 如需覆盖，仍必须满足脚本的绝对路径、owner、权限、端口和
独立 evidence 目录约束；不能用它们绕过 Linux/systemd/cgroup/production-env 检查。

### 3.1 宿主 wrapper 退出状态

宿主 shell、`tee` / pipeline 与后置清理探针各有独立退出状态。如果不立即保存 Bash
`PIPESTATUS`，或把返回 `1` 的无匹配探针放在组合命令末尾，最终 host exit 可能只表示
`tee` / 末尾探针，不是 guest drill 结论。宿主包装必须分别保留主任务、`tee` 与探针
状态，并显式选择最终返回值：

```bash
set +e
limactl shell <non-production-instance> -- bash -lc '<approved-primary-command>' 2>&1 \
  | tee <approved-log-path>
pipeline_status=("${PIPESTATUS[@]}")
set -e

primary_rc="${pipeline_status[0]:-2}"
tee_rc="${pipeline_status[1]:-2}"
probe_rc=0

if ! limactl shell <non-production-instance> -- bash -lc \
  '<exit 0 only when every cleanup check is trustworthy and clean>'; then
  probe_rc=2
fi

printf 'D2_PRIMARY_RC=%s\n' "$primary_rc"
printf 'D2_TEE_RC=%s\n' "$tee_rc"
printf 'D2_PROBE_RC=%s\n' "$probe_rc"

if [ "$primary_rc" -ne 0 ]; then exit "$primary_rc"; fi
if [ "$tee_rc" -ne 0 ]; then exit 2; fi
exit "$probe_rc"
```

2026-07-31 在同一非生产 Lima `2.1.4` 的无副作用对照已确认，`limactl shell` 会精确
透传 guest `0/1/2`。因此 Lima PASS 当时的外层 exec `1` 收敛为宿主组合命令末尾探针
覆盖主任务 `0` 的强行为推定；原始 host 命令未持久化，所以不把推定写成字面直证。
D2′ 的硬结论仍是 guest drill exit `0` + 独立磁盘 evidence verifier PASS；已解释的 host
wrapper exit 不再作为 D3 阻塞，也绝不构成 production GO。

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
残留，均必须 `D2_PRIME_NO_GO` / exit 2。历史 Colima retake 依此锁定 NO-GO；独立 Lima
full drill 仅对历史精确候选 `166fe9dc3f612d8b6780951261d23540568a456b`、当时新授权
窗口、当时新 evidence 与唯一一次执行记录 PASS。该 PASS 不覆盖或改写旧 NO-GO
evidence，也不适用于包含后续安全修复的当前 latest-main 本地集成候选；当前候选必须
保持 D2′ NO-GO / 待 fresh 验证。`productionF1` 始终为 `NO-GO`。

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
fresh PASS，也不提供 production 值，不授权现有线上服务器上的任何动作。下一步必须先完成
本地候选与双模型审查，由用户决定是否授权推送，并在获得推送授权后固定精确
commit/CI。随后仍须由用户对该精确候选的新非生产 retake 另行授权新 nonce、新 evidence
和新 RFC3339 窗口；只有该精确候选 fresh PASS 后，才可另行申请 D3 只读预检授权。
当前 `productionF1` 继续 `NO-GO`，D3 未授权。
