# F1 D2 Prime Draft PR 与 CI

- 用户在明确说明“下一步需授权创建 PR，创建后才能触发精确 HEAD CI”后回复“可以，继续”。
- 创建 Draft PR 到 `main`，不得合并、部署或修改生产资源。
- PR 必须说明当前候选没有自身 fresh full-drill evidence，D2′ 与 `productionF1` 仍 NO-GO，D3 未授权。
- 监控 PR 精确 HEAD 的必需 CI；失败时只诊断/修复仓库内问题，不绕过门禁。
- 推送后发现 `origin/main` 已前进到 `06c7fe00`，且 #448 与候选重叠修改 D2/XDG 脚本和进度文档；创建 PR 前必须先安全同步最新主线、保留双方有效修复并重新验证/审查。
- 完成后同步正式进度，归档 CCG 任务；任何后续 retake、D3、合并或部署都需要新的明确授权。
