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

## MVP 范围（Phase 8.1）

心跳上报 + 打印任务执行 + 扫描任务执行 + 文件上传 + Windows 服务注册

详见：[windows-terminal-agent-design.md §9](./windows-terminal-agent-design.md#9-mvp-范围)
