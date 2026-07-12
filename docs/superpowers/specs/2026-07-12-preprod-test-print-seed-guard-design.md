# 预生产测试打印任务 Seed 守卫设计

> 状态：用户已确认设计，待实现计划与代码执行
>
> 范围：仅修复 API 重启时测试打印任务在预生产被重建的问题；不改变正常打印、支付、核销、终端 Agent 或任何前端入口。

## 背景与事实

预生产 API 使用 `NODE_ENV=staging`。`TerminalsService.onModuleInit()` 目前以
`NODE_ENV !== 'production'` 调用 `seedPrintTask()`；该方法对固定 ID
`ptask_seed_001` 执行 upsert，并强制将状态重置为 `pending`、清空终端和错误字段。

因此，每次 PM2 reload 都会把已受控关闭的历史 seed 任务重新变成无归属、无订单的可领取任务。打印领取路径对无关联订单的 pending 任务允许领取，连接的终端可能打印测试 PDF。这是预生产运行安全缺陷，不是 C5-4 核销补强引入的行为。

## 目标与成功标准

测试打印任务只能在本地开发人员明确请求时创建或重置。预生产和生产绝不创建；配置缺失也默认拒绝。

成功标准：

- staging API 启动/reload 不调用 `seedPrintTask()`，已取消任务保持终态。
- production API 启动/reload 不调用 `seedPrintTask()`。
- development 仅在显式开关严格为 `true` 时调用 seed。
- 修改不影响终端领取、超时恢复、已取消终态保护、支付后出纸门禁或 API 契约。
- 验证脚本在 SQLite 与 PostgreSQL CI job 中运行。

## 方案比较

### 方案 A：只允许 `NODE_ENV=development`

将现有判断改为 `NODE_ENV === 'development'`。

优点：改动最小。缺点：仍将是否创建可领取测试任务隐含在通用环境名中，开发环境每次重启都会 seed，无法体现操作者的明确意图。

### 方案 B：仅显式开关

只检查 `ENABLE_TEST_PRINT_TASK_SEED=true`。

优点：有显式意图。缺点：若预生产误配该变量，仍会创建可领取测试任务。

### 方案 C：开发环境 + 显式开关（采用）

仅在以下两个条件同时满足时调用 `seedPrintTask()`：

```ts
process.env['NODE_ENV'] === 'development' &&
process.env['ENABLE_TEST_PRINT_TASK_SEED'] === 'true'
```

这是 fail-closed 的双门禁：staging/production 即使误配开关也不 seed；development 未明确启用也不 seed。需要本地测试 PDF 时，开发者显式设置两项环境变量。

## 设计

### 运行时守卫

在 `TerminalsService` 内增加一个仅负责判断的私有方法或纯局部常量，使用严格字符串比较，不进行真值宽松转换。`onModuleInit()` 只在双门禁通过时调用已有 `seedPrintTask()`。

`seedPrintTask()` 本身、任务 ID、示例 PDF、领取状态机和终态保护均不改变。这样修复只切断不安全的启动入口，不改变已有测试任务的构造逻辑。

### 环境文档

在 `services/api/.env.example` 的 Terminal Agent 配置旁说明：

- `ENABLE_TEST_PRINT_TASK_SEED` 默认为不启用。
- 它只对 `NODE_ENV=development` 生效。
- staging/production 不得依靠它生成测试打印任务。

不在预生产服务器写入该开关；部署热修后通过一次受控 reload 验证不再重建任务。

### 验证

新增独立 API verify，以最小 Prisma stub 构造 `TerminalsService` 并观察 `printTask.upsert` 调用次数。每个案例恢复环境变量，避免污染其他 verify：

| NODE_ENV | ENABLE_TEST_PRINT_TASK_SEED | 期望 |
|---|---|---|
| staging | 未设置 | 不调用 seed |
| staging | true | 不调用 seed |
| production | true | 不调用 seed |
| development | 未设置 | 不调用 seed |
| development | false | 不调用 seed |
| development | true | 仅调用一次已有 seed |

同时保留并复跑既有 `verify:legacy-pending-print-task-disposition`、`verify:print-scan-first-release`，确保取消终态、领取门禁和维护处置没有回归。

## 非目标与边界

- 不删除既有 seed 任务，不直接改预生产数据库，不新建迁移。
- 不新增 HTTP 接口、管理员控制台、Kiosk 入口或终端 Agent 指令。
- 不变更支付/权益核销、订单、打印任务领取、超时恢复或硬件配置。
- 本设计不宣称已完成物理出纸验证；部署后仍须受控 reload，并以数据库零活跃测试任务和终端现场状态验证。

## 风险与回滚

主要风险是本地开发者没有显式开启开关后不再得到测试任务。该风险是有意的 fail-closed 行为，环境样板会提供明确启用方式。

代码回滚即可恢复旧 seed 行为；不涉及数据库结构或数据迁移。预生产验证前须先确认无真实 pending/claimed/printing 任务，且不将测试任务领取或发送到物理打印机。
