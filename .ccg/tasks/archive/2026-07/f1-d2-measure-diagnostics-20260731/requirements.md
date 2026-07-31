# F1 D2′ MEASURE 安全诊断细分

## 真实阻塞

`main@b2cf461d` 的唯一 fresh retake 已返回：

```text
D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED
```

现有诊断只能定位到 `drill.mjs:425–462`，不能证明具体 measurement 操作。

## 目标

- 用有限、静态、无敏感值的 step/code 细分 MEASURE 阶段。
- 保持原始 message、stack、cause、path、hostname、PID、nonce、环境值、errno 与 evidence 内容不可输出。
- 通过 mutation 合同证明未接线、错误顺序、动态值和异常对象诱饵均 fail-closed。

## 允许修改

- `services/api/scripts/d2-same-host/diagnostics.mjs`
- `services/api/scripts/d2-same-host/drill.mjs`
- `services/api/scripts/d2-same-host/verify-contract.mjs`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务目录

## 禁止事项

- 不启动 Colima、PM2、Nginx、systemd unit 或 API 进程。
- 不执行 D2′ full drill，不生成或改写 evidence。
- 不连接 production，不 SSH，不访问生产数据/密钥，不部署、不切流、不进入 D3–D6。
- 不扩大到修复尚未被证据证明的具体运行时根因。

## 验收

- 先 RED、后最小 GREEN；保留 RED 输出。
- offline contract、Node 语法、API lint/typecheck/build 通过。
- Antigravity 与 Claude 分析、终审均完成；Critical/Warning 清零。
