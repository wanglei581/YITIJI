# P1 依赖审计评估（2026-07-25，只读）

> 范围：对当前 `origin/main` 锁文件做 `pnpm audit` 基线盘点与升级建议分级。  
> **本文件只做评估，不升级依赖、不改 lockfile、不部署、不宣称生产已清零。**

## 1. 证据基线

| 项 | 值 |
|----|----|
| Git tip（锁文件评估） | `9b869d0d`；其后 `42bbe54c`（#350）仅 docs，未改 lockfile |
| 工具 | pnpm `11.2.2` / Node `v22.22.3` |
| 命令 | `pnpm audit`、`pnpm audit --prod` |
| 既有 P0 收口 | [PR #271](https://github.com/wanglei581/YITIJI/pull/271) → `main@f8b8f1ec`（当时 high/critical 清零；multipart 限深保留） |
| 当前 overrides | `pnpm-workspace.yaml` + 根 `package.json#pnpm.overrides` 双份同步意图：`qs@6.15.2`、`@hono/node-server@2.0.4`、`uuid@14.0.0`、`shell-quote@1.8.4`、`hono@4.12.25`、`multer@2.2.0` |

说明：本机 pnpm 11 会警告根 `package.json` 的 `pnpm.overrides` **不再被读取**；有效 overrides 以 `pnpm-workspace.yaml` 为准。后续升级 PR 应继续保持双份一致（兼容服务器 pnpm 9）。

## 2. 总量（相对 #271 已漂移）

| 视角 | critical | high | moderate | low | 合计 |
|------|----------|------|----------|-----|------|
| 完整树 | **0** | **13** | **19** | **3** | **35** |
| `--prod` | **0** | **9** | **19** | **1** | **29** |

结论：

- **无 critical**。
- `next-tasks` 旧表述「完整 audit 仅剩 esbuild / @babel/core low + js-yaml moderate，且无 high/critical」**已过时**，不得继续作为部署或清零依据。
- #271 当时清零的 high/critical **已被新 advisory / 新解析版本重新抬高**（例如 `shell-quote@1.8.4` 再次落入 high；`react-router@7.15.1`、`axios@1.16.1` 等新增）。

## 3. High 清单（完整树 13）

| 包（解析版） | GHSA | 补丁要求 | 主要路径 / 面 | 建议桶 |
|--------------|------|----------|---------------|--------|
| `axios@1.16.1` | GHSA-gcfj-64vw-6mp9 | `>=1.18.0` | Terminal Agent 直接依赖 | A 直接升级 |
| `react-router@7.15.1` | GHSA-chx6-hx7r-mcp5 | `>=7.18.0` | Admin/Kiosk/Partner → `react-router-dom` | A 直接升级 |
| `react-router@7.15.1` | GHSA-qwww-vcr4-c8h2 | `>=8.3.0` | 同上 | D 架构例外候选 |
| `playwright@1.54.2` | GHSA-7mvr-c777-76hp | `>=1.55.1` | Kiosk `@playwright/test`（dev） | A 直接升级 |
| `shell-quote@1.8.4` | GHSA-395f-4hp3-45gv | audit 写 `>=1.8.5`；**npm 无 1.8.5**，下一发布为 `1.9.0` | 根 `concurrently`（dev） | B override（钉 `1.9.0`） |
| `brace-expansion` 多 major | GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg | `1.1.16` / `2.1.2` / `5.0.7+`（OOM 条目标 `>=5.0.8`） | ExcelJS runtime + eslint/rimraf tooling | B 分 major override |
| `js-yaml@4.1.1` | GHSA-52cp-r559-cp3m | `>=4.3.0` | eslint + Kiosk `react-diff-viewer-continued` | B override |
| `fast-uri@3.1.2` | GHSA-4c8g-83qw-93j6 / GHSA-v2hh-gcrm-f6hx | `>=3.1.4` | Prisma `@prisma/dev` → ajv（间接） | B override |
| `postcss@8.5.15` | GHSA-r28c-9q8g-f849 | `>=8.5.18` | Vite/Tailwind 构建链（dev） | B override |

`--prod` 仍含 9 条 high：axios、react-router×2、brace-expansion×3、fast-uri×2、js-yaml（Kiosk diff viewer）。  
Playwright / postcss / shell-quote / 部分 brace-expansion tooling 路径主要落在完整树。

## 4. Moderate / Low（摘要）

**Moderate（19 advisories / 6 包）：** `@hono/node-server`、`hono`、`axios`（多条）、`react-router`（多条）、`js-yaml`、`valibot`。

要点：

- 当前 pin：`hono@4.12.25`、`@hono/node-server@2.0.4`。多条 Hono advisory 要求 `hono>=4.12.27`、`@hono/node-server>=2.0.5`（另有 memory-leak 条目标 `>=2.0.10`）。路径经 **Prisma `@prisma/dev`**，不是业务直接 Hono 服务；仍建议在升级波次一并抬 overrides，避免「P0 已钉死旧安全版」假象。
- axios 其余 moderate 与 high 同目标：`>=1.18.0`。
- react-router 若干 moderate（open redirect / constructor injection 等）与 Framework DoS 同目标：`>=7.18.0`。
- `valibot` 经 Prisma 间接；可随 Prisma/工具链观察，不单独阻塞。

**Low（3）：** `esbuild`（dev）、`@babel/core`（dev）、`body-parser`（Express / Nest 间接，`--prod` 仍见）。可与 high 波次一并处理，不单独开第三波。

## 5. 可达性与例外候选

### 5.1 React Router RSC CSRF（GHSA-qwww-vcr4-c8h2）

- Advisory 要求 `>=8.3.0`；当前三端为 Vite SPA + `createBrowserRouter` Data Mode，**不使用** React Router Framework / RSC / SSR action 路径。
- 升级到可获取的 `react-router-dom@7.18.x` **不能**让该条从 audit 消失。
- **本评估不批准永久忽略**。若后续 remediation PR 要做「唯一 accepted-unreachable high」，必须同时满足：
  1. URL 精确匹配 `GHSA-qwww-vcr4-c8h2`（禁止按包名宽泛忽略）；
  2. 机器可验证架构守卫（无 `@react-router/{dev,node,express,serve}`、无 RSC/SSR hydrate、无 route `action/loader` 服务端语义）；
  3. 有限时复审；守卫失败则例外自动失效。

### 5.2 shell-quote 补丁版本陷阱

- audit 文案 `patched >=1.8.5`，但 registry **不存在 `1.8.5`**（`1.8.4` 之后为 `1.9.0`）。
- 当前 override 钉在 `1.8.4`（#271 当时修复版），在 **2026-07-25 基线下反而重新记为 high**。
- 升级时应钉 **`1.9.0`（或更新安全版）**，不要找不存在的 `1.8.5`。

### 5.3 Prisma / Hono / fast-uri

- 多条路径落在 `@prisma/client → prisma → @prisma/dev`。生产 API 进程未必加载 `@prisma/dev` 全部子树，但 `--prod` 仍计入；清零策略优先 **override 抬版本**，避免误升 Prisma major。

## 6. 建议后续任务（另开 PR，勿与本 docs 混合）

**目标口径（建议）：** `0 个未接受的 critical/high + 至多 1 个精确 accepted-unreachable high（仅 GHSA-qwww-vcr4-c8h2）`；完整 `pnpm audit` 仍须执行并可见，禁止伪称「audit=0」。

| 波次 | 内容 | 允许改动 |
|------|------|----------|
| Rem-1 | 直接依赖：三端 `react-router-dom→7.18.x`；Terminal Agent `axios→1.18.x`；Kiosk `@playwright/test→≥1.55.1` | apps/*/package.json + lockfile |
| Rem-2 | 双份 overrides：`shell-quote→1.9.0`；`brace-expansion` 分 major；`js-yaml→4.3.0`；`fast-uri→3.1.4`；`postcss→8.5.18`；评估抬 `hono` / `@hono/node-server` | package.json + pnpm-workspace.yaml + lockfile |
| Rem-3 | `verify:dependency-security` + CI；可选 React Router RSC 精确例外 + 架构守卫 | scripts + CI |
| Rem-4 | 回归：typecheck / 四端 build / Agent HTTP verify / Router 刷新安全 / Excel 导入 / Prisma schema sync（**不改 schema**） | 验证 only |

硬禁止（与上线前收口一致）：

- 不借依赖升级改业务 API、Prisma schema/migration、支付/FREE_MODE、Windows Agent 硬件路径、生产 `.env`。
- 不把「评估完成」写成「已部署可商用」或「依赖已清零」。

## 7. 对进度文档的纠偏点

1. P1「仅剩 esbuild/babel/js-yaml」→ 改为本报告基线（0 critical / 13 high / …）。
2. 若干部署阻塞文案仍写「`shell-quote` critical」→ **critical 已不在当前基线**；真实问题是 **新的 high 集合 + 未部署的 #271 运行时防护**。部署授权仍须单独点名，不得因本评估自动放行。
3. 本地未提交的 high remediation 计划若继续，必须以**本报告数字**为 SSOT，另从干净 `main` 开代码分支执行 Rem-1…4。

## 8. 本轮未做

- 未改任何依赖或 lockfile  
- 未跑全量 typecheck/build 作为升级证明  
- 未部署、未改预生产/生产  
- 未批准 React Router RSC 例外（仅登记候选条件）
