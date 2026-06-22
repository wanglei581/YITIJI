# 实施计划

## 阶段 0：影响面确认

- 确认文件读取链路：上传文件、签名 URL、AI 简历解析、模拟面试、会员文档列表。
- 确认 JWT 配置链路：内部用户 auth、会员 auth、文件、材料、打印、审计、终端等模块。
- 确认现有 verify 基线是否能在干净 worktree 运行。

## 阶段 1：先写失败验证

- 在会员资产或模拟面试 verify 中加入跨会员 `resumeFileId` 读取拒绝用例。
- 加入匿名调用读取会员文件拒绝用例。
- 加入 JWT secret 缺失/过短时启动配置拒绝的静态或运行时 verify。

## 阶段 2：实现 P0 修复

- 为文件内容读取新增“按期望 endUserId 读取”的服务方法。
- AI 简历解析和模拟面试读取上传文件时必须传入当前会员身份；匿名只允许读取匿名文件。
- 保留签名 URL 内容代理的既有能力，不把签名读取误拦截。
- 抽取统一 JWT secret helper，所有 JWT module 注册统一 fail closed。

## 阶段 3：验证

- 运行目标 verify：会员认证、会员资产、模拟面试或新增 P0 verify、JWT secret guard。
- 运行相关 typecheck 或测试，确认没有引入类型错误。
- 如本地 SQLite 并发超时，按项目既有经验顺序重跑 DB 写入 verify 后再判断。

## 阶段 4：双模型审查与收口

- 调 Claude 审查最终 diff。
- 调 Codex reviewer 子代理审查最终 diff。
- Critical 修复后重审；Warning 视上线风险处理。
- 更新 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`，记录 P0 已完成和剩余 P1/P2。
