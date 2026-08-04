# 范围与边界

- 真实问题：PR #471 已合入 `main@3b3c3100` 且合入后主线 CI 3/3 通过，但两份进度 SSOT
  仍保留“待 CI/合入”“等待替换”“待 PR 合入后关闭”等候选阶段口径。
- 允许修改：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 及本任务审计记录。
- 禁止修改：运行时代码、测试、CI、runbook、依赖、锁文件、生产配置和既有演练证据。
- 不执行：`run.sh`、reserve/invoke/full drill、Colima、systemd、PM2、Nginx、部署、生产或硬件操作。
- 必须保留：PR 合入不等于 D2′ PASS，不授权 fresh retake；cleanup 四处缺口继续阻塞，
  `productionF1` 继续 `NO-GO`。
- 验证：核对 GitHub PR/合并提交/主线 CI，执行过期口径扫描、Markdown 链接检查、
  `git diff --check` 与范围检查。
