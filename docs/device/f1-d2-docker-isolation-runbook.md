# F1 Genesis D2 — Docker 隔离演练 Runbook

> 最后更新：2026-07-25  
> 范围：真实 PM2 + loopback `:3011` health 的 **隔离平面** rollback 证明。
> **不**授权生产 Genesis、切流、改生产 PM2 / Nginx / 负载层。

> **与 D2′ 的关系：** 本 runbook 仍是 provenance、真实 PM2 与 managed previous rollback 的基线，
> 但隔离容器内只有 managed `3011`，没有同一 network namespace 的 legacy `3010` + managed `3011`、
> 双 PM2 daemon、真实 Nginx 原子切换或 managed systemd/cgroup 证据，因此不能形成 D2′ PASS，也不能
> 替代 [同机双端口 D2′ runbook](./f1-d2-same-host-dual-port-runbook.md)。

## 边界

| 平面 | 允许 | 禁止 |
|------|------|------|
| 本机 Colima / Docker 隔离容器 | 空 control root → Genesis `r1`；`r1→r2` health 失败只回 `r1`；收窄 env；缺失进程分类 | 挂载生产 `.env` / DB / Redis / COS；改宿主机 PM2 |
| 生产主机 `120.48.13.190` | 只读确认 legacy PM2 仍为 `dist/main.js` | 安装 Docker（非本轮必需）、跑 `release:genesis`、故意造生产 health 故障 |

生产主机当前**未安装 Docker**。D2 在开发机 Colima（等价独立网络命名空间）完成；与「同物理机另起容器、不碰现网 PM2」目标一致。

## 前置

- Docker daemon 可用（`colima start` 或 Docker Desktop）
- 仓库 `services/api/dist/release-provenance/*` 已编译（含 launcher `__filename` 修复）
- 不设置任何生产密钥进容器

## 执行

```bash
bash services/api/scripts/d2-docker/run.sh
# 或
pnpm --filter @ai-job-print/api drill:d2-docker
```

成功时 stdout / `.evidence/d2-evidence-*.json` 含：

- `verdict: D2_PASS_ISOLATION`
- `genesis-r1` → `PARALLEL_SERVING_R1`
- `activate-r2-health-fail-rollback-r1` → `RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK`，`currentReleaseId` 仍为 r1
- `canaryPresentInProcess: false`
- `productionF1: NO-GO`

证据只保留 release ID、摘要、状态码；不输出环境值或密钥。

## 已知实现修复（D2 发现）

PM2 fork 模式下 `process.argv[1]` 为 `ProcessContainerFork.js`，不是 launcher 文件。  
stable launcher CLI 必须用 `__filename` 做 self-hash；否则真实 PM2 下永远 `RELEASE_PROVENANCE_LAUNCHER_SELF_HASH_INVALID`。

## 仍未完成（须另授权）

- D3 只读预检（control root 长期保留等）
- D4 生产零流量 Genesis
- D5 负载层切流（D2 为硬前置，但 D2≠切流批准）
- D6 稳态 managed 发布

生产 F1 来源链继续 **NO-GO**。
