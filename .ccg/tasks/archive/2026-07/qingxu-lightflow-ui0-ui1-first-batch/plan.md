# 青序 LightFlow UI-0 / UI-1 第一批 CCG 执行计划

## 权威实施计划

`docs/superpowers/plans/2026-07-11-service-desk-ui0-ui1-first-batch.md`

## 执行分层

1. 基线：确认分支、主线、冲突集合、文件行数与既有 verify。
2. UI-0：共享主题、密度、三端壳层合同；验证 RED 后实现 GREEN。
3. UI-1：UI-0 GREEN 后，按不重叠文件所有权并行迁移 Kiosk 首页、Admin 工作台、Partner 岗位管理；每批先 RED 再 GREEN。
4. 集成：运行全量工程门禁，做视口矩阵与真实浏览器实点。
5. 审查：规格合规审查、代码质量审查、Antigravity + Claude 双模型审查；Critical 修复后重审。
6. 收口：按实际证据更新两份进度 SSOT，精确暂存和提交，归档本 CCG task。

## 并行文件所有权

- UI-0 实现者：只能修改 Batch A。
- Kiosk 实现者：只能修改 Batch B。
- Admin 实现者：只能修改 Batch C。
- Partner 实现者：只能修改 Batch D。
- 主代理：只负责集成、审查修正协调、Batch E 与 CCG 归档。

UI-1 三批必须等 UI-0 GREEN 后才能启动；相互不得修改对方文件。
