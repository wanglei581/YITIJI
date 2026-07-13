# 青序 LightFlow 静态 verify CI 接线审查

## 范围与结果

- 仅修改 `.github/workflows/ci.yml`、`packages/ui/scripts/verify-service-desk-foundation.mjs` 与两份进度 SSOT。
- `build-and-verify` 新增 `LightFlow UI static contracts`，在 build 后、SQLite 初始化前串行运行四个无数据库静态 verify。
- foundation verify 反向断言 CI step、四条命令和 CCG 归档边界存在。
- CCG 守卫仅豁免 `.ccg/tasks/archive/`，活动任务与其它 AI 工具状态继续 fail-closed；诊断输出保留换行。

## TDD

1. 先加入 CI 接线断言，运行 foundation verify 得到预期 RED（缺少 LightFlow CI step）。
2. 先加入 archive 边界断言，运行 foundation verify 得到预期 RED（活动状态守卫未豁免 archive）。
3. 按 Antigravity/Claude 的非阻塞诊断建议，先加入换行断言，再获得预期 RED，随后最小修正 shell 拼接。

## 验证

- UI foundation、Kiosk 首页、Admin 工作台、Partner 岗位管理 4 项 verify：通过。
- 活动状态守卫通过路径与双违规路径的换行拼接语义：通过。
- CI YAML 解析：通过。
- `git diff --check`：通过。

## 双模型审查

- Antigravity：APPROVE，Critical=0，Warning=0；仅提示字面量 CI 契约的维护成本。
- Claude：APPROVE，Critical=0；初始 Warning 为错误路径显示可能黏连，已按建议修正并复验。

## 边界

- 未 push、未合并、未部署，GitHub Actions 尚未实际运行。
- 未修改运行时代码、API、Prisma、认证、支付、打印扫描、ProfilePage 或 `/me/*`。
