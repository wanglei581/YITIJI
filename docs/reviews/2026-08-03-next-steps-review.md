# 2026-08-03 下一步推荐双模型审查

> 主审查代理:Claude(汇总)
> 独立审查:Antigravity + Codex
> 审查范围:main 顶 2fa2bf3b + P0 上线验收清单 + 未合入 main 的关键内容 + 下一轮改进候选

---

## ① 一致结论:本地可验项已全绿

两份审查**独立得出同一结论**:

| 项 | 状态 |
|---|---|
| CI 3/3 PASS | ✅ (build-and-verify / kiosk-browser-smoke / postgres-readiness) |
| `pnpm build` 全通过 | ✅ |
| `verify:compliance` / `verify:assess-isolation` / `verify:self-assessment` | ✅ ALL PASS |
| 密钥轮换(百度 OCR / 腾讯 COS / SMS) | ✅ 2026-06-13 / 2026-07-25 历史完成 |
| seed 默认口令 | ✅ 2026-07-25 bcrypt + tokenVersion++ |

## ② 一致结论:`productionF1` 仍 NO-GO

CI 全绿 ≠ 生产就绪。两份审查明确列出 **必须用户/法务/现场完成** 的剩余项:

| 阻塞项 | Owner | 必备 |
|---|---|---|
| §2.3 用户协议 / 隐私政策法务审定 | **法务** | 正式签字定稿 |
| §2.2 腾讯 COS 生命周期人工截图存档 | 用户 | 腾讯云控制台截图 |
| §2.2 LLM 生产专用 Key | 用户 | 签发新 Key 进 `.env` |
| §3.4 PostgreSQL 生产实例空库部署 | 用户 | pre-production 演练 |
| §五 Windows 一体机真机验收 | 用户 | 奔图 CM2820ADN 真机 |
| §六 1 台终端 + 1 台打印机试运营 | 用户 + 现场人员 | 试运营数据 |

---

## ③ 一致结论:合入 `f7d36064` 治理文档(高优先)

**两份审查均列为 P0 第一项**。

**commit f7d36064 内容**:

1. `AGENTS.md` 新增「CI 与合并门禁」:CI 必须 100% passes 才能 squash/merge;唯一例外是「失败源已由独立 verify 守护 + PR 改动明确证明无关」(典型反例:跨 wave fix);CI quota 耗尽禁止 squash。

2. `CLAUDE.md §8.2` 摘要同款规则(对 Claude 自身强制)。

3. `docs/compliance/compliance-boundary.md §4.6` 新增长期红线「业务指标诚实化」:
   - §4.6.1 禁止字段清单(`营业中` / `jobCount` / `今日服务` / `distanceKm` 等不得 mock)
   - §4.6.2 零数据必须降级诚实文案(5 条固定降级措辞)
   - **§4.6.3 反向闸门**:业务诉求不得作为解禁 verify 硬约束的依据
   - §4.6.4 案例记录:PR #482 G1 三页违规场景(防复盘)

**合入命令**:
```bash
git checkout main && git pull
git cherry-pick f7d36064
# 解冲突后 push
```

---

## ④ 分支清理建议(去重后)

按 CLAUDE.md §8.1 标准,两份审查一致认为可立即删:

| 分支 | 证据 | 操作 |
|---|---|---|
| `feature/staged-pr1-self-assessment-shared` | 内容已合 PR #473 | `git branch -d` + `git push origin --delete` |
| `feature/staged-pr2-self-assessment-server` | 内容已合 PR #475 | 同上 |
| `feature/staged-pr3-self-assessment-frontend` | 内容已合 PR #476 | 同上 |
| `fix/self-assessment-staged-cleanup` | 内容已关 PR #484 | 同上 |
| `fix/ci-restore-pg-wxopenid-and-w6-route` | 内容已合 PR #488/#489 | 同上 |
| `fix/g1-offline-agencies-verify-drift-20260802` | 内容已被 PR #489 替代 | 同上 |
| `fix/d2-cleanup-not-found-contract` | 落后 | 同上 |
| `fix/deepseek-v4-model-20260725` | v4-flash 热修已过时 | 同上 |

**`fix/self-assessment-staged-cleanup-r3` 暂保留**:其 tip `f7d36064` 是 §③ 要合入的治理文档,合入后该分支 tip 落后 main 即可删。

**`origin/feat/member-print-orders-failure-reason`** 仅 Codex 提及(ahead of main 2),含失败原因安全回显真实功能 — **保留**,择期 review。

**30+ 条 `origin/claude/*` / `origin/codex/*` stale remote-tracking ref**:Antigravity 列出具体列表;按 §8.1「区分真实远程 head 与 stale remote-tracking ref」,**未授权前不得 `git remote prune`**。

---

## ⑤ 下一轮推荐(汇总)

### P0(可代办)

1. **合入 f7d36064 治理文档**(§③)

### P1(可推进,风险低)

2. **打印任务状态实时追踪 UI**:`docs/progress/next-tasks.md` §9 已有;纯前端改进,不碰合规/支付/硬件。

3. **G1 业务收敛合规收口二次审查**(Antigravity 风险预警):PR #487/#489 已合,但 `apps/kiosk/src/routes/offline-agencies/` 三文件须逐一对照 §4.6.1 禁止字段清单(本地可代办,无功能改动)。

### P2(择期)

4. **场馆导览 Partner 配置入口**(择期 P1,`next-tasks.md` 已有)
5. **告警中心**(`next-tasks.md` §P2 已有)
6. **打印任务状态实时追踪 UI 扩展**:WebSocket 推送(需 Terminal Agent 配合)

---

## ⑥ 风险预警(双模型均提及)

**R1(高)— CI 0/3 仍可被绕过**:`fix/self-assessment-staged-cleanup-r3` 未合 main,意味着 verify 反向闸门规则不在生产主干;下次 PR 评审如果只看 CI 仍可能重演 PR #482 事件。**§③ 合入 f7d36064 是唯一根治手段**。

**R2(中)— 误读为可上线**:`productionF1` NO-GO,需主动传达给团队。

**R3(中)— Stale 远程分支积累**:Antigravity 列出 30+ 条候选,但需 owner 明确授权后再清理,避免误删仍有复活可能的能力分支。

**R4(低)— AGENTS.md co-author 标注**:f7d36064 含 `Co-authored-by: Cursor <cursoragent@cursor.com>`,合入 main 时会显示 Cursor co-author;不影响功能,需确认项目 co-author 政策。

---

## ⑦ 给用户的最终建议(按可代办性排序)

| 顺序 | 行动 | 谁能做 | 阻塞 P0 上线? |
|---|---|---|---|
| 1 | 合入 `f7d36064` 治理文档(cherry-pick + PR) | Claude(执行)+ 用户(squash) | 否,但防 PR #482 复演 |
| 2 | §2.2 腾讯 COS 生命周期截图存档 | 用户 | **是** |
| 3 | §2.2 LLM 生产专用 Key 签发 | 用户 | **是** |
| 4 | §2.3 用户协议 / 隐私政策法务审定 | 法务 | **是** |
| 5 | §3.4 PostgreSQL 生产实例空库部署演练 | 用户 | **是** |
| 6 | §五 Windows 一体机真机验收(打印机/扫描/U盘) | 用户 + 现场 | **是** |
| 7 | §六 1 台终端 + 1 台打印机试运营 | 用户 + 现场 | **是** |
| 8 | Stale 远程分支清理(明确授权后) | 用户(授权)+ Claude(执行) | 否,卫生项 |
| 9 | 下一轮 P1(打印任务状态实时追踪 UI / G1 二次审查) | Claude | 否 |

**Claude 可立即代办(已就绪待用户点头)**:
- 第 1 项:合入 f7d36064
- 第 9 项:P1 候选

**用户必须代办**:
- 第 2-7 项:全部 P0 验收清单阻塞项
- 第 8 项:stale 分支清理授权

---

## 附录:审查上下文

- 主分支:main `2fa2bf3b`
- 当前 P0 验收快照:`docs/device/production-deployment-and-windows-host-checklist.md` 顶部(2026-08-03)
- 未合入关键 commit:`f7d36064`(`fix/self-assessment-staged-cleanup-r3` tip)
- Antigravity 完整结论:见子代理输出 `177bd997-4bc3-486f-aa90-69be16e818d3`
- Codex 完整结论:见子代理输出 `9aa117b0-6946-4212-b4de-5d4db1d08807`