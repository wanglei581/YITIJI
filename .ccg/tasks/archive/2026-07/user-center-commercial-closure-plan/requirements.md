# 用户中心商用级闭环审计与开发方案

## 目标

基于当前 `main` 同步分支中的实际代码、正式产品/合规文档与可运行页面，识别用户中心中尚未设计、尚未接通、尚未完成或不应继续保留的能力，并形成可直接用于后续立项与实施的商用级开发方案。

## 本次工作对应的真实闭环

把用户中心从“入口聚合 + 局部真实数据”收口为可上线运营的会员资产、订单、权益、隐私权利与客服闭环；不新增招聘平台闭环，不改变已经定版的首页和业务板块入口。

## 本次允许修改

- `.ccg/tasks/user-center-commercial-closure-plan/**`
- `docs/reviews/user-center-commercial-closure-audit-2026-07-16.md`
- `docs/product/user-center-commercial-closure-plan-2026-07.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave0-truth-baseline.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-account-security.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-data-rights.md`
- `docs/superpowers/plans/2026-07-16-user-center-wave1-ops-ui.md`
- 必要时同步 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`

## 本次禁止修改

- `apps/**`、`services/**`、`packages/**` 的功能代码
- `legacy-miaoda/**`
- 生产配置、数据库迁移、密钥、打印机与 Windows Terminal Agent 链路
- 当前其他在途 CCG 任务及用户未提交变更

## 产品边界

- 不开发站内投递、候选人筛选、企业收简历、面试邀约或 Offer 管理。
- 不新增重复入口、同义卡片或第二套用户中心导航。
- 不把仍未实现的数据导出/账号注销接口包装成已经完成的用户能力。
- 支付、套餐、核销和招聘会凭证只有在真实业务规则、后台运营和审计能力齐全后才允许上线；此前必须隐藏或明确下线，而不是继续显示“建设中”。

## 审计范围

1. 登录、会话、账号资料、换绑、注销与数据权利。
2. 简历、文件、AI 记录、打印订单、收藏、权益、浏览/跳转记录。
3. 消息、反馈、隐私政策、保留期限与用户可控删除。
4. 管理后台的用户管理、数据请求处理、权益和订单运营闭环。
5. 27 寸竖屏触控终端、手机与桌面浏览器的可用性和无障碍。
6. PostgreSQL、Redis、对象存储、短信、支付、Windows 真机等生产验收门禁。

## 交付物

- `.ccg/tasks/user-center-commercial-closure-plan/review.md`：双模型执行情况、已吸收的 Critical/Warning 与最终复审结论。
- 现状与缺口矩阵：已完成 / 已设计未接通 / 未设计 / 不应保留。
- 三种收口策略及推荐方案。
- 按 P0/P1/P2 和依赖关系拆分的分波开发路线图。
- 数据模型、API、前端、后台、权限、审计、监控和测试验收要求。
- 文件预算、风险、非目标和上线门禁。

## 完成标准

- 架构/数据权利与 Wave 0 基线均完成独立复审；本轮精确计划已由 Antigravity 与 Claude 最终 `APPROVE`。后续运行时代码仍须逐分支重新双模型复审；任一模型若不可用，必须保留失败事实且不得宣称该实现分支双模型通过。
- 结论有代码、文档或运行态页面证据支撑。
- 方案不突破合规红线和入口稳定规则。
- 每个阶段都有可验证的完成定义、回滚要求和上线门禁。
- 本轮只交付审计、方案与实施计划；先进入最新 main 派生的纯文档分支，不直接进入功能实施。
