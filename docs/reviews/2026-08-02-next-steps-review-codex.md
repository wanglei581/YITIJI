## Codex 审查结论

**(1) 优先推荐：先修 G1 (#482) verify 漂移，走 (a) 业务收敛路径**。理由：当前 `main` 三 job 全红是 G1 合入时即 `0/3 checks passed` 的遗留债，与 self-assessment 无关但阻塞所有后续门禁——红 CI 下做任何 P0 部署准备都不可信。执行计划：① 从 `main@e5a40df` 新建 worktree `fix/g1-offline-agencies-verify-drift-20260802`；② 改 `apps/kiosk/src/routes/agencies/OfflineAgenciesPage.tsx`：删 `StatsBand` 的 `jobCount/营业中/今日服务/在招岗位`，新增诚实文案 `服务时间以机构公示为准`，详情改独立路由 `/offline-agencies/:id` 而非 query 拼接；③ 修 TS verifier 漂移（`resolveOfflineListPage is not a function`）——同步 `verify:offline-agencies-page` 与 main tip；④ 跑 `verify:fusion-w4` 必须 `owned.length === 23`、路由允许 `:id`、metric 禁令满足；⑤ 双 CI 全绿后 squash 合 main。涉及 `apps/kiosk/src/routes/agencies/*`、`scripts/verify-offline-agencies-page.*`、不动 `verify-fusion-w4.mjs`。

**(2) G1 漂移选 (a)**：(b) 解 metric 禁令直接废掉 CLAUDE.md §18"不伪造能力"硬约束——`营业中/在招岗位/jobCount` 是上线前硬信号，解了就回不到合规区；"等别人修"无主且继续累积红 CI。owned.length 23→24 看似中性，但实际是把 metric 禁令一起解绑，代价远超收益。

**(3) stacked-pr2 worktree：保留**。其顶端 `3a593472` 实质内容虽已合 main，但 worktree 是 stacked PR 演进 lineage 唯一可追溯锚点；按 CLAUDE.md §8.1"必须保留仍承载独有能力的基础锚点"原则，不应删除。worktree 工作区干净、无未提交改动，保留成本为零、删除则断 lineage。无需 cherry-pick。

**(4) 未列出的高优先项**：① **offline-agencies 审计缺口**（`standards-index.md` §11 第 3 条）——adminReview/adminPublish/adminDelete 全程无 AuditLog，是真实活跃合规缺口，与 G1 同一 PR 顺手合最经济；② **审核控制不随内容变更重新生效**（§11 第 2 条）已登记多日，hash 方案未批前可做"内容指纹比对触发退审"最低成本 PoC；③ CI 红源下 P0 验收顺序失效——服务器/PG/Windows 真机验收无法依赖全绿门禁作为前置，应先修 CI 再排真机。

**(5) 风险预判**：① 删 StatsBand 字段可能误伤 admin 配置入口——防御：先 grep `StatsBand|在招岗位|营业中` 全仓确认无路由/无 admin 真实依赖；② `:id` 路由迁移若硬切会丢 query 拼接深链——防御：保留 query 拼接为 deprecated 兼容 + `console.warn` 提示至少一个窗口；③ verify-fusion-w4 `owned.length === 23` 是字面量，本轮仅改 G1 三页不会动到 23，但若顺手加 AuditLog 写入需先 dry-run 验证仍 23；④ squash 前确认 main 已含 #485（小程序登录）与 #481（AST 门禁完整修复）避免 rebase 文档冲突。

**我推荐的下一步是：从干净 main 新建 worktree 修 G1 (#482) verify 漂移走 (a) 业务收敛路径并顺带合上 offline-agencies 审计缺口，CI 双 job 全绿后再启动 P0 上线验收。**
