## Antigravity 审查结论

Main 自身 3/3 CI 红比 self-assessment r3 收尾更急——§16 要求「最新部署必须保持 CI 双 job 通过」，main 自反规；r3 已本地全绿不阻塞主线。

**1. 优先修 G1 (#482) 恢复 CI 绿**。从干净 main 起 `fix/g1-offline-agencies-verify-converge`：改 #482 三页去掉 `StatsBand`/`jobCount`/`营业中`/`在招岗位`/`status==='open'`，加「服务时间以机构公示为准」，详情改走 `OfflineAgencyDetailPage` 而非 query 拼接 → 本地 typecheck/lint/三个 verify → push → CI 3/3 绿后再 push #486。

**2. G1 (#482) 漂移选 (a) 业务收敛**。§18 严禁解 metric 禁词；(b) 即便放过 `owned.length 23→24` + `/offline-agencies/:id`，kiosk-browser-smoke 仍会因 `在招岗位/营业中/jobCount` 触碰 fail-closed。(a) 无 §18 风险，且按 §4.5「找企业/线下机构」本就是「来源导览」非招聘平台，去 metric 不损合规能力。

**3. stacked-pr2 worktree 保留**。worktree 工作区干净、tip `3a593472` 实质内容（`tokenMatches` + `SelfAssessmentDimensionResult[]`）已在 main `5ca7ce0a2c`、§8.1 要求保留仍承载独有能力的基础锚点；保留零成本，删失败风险高。如要归档，先建只读盘点表（commit SHA/内容摘要/main 镜像证据）再 `worktree remove --force`。

**4. 未列高优先项**：
- 顺序：先 #482 → CI 绿 → push #486，避免叠 PR 加大审阅难度。
- 治理缺口：#482 合入时即 `0/3 checks passed` 仍被允许 squash，建议在 `AGENTS.md` 加「CI 0/3 不允许 squash」硬约束，避免下次自伤。
- offline-agencies 触碰 metric 案例应写进 `compliance-boundary.md` 注释段，钉住「§18 不为业务诉求解禁」。

**5. 风险预判**：
- 改 #482 三页外可能误触其他 verify 断言；防御：先 `rg` 全文 `营业中|在招岗位|jobCount|status==='open'` 确认改动范围。
- main 未修通就 push #486，r3 樱桃拣会被误判为引入回归，须先 #482 修绿。
- productionF1 仍 NO-GO，「修 G1 = 可上线」是误读；fresh retake 仍须用户单独授权，不在 Antigravity 推。

**我推荐的下一步是：从干净 main 起 `fix/g1-offline-agencies-verify-converge` 按 (a) 业务收敛恢复 CI 3/3 绿，再 push #486 把 self-assessment r3 入主。**
