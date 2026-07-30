# F1 D2 Prime 最新主线本地集成候选

## 目标

以 `origin/main@7b33447d38f16c9e251802052d2c95e9fe6df0d9` 为唯一基线，在独立 worktree 中整合 D2 Prime 运行时加固、集成质量审查要求的环境净化安全修复和后续文档结论，形成可审查、可验证、但不推送和不部署的本地候选。

## 必须保留

- `origin/main` 已记录的早期 D2 Prime fresh retake NO-GO 历史事实。
- `166fe9dc` 的四个运行时代码文件核心语义，以及后续 RED→GREEN 关闭的 user-systemd ambient 环境继承风险。
- 历史 `166fe9dc` fresh PASS、宿主退出状态澄清和 D3 只读预授权门禁结论，同时明确当前加固候选尚无自己的 fresh PASS evidence。
- 生产环境继续 NO-GO；D3 未授权；不修改 PM2、Nginx、数据库、安全组或任何远端资源。

## 范围

- 允许修改 D2 same-host 脚本四文件。
- 允许协调 D2 runbook、当前进度、下一步任务和旧 D3 预检报告。
- 允许新增本次正式实施计划与 CCG 任务记录。
- 禁止修改业务生产代码、部署配置、数据库迁移和密钥。
- 禁止 push、PR、部署、迁移、服务重启或云资源变更。

## 验收

- 从精确 `origin/main` 基线创建独立分支和 worktree。
- D2 合同验证、API build、API lint、语法检查、历史 evidence 兼容复核和 `git diff --check` 全部通过；历史 evidence 不得冒充当前加固候选的精确运行证明。
- 双模型分析和双模型最终审查均完成，Critical/Warning 清零。
- 任务归档，形成仅本地提交。
