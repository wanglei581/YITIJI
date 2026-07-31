# F1 D2 Prime Draft PR / CI 审查

## latest-main 同步结论

- `origin/main` 在建 PR 前前进到 `06c7fe00357533fbcd91928a3abf2ed8c2933dec`，与已推送候选重叠修改 D2 XDG 脚本与进度文档。
- 候选分支已发布，未使用 rebase / force-push；采用普通 merge 保留远程历史。
- 三个重叠脚本的 branch / main blob 实际均不同。Claude 分析阶段曾误称代码树相同，已通过 blob 校验纠正，终审以真实三方差异为准。
- 最终语义同时保留 main 的拓扑无关 XDG owner / non-symlink / `0700` / realpath 契约，以及候选的 CLI / transient unit `env -i`、`--expand-environment=no`、cgroup snapshot 与 stage markers；移除 bus socket 拓扑依赖。

## 本地门禁

- Shell / Node 语法：PASS
- `verify:d2-same-host-contract`：`D2_PRIME_CONTRACT_ALL_PASS`
- API typecheck / build / lint：PASS
- `git diff --check`：PASS
- 未运行 full drill，未启动 systemd / PM2 / Nginx，未连接 production。

## 双模型终审

- Claude 首轮：Critical 0；无阻塞 Warning。指出 `firstUserSystemd` 最先匹配包装函数定义的语义宽松问题。
- 修复：改为匹配 bare `systemctl/systemd-run --user` 或 `user_systemctl/user_systemd_run` 的真实调用，不再匹配函数定义；离线合同重跑 PASS。
- Claude 复审：Critical 0、Warning 0，`APPROVE`。
- Antigravity 复审：100/100，Critical 0、Warning 0、Info 0，`APPROVE / NO FINDINGS`。

## 授权边界

- 审查器的“建议直接合并”不构成用户授权；本任务只允许创建 Draft PR 并核对精确 HEAD CI。
- 当前候选没有自身 fresh full-drill evidence；D2′ 与 `productionF1` 仍为 **NO-GO**，D3 未授权。

## Draft PR / CI

- Draft [PR #449](https://github.com/wanglei581/YITIJI/pull/449) 已创建。
- 运行时合并头：`aab7673b174a252fc999ddfb5f9f5887c5bce59e`。
- GitHub Actions run [`30599423203`](https://github.com/wanglei581/YITIJI/actions/runs/30599423203)：`build-and-verify`、`kiosk-browser-smoke`、`postgres-readiness` 全部 success。
- Actions 的 Node 20 deprecated 与既有 Fast Refresh 注解为非阻塞 annotation，不是本 PR 失败；本任务不扩大范围修改无关 Kiosk 文件。
- 进度文档与 CCG 归档推送会产生元数据最终 HEAD；该 HEAD 仍需重跑三项 CI 才对外报告最终结果。
