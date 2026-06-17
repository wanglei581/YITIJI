# 智慧校园再次消失调查

## 用户目标

调查为什么招聘会/面试相关功能运行时，后台和用户端前台的“智慧校园”再次消失；要求控制 Claude 调查并给出彻底修复方案，不能影响其他功能和分支。

## 已取证事实

- 当前运行进程：
  - API `3010` cwd = `/Users/wanglei/AI求职打印服务终端/services/api`
  - Kiosk `5173` cwd = `/Users/wanglei/AI求职打印服务终端/apps/kiosk`
- 当前工作区分支：`feature/interview-setup-redesign`
- 当前 HEAD：`f4dd41c3`
- 当前分支 `rg` 搜不到 `smart-campus` / `SmartCampus` / `智慧校园` 源码。
- `main` HEAD：`3c652d16`
- `main` 已包含 PR #47 智慧校园真实可用提交链。
- `HEAD..main` 显示当前分支缺少智慧校园相关代码：
  - `apps/kiosk/src/pages/smart-campus/*`
  - `apps/admin/src/routes/smart-campus/index.tsx`
  - `apps/partner/src/routes/smart-campus/index.tsx`
  - `services/api/src/smart-campus/*`
  - `apps/kiosk/scripts/verify-smart-campus-ui.mjs`
  - `services/api/scripts/verify-partner-smart-campus.ts`
  - `services/api/prisma/schema.prisma` 中智慧校园模型
  - `packages/shared/src/types/partner.ts` 中模板联动
- 当前分支与 `main` 的共同祖先：`bdccfb8f`
- 当前分支和 `main` 各自前进 11 个提交，属于分叉状态。

## 初步根因

不是智慧校园功能坏了，也不是数据配置没开，而是当前运行的是一个从智慧校园合入前基线分叉出来的业务分支；该分支没有同步 `main`，所以编译运行的代码树里没有智慧校园。

## 风险边界

- 当前工作区有大量招聘会/面试/terminal-agent 未提交改动，不能直接切分支、强合并、reset 或 `git add .`。
- 解决方案必须把 `main` 的智慧校园增量安全集成进当前业务分支，同时保留招聘会、岗位、简历、打印扫描、模拟面试、terminal-agent 等现有改动。
