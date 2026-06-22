# 会员登录个人数据隔离 P0 需求

## 背景

腾讯短信真实发送、验证码登录和 `/member/me` 已完成线上冒烟。下一步要把“能登录”推进到“登录后的个人数据互相隔离、敏感文件读取不越权、生产认证配置不弱化”的闭环。

## 目标

- 保持现有短信登录、JWT session、`/me/*` 资产读取能力不回退。
- 阻断会员 A 通过文件 ID 触发 AI 解析或模拟面试读取会员 B 的上传文件。
- 阻断匿名调用通过文件 ID 读取会员文件。
- 移除运行时代码中的 `JWT_SECRET ?? 'dev-only-secret'` 弱 fallback，缺失或过短时 fail closed。
- 补充可重复 verify，覆盖 P0 隔离与配置门禁。

## 非目标

- 不新增登录方式、注册页、重复入口或新 UI。
- 不做招聘平台闭环，不新增投递、报名、候选人管理能力。
- 不迁移数据库结构，不改生产密钥，不提交 `.env`。
- 不清理本任务外历史文件和主工作区脏状态。

## 文件预算

允许修改：

- `services/api/src/files/*`
- `services/api/src/ai/*`
- `services/api/src/mock-interview/*`
- `services/api/src/**/**.module.ts` 中 JWT 配置相关代码
- `services/api/scripts/verify-*`
- `services/api/package.json`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/member-login-data-closure-p0/*`

禁止修改：

- `legacy-miaoda/`
- 三端 UI 路由和入口，除非验证发现 P0 认证状态处理必需
- 数据库迁移和生产 `.env`
- 与会员登录数据隔离无关的业务页面、样式和脚本

## 协作分工

- Codex：执行负责人；负责 worktree/分支、TDD、代码实现、验证、任务记录和最终收口。
- Claude：安全与架构复审；重点审查文件读取授权、JWT fail-closed、验证覆盖和是否破坏既有匿名/会员流程。
- Codex reviewer 子代理：最终 diff 审查；从正确性、安全和缺测角度给出阻断项。
