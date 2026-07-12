# 首页入口收口方案（2026-07-11）

> 关联文档：[user-data-flow-matrix.md](../product/user-data-flow-matrix.md) | [feature-scope.md](../product/feature-scope.md) | [ia-consolidation-audit-2026-07-03.md](./ia-consolidation-audit-2026-07-03.md) | [ia-consolidation-phase-a-checklist-2026-07-03.md](./ia-consolidation-phase-a-checklist-2026-07-03.md) | [current-progress.md](../progress/current-progress.md) | [next-tasks.md](../progress/next-tasks.md)
>
> 起因：对 Kiosk 首页 6 大服务分组 + 百宝箱 + 智慧校园逐项核查后发现的 5 项问题，本文档记录裁定结果、已执行的改动、验证记录，以及仍未开工能力的排期建议。核查基准：main `69fed4fc`（含 `feature/real-scan` 合并）。

---

## 一、核查结论摘要

| 分组 | 入口数 | 已打通 | 部分打通 | 未开始（诚实占位） |
|---|---|---|---|---|
| AI简历服务 | 6 | 6 | 0 | 0 |
| 岗位信息 | 6 | 5 | 0 | 1（岗位大师，本轮已处理） |
| 招聘会 | 3 | 2 | 1 | 0 |
| 打印扫描 | 6 | 2 | 0 | 4 |
| AI面试训练 | 3 | 3 | 0 | 0 |
| 政策服务 | 3 | 0 | 3 | 0 |

结论：首页入口结构本身没有需要清理的死代码——所有 disabled 占位卡片都是诚实占位（显示"即将上线"），且都在 `next-tasks.md` 里有对应的、仍然打开着的待办条目在追踪。真正需要处理的是下面 5 项治理/文档问题，而非删除代码。

---

## 二、五项发现与处置结果

### 发现①：「岗位大师」两条路线冲突 —— ✅ 已裁定并执行

- **问题**：2026-07-03 的 IA 整合审计（[ia-consolidation-audit-2026-07-03.md §3⑧](./ia-consolidation-audit-2026-07-03.md)、[phase-a-checklist 第1项](./ia-consolidation-phase-a-checklist-2026-07-03.md)）拍板"岗位大师首页占位点亮时复用既有『岗位匹配参考』（2D）能力，不新增独立入口/路由"。但同期 `feature/job-master` 分支已做出完全独立的新功能（M1 决策报告 PDF + 打印闭环 + 首页磁贴点亮 + 独立路由 + 我的记录；M1.5 决策台深化），PR #117 冻结在 Draft（等待竖屏截图补齐）。
- **裁定（2026-07-11，用户拍板）**：采纳审计方案——合并复用，不采纳 job-master 的独立实现。
- **已执行**：
  1. [HomePage.tsx](../../apps/kiosk/src/pages/home/HomePage.tsx) 「岗位大师」磁贴从 `disabled: true` 改为 `to: '/resume/job-fit'`，复用既有 [JobFitPage.tsx](../../apps/kiosk/src/pages/resume/JobFitPage.tsx)（2D 岗位匹配参考），未新增路由/组件/页面。
  2. [ia-consolidation-audit-2026-07-03.md](./ia-consolidation-audit-2026-07-03.md) §2.1、§4⑧ 与 [phase-a-checklist 第1项](./ia-consolidation-phase-a-checklist-2026-07-03.md) 已补充 2026-07-11 执行记录。
  3. `feature/job-master`（PR #117）降级为素材参考，不再推进为独立入口；是否正式关闭该 PR，留给该分支的所有者/后续窗口处理，本次未触碰该分支或 PR 本身。
- **验证**：Kiosk `typecheck`、`eslint src/pages/home/HomePage.tsx` 均通过；mock 模式浏览器走查确认——未登录/无诊断记录时点击「岗位大师」正确进入 `/resume/job-fit` 并展示诚实空态"请先完成简历上传与诊断，再做岗位匹配参考" + 「去上传简历」引导，控制台无报错；未产生假数据或空白页崩溃。

### 发现②：「纸质扫描」文档滞后 —— ✅ 已修正

- **问题**：`user-data-flow-matrix.md` §3.4 与 `ia-consolidation-audit-2026-07-03.md` §2.1 都还标注"未打通/半成品（演示）"，但 `feature/real-scan` 已于 2026-07-10 完成全部 21 个任务并合并进 `main`（`ScanTask` 模型 + Agent `scan-watcher.ts` SMB 监听 + Kiosk 四页面接真，不再是 `mockFile()`）。
- **已执行**：三处文档（matrix §3.4 表格、matrix §六缺口清单、ia-consolidation-audit §2.1、phase-a-checklist 第3项）均已追加 2026-07-11 更正说明，结论统一为"代码级真实闭环，仅剩 Windows 真机物理验收未完成"。
- **未做**：不涉及任何代码改动；真机验收仍按 `next-tasks.md` 现有排期执行。

### 发现③：两个窗口正在改首页强相关页面 —— 未触碰，仅记录

- `codex/kiosk-bluewhite-ui01-20260711`：assistant/profile inkpaper 视觉细节 + 新 verify 脚本，工作树有未提交改动。
- `codex/ai-artifact-print-url-contract-20260711`：AI 产物打印 URL 契约重构，覆盖面试报告页、招聘会资料/参访计划页、我的文档页、职业规划页、求职材料库页、简历生成预览页等。
- **处置**：本轮核查与执行全程未修改上述两个工作树涉及的任何文件；`HomePage.tsx` 的改动范围（仅"岗位大师"一行）与两边改动路径均无重叠，交叉检查确认无冲突风险。

### 发现④：首页/AI助手下一版改版已在规划中 —— 未触碰，仅记录

- `codex/kiosk-home-service-preview-20260710`：7 个 docs 提交（首页/我的页/AI助手改版方向的定义与实施计划），未动 `apps/` 代码。
- **处置**：建议后续如需重新设计首页/我的页，先读该分支规划避免撞车；本轮未与之交互。

### 发现⑤：「云打印」卡片语义与「文档打印」重叠 —— ✅ 已裁定并执行（2026-07-12）

- **已执行（2026-07-11 本轮）**：`user-data-flow-matrix.md` §3.4"云打印"行已补充范围澄清备注：该卡片当前定义的"缺口/下一步"与「文档打印」已实现架构完全相同，真正点亮前必须先定义清楚增量能力（如第三方网盘拉取打印），否则应走与 job-master 同等的正式取舍流程（合并/隐藏），而非直接点亮。
- **裁定（2026-07-12，用户拍板）**：按 [2026-07-12-cloud-print-decision.md](./2026-07-12-cloud-print-decision.md) 的正式取舍评估（含两轮外部 Codex 只读评审），选择**选项 b：删除磁贴，能力归位「文档打印+手机扫码上传」**；真增量方向「远程提交·到店取件 / 跨终端释放」记入 next-tasks 商用二期候选（候选未立项）；`cloud_upload` 能力键词汇债另立独立任务分阶段并入 `phone_upload`，不随本次改动顺手处理。
- **已执行（2026-07-12）**：HomePage.tsx 删除该磁贴一行（打印扫描组 6→5 磁贴）；matrix §3.4/§六、本文档、ia-consolidation-audit §2.1、phase-a-checklist 第4项同步更新；验证记录见决策文档附录。

---

## 三、未开始能力排期建议（证件复印 / 证件照 / 格式转换 / U盘 / 签名盖章）

以下能力当前均为诚实 disabled 占位，`next-tasks.md`「P0：首期基础打印闭环」章节已有对应条目在追踪，本节仅补充建议的执行顺序与理由，不新增待办、不改变既有排期承诺：

| 顺序 | 能力 | 理由 | 前置依赖 |
|---|---|---|---|
| 1 | 格式转换 | 纯后端/服务能力，无需真实硬件即可开发与验证（生成真实派生文件后打印） | 无 |
| 2 | 签名盖章 | 同上，图形排版能力 + 非 CA 电子签免责声明 | 无 |
| 3 | U盘导入 | 需要 Terminal Agent 支持只读枚举，但不涉及采集敏感信息 | Terminal Agent 扩展 |
| 4 | 证件复印 / 证件照 | 涉及身份证等敏感信息的"采集→使用→删除→审计"全链路，安全设计门槛最高，且依赖真机验收 | Terminal Agent 复印能力 + 隐私合规设计 |

**执行方式必须遵循 CLAUDE.md §8.1 既定流程**：任何一项启动前，先用 `brainstorming` skill 明确范围与文件预算，产出设计文档并经审查，审查通过后才写代码——不得为求"首页看起来完整"而并行仓促堆四项。本文档不代表已启动上述任一项的实现。

---

## 四、验证记录

| 项目 | 结果 |
|---|---|
| Kiosk `pnpm typecheck` | 通过 |
| Kiosk `eslint src/pages/home/HomePage.tsx` | 0 error |
| 浏览器走查（mock 模式，540×960 竖屏） | 首页「岗位大师」磁贴点亮，跳转 `/resume/job-fit`，无诊断记录时展示诚实空态，控制台无报错 |
| 文档改动范围 | `user-data-flow-matrix.md`、`ia-consolidation-audit-2026-07-03.md`、`ia-consolidation-phase-a-checklist-2026-07-03.md`、本文档 |
| 代码改动范围 | 仅 `apps/kiosk/src/pages/home/HomePage.tsx` 一行（岗位大师磁贴） |

本次未触碰：`feature/job-master`、`feature/real-scan`（已合并，未回溯改动）、`codex/kiosk-bluewhite-ui01-20260711`、`codex/ai-artifact-print-url-contract-20260711`、`codex/kiosk-home-service-preview-20260710` 涉及的任何文件；未新增/删除首页入口结构；未做任何 git 分支/worktree 层面的删除或清理操作。
