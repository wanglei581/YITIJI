# F1 D2 systemd 目标版本与 helper 离线演算审查

## 裁决

- **运行逻辑：无 Critical。** `stop_user_unit_and_prove_inactive` 的离线分支合同已实质完成，当前不需要为该 helper 再建 fake `systemd-run`。
- **文档诚实性：需修。** 现有事实只能证明 guest 是 Ubuntu 24.04.4 ARM64；不能证明其精确安装的 `systemd` Debian/Ubuntu package revision。正式进度当前统一引用 systemd v256，而 Ubuntu 24.04 官方基线是 systemd 255.4，二者必须对账。
- **下一波：docs-only，零 runtime change。** 先更正旧 helper 名、把已完成的 4 成功 + 10 失败 fixture 从待办移出，并明确 v256 只是旧引用锚而非目标机实测版本。
- **真机结论另行授权。** 启动现有非生产 Colima、捕获版本、创建 transient user unit 均不在本轮授权内。
- `productionF1` 继续 **NO-GO**；不得把离线合同或源码对照写成 retake/真机结论。

## 证据

### 仓库事实

1. `docs/progress/current-progress.md` 记录 guest 为 Ubuntu 24.04.4 ARM64、systemd PID 1、user manager running、Linger=yes、cgroup v2；仓库没有 `systemctl --version` 或 `dpkg-query -W systemd` 的实测输出。
2. `docs/progress/next-tasks.md` 仍引用已不存在的 `user_unit_collected_absent`，并把 fake `systemctl` / `systemd-run` helper 演算整体列为待办。
3. `services/api/scripts/d2-same-host/run.sh` 已把逻辑统一到 `stop_user_unit_and_prove_inactive`：只接受 `loaded+inactive` 与 `not-found+inactive`，单次读取并严格解析 `LoadState` / `ActiveState`；缺失、重复、空值、未知值与读取失败全部 fail closed。
4. `verify-cleanup-contract.mjs` 直接抽取生产 helper，以 fake `systemctl` 覆盖 4 个成功分支与 10 个失败分支，并锁住法证目录保留语义。
5. 本轮新鲜离线验证：
   - `bash -n services/api/scripts/d2-same-host/run.sh`：exit 0
   - `node --check services/api/scripts/d2-same-host/verify-cleanup-contract.mjs`：exit 0
   - `node services/api/scripts/d2-same-host/verify-contract.mjs`：11 组 PASS，输出 `D2_PRIME_CONTRACT_ALL_PASS`

### 上游与发行版事实

1. Ubuntu 24.04 官方发布说明记录 init system 更新为 systemd 255.4：<https://documentation.ubuntu.com/release-notes/24.04/>。
2. Ubuntu Noble 的 systemd 源包属于 255.4 系列，但 archive 中存在多个 `255.4-1ubuntu8.x` 修订；当前 archive 版本不能证明 guest 已安装版本：<https://launchpad.net/ubuntu/noble/%2Bsource/systemd>。
3. systemd-stable v255.4 的 `systemctl-show.c::show_one()` 已显式识别 `not-found+inactive`，`core/unit.c::unit_may_gc()` 在 cgroup 非空或无法证明为空时不收集。因此 helper 所依赖的核心语义不是 v256 专属；仍需以 guest 的精确 package revision 对齐 Ubuntu 补丁集。

## 双模型交叉审查

### Antigravity

- 无 Critical；Warning 为正式待办文档滞后和精确 systemd package version 缺失。
- 认可 helper 4+10 分支离线覆盖已经完成，不建议再为 helper 添加 fake `systemd-run`。
- 建议下一波仅修正式文档，不改 `run.sh`。

### Claude

- 将 v256 源码引用与 Ubuntu 24.04/255.4 目标不一致列为文档事实链 Critical；明确这不是 helper 逻辑缺陷，而是引用精确性与诚实性缺陷。
- 同样确认旧 helper 名滞后、4+10 分支已覆盖、fake `systemd-run` 对 helper 本身无必要。
- 建议先做 docs-only 对账；精确版本捕获和真实 systemd 语义验证另行授权。

### 综合

两模型对运行逻辑与下一步范围一致。严重度差异仅在“v256 引用错位”是否算 Critical：本审查按**运行代码无 Critical、正式文档有必须修的诚实性问题**处理。

## 推荐的下一波最小范围

### 可在用户批准后实施（不启动 Colima）

1. 更新 `docs/progress/next-tasks.md`：
   - 将 helper 名改为 `stop_user_unit_and_prove_inactive`；
   - 标记 fake `systemctl` 的 4 成功 + 10 失败离线演算已完成；
   - 移除“为 helper 新建 fake `systemd-run`”要求；
   - 保留真实 `systemd-run --collect` 生命周期为真机待验项。
2. 更新 `docs/progress/current-progress.md`：把 v256 定位为历史引用锚，明确 Ubuntu 24.04 基线为 255.4，但 guest exact package revision 未捕获，不能声称已按目标版本完成核对。
3. 不修改 runtime、PASS/GO、evidence schema 或 invocation governance。

### 仍需单独授权的非生产 Colima 验证

先只读捕获：

```bash
cat /etc/os-release
uname -r -m
systemctl --version
systemd-run --version
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' systemd
loginctl show-user "$(id -u)" -p Linger -p State -p Slice
```

再以一次性、隔离的 user unit 做最小真实语义验证：

1. `systemd-run --user --collect` 正常退出后出现 `not-found+inactive`；
2. 对已回收 unit 的 `systemctl --user stop` 返回非零，但 helper 以状态二元组判成功；
3. `loaded+inactive` 正常 stop 路径；
4. 属性读取/manager 失败保持 fail closed；
5. cgroup delegation preflight 的真实读数符合现有断言。

这不是 full drill：不得 reserve/consume，不生成 nonce/evidence，不连接 production，不进入 D3-D6。

## 独立 backlog

以下三项不并入本任务：无效 Nginx PID 文件后的存活证明、PM2 state file 消失后的 daemon PID 存活证明、`systemd-run` partial-start 时 `KEEPER_STARTED` 尚未置位的清理泄漏。它们需要独立 TDD 和审查。
