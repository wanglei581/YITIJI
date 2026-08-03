# 实施计划

1. 核对本地 worktree、`origin/main`、预生产 `DEPLOY_SOURCE`、PM2/runtime 与候选差异。
2. 双模型并行审查 Node 契约、独立 release、PM2 切换和回滚方案。
3. 按 TDD 修改既有工具链门禁：先取得 RED，再收紧 `engines.node` 并取得 GREEN。
4. 在本地 Node 22 环境执行 frozen install、专项 verify、typecheck/build 与安全检查。
5. 在预生产建立独立 Node 22 release，只读检查迁移状态并验证实际运行依赖；不覆盖当前部署目录。release 根不含 `.env`、日志、上传或缓存。
6. 生成并验证 release manifest/source archive；候选仅作为下一次正式发布输入，不在本次切流。
7. 建立 PM2/unit/当前进程回滚点；保持原 `main.js` 与原 cwd，以绝对 `/usr/local/bin/node` 重建同名 PM2 应用，失败立即以原 `main.js` + `/usr/bin/node` 恢复。
8. `pm2 save` 后脱敏验证 dump 中目标应用的绝对 Node 22 解释器、原脚本与原 cwd；不额外执行会造成第二次中断的 kill/resurrect。
9. 执行本机/公网健康、三端入口、PM2 稳定性和文件范围验证。
10. 双模型终审、同步进度文档、归档 CCG 任务并提交本地变更。
