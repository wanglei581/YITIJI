# F1 D2′ `CGROUP_CONSISTENCY` 失败根因定位（只读诊断，未改代码、未重跑）

> 日期：2026-08-01
> 分析基线：`main@e09e87a9`（含 A-6 `51e75736`、PR #453、PR #454）
> 分析方式：只读源码 + 已归档 evidence 记录。**本诊断未执行 full drill、未生成 nonce/evidence、未连接 production。**
> 目标读者：维护 `services/api/scripts/d2-same-host/` 的会话（历史上为 `codex/f1-d2-*` 线）

## 一、结论

PR #454 事件 B 停在 `phase=MEASURE step=CGROUP_CONSISTENCY class=SYSTEM`，根因是**演练器缺陷**，不是被测系统的隔离缺陷。

`drill.mjs:473` 用 rollback **之前**捕获的 PID 去读 `/proc/<pid>/cgroup`，而该进程已在 rollback 期间被 PM2 更替，读取抛 `ENOENT`。

修法是一行替换：把 `managedAppPidBeforeRollback` 换成同一 MEASURE 阶段第 429 行已经取到的活 PID `managedAppPid`。

## 二、失效链条（行号经 `main@e09e87a9` 核实）

| 行 | 内容 |
|---|---|
| 334 | `const managedAppPidBeforeRollback = pm2AppPid(...)` — rollback **前**捕获 |
| 336 | `const managedControlGroup = systemdValue(systemctlBin, unitName, 'ControlGroup', ...)` |
| 409–425 | `currentPhase = ROLLBACK`；激活 `r3-invalid` → `RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK` → `MANAGED_PREVIOUS_ONLY` |
| 427–429 | `currentPhase = MEASURE`；`step = MANAGED_PID`；`const managedAppPid = pm2AppPid(...)` — **重新捕获活 PID** |
| 437 | `networkNamespaceInode(managedAppPid)` — 用新 PID 读 `/proc/<pid>/ns/net` ✅ |
| 450 | `sha(controlGroup(managedAppPid))` — 用新 PID 读 `/proc/<pid>/cgroup` ✅ |
| 472 | `currentMeasureStep = MEASURE_STEPS.CGROUP_CONSISTENCY` |
| 473 | `assert.equal(controlGroup(managedAppPidBeforeRollback), managedControlGroup)` — 用 **334 行的旧 PID** ❌ `ENOENT` |

`controlGroup()` 实现（`drill.mjs:100-104`）：

```js
function controlGroup(pid) {
  const line = readFileSync(`/proc/${pid}/cgroup`, 'utf8').split('\n').find((entry) => entry.startsWith('0::/'))
  if (!line) fail('CGROUP_INVALID')
  return line.slice(3)
}
```

PID 不存在时 `readFileSync` 抛 `ENOENT`，在读到内容前就中断，因此 `assert.equal` 从未执行。

## 三、两条独立证据

### 证据 1：同阶段内 `/proc/<新PID>/` 可读、`/proc/<旧PID>/` 不可读

这是最直接的一条。在**同一个 MEASURE 阶段内**：

- 第 437 行用 429 行的新 PID 读 `/proc/<pid>/ns/net` → 成功
- 第 450 行用 429 行的新 PID 读 `/proc/<pid>/cgroup` → 成功
- 第 473 行用 334 行的旧 PID 读 `/proc/<pid>/cgroup` → `ENOENT`

三次读取路径同形（均为 `/proc/<pid>/` 下），两成一败，唯一变量是 PID。这证明两个 PID 指向不同进程，且旧进程在 MEASURE 阶段已不存在——即 rollback 期间发生了进程更替。

### 证据 2：`class=SYSTEM` 而非 `ASSERTION`

`diagnostics.mjs` 的归类逻辑：

```js
if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR') {
  return FAILURE_CLASSES.SYSTEM
}
```

而 `assert.equal` 值不匹配时抛 `ERR_ASSERTION`，归类为 `ASSERTION`。

事件 B 观测到的是 `class=SYSTEM`。**如果失败真的是「两个 cgroup 值不相等」，观测值应为 `ASSERTION`。** 因此可以排除「隔离性被破坏导致 cgroup 路径不一致」这一假设——代码根本没走到比较。

> 这条推理是 PR #452 引入六个固定 `measureStep` 之后才可用的。前三次重跑只能定位到 `phase=MEASURE`，无法区分是哪一步、更无法区分 SYSTEM 与 ASSERTION。诊断细化确实起作用了。

## 四、建议修法

第 473 行改用同阶段第 429 行已捕获的活 PID：

```js
// 现状
assert.equal(controlGroup(managedAppPidBeforeRollback), managedControlGroup)

// 建议
assert.equal(controlGroup(managedAppPid), managedControlGroup)
```

正确的值早已在手边——429 行取了，437/450 两处都在用它。无需新增重取逻辑。

需要由维护方判定的两点：

1. **`managedAppPidBeforeRollback`（334 行）改后是否还有用途。** 若无其他引用则应删除，否则留一个只写不读的变量会误导后续读者。
2. **是否需要显式断言「rollback 期间 PID 发生更替」。** rollback 换进程是正常行为，但当前演练器从未比较 334 行与 429 行的值。若这一更替本身属于 D2′ 要证明的隔离性质，应加显式断言；若不属于，则不必。这一判断需要 D2′ 设计意图，本诊断不代为决定。

建议按 RED→GREEN：先在 `verify-contract.mjs` 增加锁定「`CGROUP_CONSISTENCY` 不得使用 rollback 前 PID」的合同断言，确认在当前实现上 RED，再改 `drill.mjs`。

## 五、附带缺陷：`D2_APPROVED_PATH` 语义陷阱

与上述缺陷独立，但今天事件 A 就是因它废掉的，一并记录。

`run.sh:16` 与 `:23`：

```bash
APPROVED_PATH="${D2_APPROVED_PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
...
export PATH="$APPROVED_PATH"
```

该变量要求**冒号分隔的目录列表**，但变量名读起来像「一个路径」。传入单个 clone 目录会整体覆盖 `PATH`，导致第 25 行的 20 条必需命令全部找不到。

事件 A 的审计记录（PR #454 归档）：

> `rootCause`：operator 把 clone 路径误传给实际用于覆盖 executable `PATH` 的 `D2_APPROVED_PATH`；必需命令缺失 `20/20`，**脚本默认批准 PATH 缺失 `0/20`**

后半句证明 guest 环境本身是完备的——用默认 PATH 时 20 条命令一条不缺。

**真正的问题是错误归类**：这个参数错误被报成 `D2_PRIME_NO_GO_ENVIRONMENT`，让操作失误看起来像环境不具备条件。一次授权窗口因此消耗，且没有产出任何结论。

建议加前置守卫：若传入值解析为 git worktree，或用它取不到 20 条命令而默认 PATH 能取到，则在 nonce 生成前以**参数错误**（非环境错误）明确拒绝。这样同类失误变成起飞前拒绝，不再消耗授权窗口。

## 六、本诊断的边界

- 未执行 full drill、未生成 nonce/evidence、未连接 production、未进入 D3–D6
- 未修改任何运行时代码
- 上述结论不等于 D2′ PASS。`productionF1` 继续 **NO-GO**
- 证据 1 与证据 2 均来自源码结构与已归档 evidence 记录；未在运行中观测 PM2 的 rollback 重启行为。「rollback 必然更替 PID」由两条证据共同支撑，但仍建议维护方在下次重跑时用现场观测确认

## 七、与本诊断平行、需用户裁定的治理事项

以下两项不解决，下次重跑即使代码修好也可能因技术性理由作废：

1. **`colima ssh` 传输是否越界**——PR #453 已披露 guest 侧命令走 `colima ssh`，并明确将「不 SSH」边界的解释权留给用户裁定。
2. **调用唯一性控制**——PR #454 记录今天在一次授权下发生两次调用（事件 A `00:59`、事件 B `01:32`），且事件 B 复用了事件 A 的 clone，因此不被接受为合规 fresh-retake 结果。该 PR 自己把「task/invocation 唯一性控制」列为下次重跑的前置条件。
