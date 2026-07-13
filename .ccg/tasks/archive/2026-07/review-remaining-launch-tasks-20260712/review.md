# 上线与青序 LightFlow 剩余任务盘点

## 结论

- 当前最短闭环是 UI-0/UI-1 代表页用户验收与 CI 门禁接入授权；尚未启动 UI-2。
- 若目标是上线或试运营，P0 的部署安全、生产依赖、Windows 真机、法务合规和小范围试运营仍是优先阻塞项。
- 本次仅读取 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`，未改运行时代码、进度 SSOT 或部署状态。

## 关键后续顺序

1. 完成代表页视觉/真实流程验收，并在独立授权范围内把 4 个 LightFlow verify 接入 CI。
2. 处理 P0 的 PrintTask seed reload 防复发、`printFileUrl` 无出纸动态探针与每次部署的 DP-GATE。
3. 完成生产域名 HTTPS、PostgreSQL/Redis/COS、生产环境变量、短信与 AI/OCR/TRTC/ASR/TTS live 验收。
4. 完成 Windows 一体机的真实 Kiosk PDF/图片打印、状态一致性、至少两种异常恢复与扫描链路验收。
5. 完成法务合规与单台终端试运营，再按独立任务推进 UI-2 及其余产品路线。
