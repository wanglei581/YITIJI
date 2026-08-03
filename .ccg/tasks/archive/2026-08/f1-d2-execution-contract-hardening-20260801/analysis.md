# 双模型写码前分析

## 共同结论

Antigravity 与 Claude 均给出 `ANALYSIS GO`：采用现有 `run.sh` + offline verifier + runbook 三文件方案，不新增执行器或依赖。

## 采纳设计

- 保留 `D2_APPROVED_PATH`，拒绝等于或位于仓库根目录内的 PATH 片段；格式非法同样 fail-closed。
- required commands 无法解析时使用专用固定码，不回退默认 PATH，不输出缺失命令名或路径。
- 原 `D2_PRIME_NO_GO_ENVIRONMENT` 按 kernel/toolchain/runtime-dir/user-manager/cgroup-delegation/PM2-preflight 拆分。
- canonical command 由 verifier 常量与 runbook 标记围栏做精确匹配；显式固定 executable PATH，并要求授权包先提供 exact evidence dir/out。
- verifier 增量控制在约 80 行内，避免 912 行文件越过 1000 行。

## 不采纳项

- 不新增 `.mjs` 预检执行器或新的 package script。
- 不重命名/双支持环境变量，避免形成第二套入口。
- 不把 repository marker（`.git`/`package.json`）作为唯一判断；使用已知 `$ROOT` 边界，避免 marker 缺失绕过。
