# 修订与工作区状态 · 第二次刷新（EV-031）

**2026-09-02T22:25+08:00 · 分支 `claude/miniapp-lane` · 只读 git 检查**
**取代 EV-022（那条钉的是 `eff92ac9c063`，已落后 9 个提交）**

## 本包现在钉住的修订

```
$ git rev-parse HEAD
0c04cec15ee92debc5d47f178b5bac52a4478bd0
```

建包时是 `8176c1ee2004`，到此为止一共落了 **20** 个提交
（`git rev-list --count 8176c1ee2004..HEAD` = 20）。
上一次刷新钉在 `eff92ac9c063`，其后又落了 **9** 个
（`git rev-list --count eff92ac9c063..HEAD` = 9）。

> 上一版包内多处写「建包后又落了 11 个提交」，那是对 `eff92ac9c063` 说的，成立。
> 本次刷新后统一改成对 `0c04cec15` 说的 20 个，两个数不是矛盾，是基准不同。

## `eff92ac9c063..HEAD` 这 9 个提交做了什么

| # | 提交 | 落点 | 性质 |
|---|---|---|---|
| 1 | `9193a6efd` | `apps/miniapp/scripts/verify-miniapp-static.mjs`（+40）、`apps/miniapp/utils/normalize.js`、交付包 | 新增 1 条门禁规则（注册页面四件套必须**入库**）；顺带修 OCR 置信度提示重复渲染 |
| 2 | `242b060c8` | `docs/compliance/**` | 合规设计口径，无代码 |
| 3 | `453f92799` | `policy-check.wxss`、`job-materials.wxss` | 修卡片内容贴边 |
| 4 | `2f5f35b4f` | `docs/acceptance/**` | 两份验收清单，无代码 |
| 5 | `fccc3b61b` | `docs/reviews/**` | CI 门禁豁免清理待办，无代码 |
| 6 | `f6ca12ba4` | `apps/kiosk/**`、`.github/workflows/ci.yml`、`scripts/ci-gate-exemptions.json` | **lane 外**：修过期正则并接线 |
| 7 | `f14cd5093` | `pages/ai/ai.js`、`job-materials.{wxml,wxss}`、`self-explore.js` | 修 3 处（入口漏接 / 画布溢出 / 底栏靠左） |
| 8 | `82dfd80c2` | 根 `scripts/`、`.github/workflows/ci.yml` | **lane 外**：删 1 条恒红门禁、`packages/refresh` 接进 typecheck、`MAX_UNWIRED` 3→1 |
| 9 | `0c04cec15` | `policy-check.{wxml,wxss}`、`docs/acceptance/**` | 修 3 处（失败态无样式 / 主按钮无配色 / 断头分隔线） |

**`services/api/**`、`packages/shared/**`、`prisma/schema.prisma` 在这 9 个提交里
零改动**（`git diff --stat eff92ac9c063..HEAD` 无对应条目）。这是 EV-021
（services/api typecheck）本轮**没有重跑**却仍然列为有效的唯一依据 ——
被测对象没变，不是「跑过了」。

## 工作区状态（不干净，且不干净的那部分正在被另一位作者改）

```
$ git status --porcelain
 M docs/progress/current-progress.md
 M scripts/verify-ci-gate-coverage.mjs
```

两处都在**小程序 lane 之外**，是另一位作者正在做的 B-1
（放开 `ENFORCED_PREFIXES` 的 `'typecheck'` 半）。影响分两段说：

- **不影响** EV-026 ~ EV-029（四条小程序门禁）。它们只读
  `apps/miniapp/**` 与 `services/api` 的路由声明，这两块工作区干净。
- **直接影响** EV-030（CI 门禁覆盖率）：被执行的就是那个被改的脚本本身。
  跑出来的 375/381 是工作区版本的数，不是 HEAD 提交版本的数。详见
  `EV-030-ci-gate-coverage.txt` 文末。

## 这条分支从未推送过，CI 一次都没跑过

```
$ git branch -r --contains HEAD
（空）
$ git rev-parse --symbolic-full-name @{u}
refs/remotes/origin/main
```

`@{u}` 指向 `origin/main` 只是本地上游配置，不代表本分支的任何提交进过远端。
`.github/workflows/ci.yml` 的触发条件是：

```yaml
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
```

`push` 只认 `main`；`pull_request` 需要有 PR；`workflow_dispatch` 需要有人手点。
本分支三条都不满足。**所以包内每一条「门禁通过」都只是开发工作区的结论，
GitHub Actions 上从未验证过本分支的任何一个提交。**
上一版包里这句话已经写过，本轮**没有任何事实让它变弱**。

## 复现本包结论的正确做法

1. `git rev-parse HEAD` 必须等于 `0c04cec15ee92debc5d47f178b5bac52a4478bd0`；
2. `git status --porcelain` 若非空，先看脏文件是否落在被测面上
   （四条小程序门禁看 `apps/miniapp/**`；覆盖率门禁看它自己）；
3. 干净检出上重跑 EV-026 ~ EV-030。本工作区**不具备**干净检出条件，
   如实记下，不假装跑过。
