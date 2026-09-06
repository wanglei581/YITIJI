# Windows Terminal Agent（概述）

> 本文件为概述索引，完整设计文档见：[windows-terminal-agent-design.md](./windows-terminal-agent-design.md)  
> 最后更新：2026-05-26（Phase 8 设计文档已完成）

---

## 快速参考

| 文档 | 说明 |
|------|------|
| [windows-terminal-agent-design.md](./windows-terminal-agent-design.md) | Phase 8 完整设计文档（10 节）|
| [pantum-cm2820adn.md](./pantum-cm2820adn.md) | 打印机硬件能力说明 |
| [../api/api-v1-design.md](../api/api-v1-design.md) | 后端 API 完整规范 |

## 一句话定位

运行在 Windows 一体机主机上的本地常驻服务，负责打印机、扫描仪、U 盘等硬件驱动交互，通过后端 API 与 Kiosk 前台连接。

## 关键约束

- 必须在 Windows 10/11 x64 独立运行，不依赖 macOS 环境
- 不依赖奔图云端打印 API（CM2800ADN/CM2820ADN 系列不支持远程扫描）
- Token 用 Windows DPAPI 加密保存，不明文存储
- 所有临时文件（简历/扫描件）任务结束立即删除
- API 失败绝不伪造成功

## Kiosk 启动票（2026-09-06）

1. Windows watchdog 在每次拉起 Edge/Chrome 前，仅向 loopback Agent `POST /local/terminal-boot-ticket` 请求启动票；watchdog 不读取 ProgramData、DPAPI 文件或长期 Agent 凭证。
2. Agent 用既有 `Authorization: Bearer <agentToken>` 和 `X-Terminal-Id` 调 API `POST /terminals/boot-ticket`，取得 Redis 中 60 秒、一次性的 `bootTicket`。
3. watchdog 将短票作为 URL `boot_ticket` 参数传给浏览器。Kiosk 用它兑换 30 分钟终端会话令牌，立即用 `history.replaceState` 清除 URL，令牌只保存到浏览器 `sessionStorage`。
4. 取票与浏览器端刷新均按 2 / 5 / 10 / 20 秒退避、总窗口不超过 60 秒。失败仍启动页面；页面在会话恢复前拒绝受保护下单，并在耗尽窗口后提示联系现场工作人员。

## MVP 范围（Phase 8.1）

心跳上报 + 打印任务执行 + 扫描任务执行 + 文件上传 + Windows 服务注册

详见：[windows-terminal-agent-design.md §9](./windows-terminal-agent-design.md#9-mvp-范围)
