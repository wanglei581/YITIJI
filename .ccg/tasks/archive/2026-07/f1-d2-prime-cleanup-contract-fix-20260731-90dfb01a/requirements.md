# F1 D2′ cleanup / production-secret 合同修复

## 真实闭环

消除 D2′ 演练器在成功路径 cleanup 失败时仍可能输出 PASS / exit 0 的假通过，并让 user systemd 残留与生产凭据继承检查具备可验证、fail-closed 的离线合同。

## 功能归位与文件预算

- 后端运维脚本：`services/api/scripts/d2-same-host/run.sh`
- 离线合同：`services/api/scripts/d2-same-host/verify-contract.mjs`
- 正式环境变量样板：`services/api/.env.example`（仅补当前源码已读取的 TTS 凭据名，不写值）
- 正式进度：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`
- CCG 任务记录：本任务目录
- 预计运行时代码文件 1 个、验证文件 1 个、配置样板 1 个、正式进度文件 2 个；不新增依赖或并列工作流。

## 必须满足

1. 任何 cleanup 步骤失败都必须使最终进程退出非零，且成功标记只能在 cleanup 已证明成功后输出。
2. 停止 user systemd unit 后必须重新查询并证明 unit inactive；命令失败、仍 active/activating/deactivating/failed 或结果不可判定均 fail-closed。
3. production secret denylist 必须覆盖仓库正式配置中可能用于生产数据平面的真实变量名，并拒绝任何已设置值（包括空占位）；不得读取、打印或持久化变量值。
4. 必须先新增会在当前代码上因上述缺口而失败的离线合同，再做最小实现并验证 GREEN。
5. 同步正式进度；多模型终审无 Critical 后方可提交。

## 明确不做

- 不启动 Colima、PM2、Nginx、systemd unit 或 API 进程。
- 不运行 `drill:d2-same-host` full drill，不生成 nonce/evidence。
- 不连接 production，不读取真实 `.env`、凭据值、数据库、Redis 或对象存储。
- 不修改业务 API、前端、数据库 schema、部署配置或 D3–D6 文档输入。
- 不引入新依赖，不顺手重构其他 D2′ 模块。

## 验证

- RED：新增合同在当前实现上因 cleanup / systemd / denylist 缺口失败。
- GREEN：`pnpm --filter @ai-job-print/api verify:d2-same-host-contract`
- `bash -n services/api/scripts/d2-same-host/run.sh`
- 相关 Node 语法、API lint/typecheck/build、`git diff --check`
- Claude + Antigravity + Cursor/Codex 终审。
