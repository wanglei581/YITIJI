# Windows Terminal Agent 设计文档

> 版本：v1.5（Phase 8.1D E2E 打印链路验证完成）  
> 创建时间：2026-05-26  
> 最后更新：2026-05-28（v1.5：Phase 8.1D E2E 真机打印链路验证完成 — register→claim→download→MD5→print→PATCH→出纸；断网重试/单实例/服务安装专项补验移至 Phase 8.2C；local-api-server/actionToken HMAC/lease续租移至 Phase 8.2C；v1.4：Phase 8.1C 实现 — DPAPI/SQLite/PID锁/断网重试/Windows服务）  
> 状态：Phase 8.0–8.1D E2E 打印链路验证封板；Phase 8.2A（Prisma 持久化）/ 8.2B（WMI 状态查询）/ 8.2C（安全加固 + 专项补验）待开发  
> 关联文档：[pantum-api-design.md](./pantum-api-design.md) | [api-v1-design.md](../api/api-v1-design.md) | [CLAUDE.md](../../CLAUDE.md)

---

## 目录

1. [Agent 定位](#1-agent-定位)
2. [核心能力](#2-核心能力)
3. [模块划分](#3-模块划分)
4. [与后端 API 的接口契约](#4-与后端-api-的接口契约)
5. [打印流程](#5-打印流程)
6. [扫描流程](#6-扫描流程)
7. [安全要求](#7-安全要求)
8. [Windows 兼容性](#8-windows-兼容性)
9. [MVP 范围与技术验证清单](#9-mvp-范围与技术验证清单)
10. [风险清单](#10-风险清单)
11. [附录：技术选型建议](#11-附录技术选型建议)

---

## 1. Agent 定位

### 1.1 总体定位与双进程架构

Windows Terminal Agent（以下简称 Agent）是运行在一体机 Windows 主机本地的**后台常驻服务**，承担前端 Kiosk 网页无法直接触达的硬件交互职责。

由于 Windows 服务（LocalSystem 账号）和用户桌面 Session 是隔离的，而 TWAIN/WIA 扫描驱动、扫码器、摄像头等设备**必须在用户 Session 中访问**，Agent 采用**双进程架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Windows 一体机主机                         │
│                                                                  │
│  ┌──────────────────┐                                            │
│  │  Kiosk 前台网页   │                                            │
│  │  (Edge Kiosk 模式)│                                            │
│  │                  │◄── localAuthToken (查询) ──────────────┐   │
│  │                  │◄── actionToken    (动作) ──────────────┤   │
│  └──────────────────┘                                        │   │
│                                                               │   │
│  ┌────────────────────────────────┐  Named Pipe + ACL  ┌─────▼──────────────────┐ │
│  │  AIJobPrintAgent Service       │◄──────────────────►│  Session Helper        │ │
│  │  (Windows Service / LocalSystem)│                   │  (用户 Session 进程)    │ │
│  │                                │                   │                        │ │
│  │  · 心跳上报                     │                   │  · TWAIN/WIA 扫描       │ │
│  │  · 任务 claim/回传              │                   │  · 扫码器输入拦截        │ │
│  │  · 文件上传                     │                   │  · 摄像头采集            │ │
│  │  · 临时文件清理                  │                   │                        │ │
│  │  · local-api-server:9527       │                   └─────────┬──────────────┘ │
│  │  · 日志、重启管理               │                             │                │
│  └───────────┬────────────────────┘             ┌──────────────▼──────────────┐  │
│              │                                  │  打印机驱动（奔图）           │  │
│              │ HTTPS                            │  TWAIN / WIA 驱动            │  │
│              │                                  │  USB / HID 设备              │  │
│              │                                  └─────────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────────────────────────┘
               │
        ┌──────▼──────────────┐
        │    后端 API          │
        │  services/api        │
        │  /api/v1/...         │
        └─────────────────────┘
```

**Named Pipe 通信**：Service 进程创建命名管道 `\\.\pipe\AIJobPrintAgent`，ACL 设置如下：

- **允许**：AIJobPrintAgent Service SID（SYSTEM / LocalService）、当前登录用户 SID（Session Helper）、BUILTIN\Administrators 组
- **禁止**：Everyone / Users / Authenticated Users 泛权限

Helper 启动后向管道连接并接收扫描/扫码/摄像头指令，执行后将结果写回管道。**localhost 127.0.0.1:9528** 作为 Named Pipe 不可用时的备用通道（Service 内部），该端口**仅允许 Service 与 Helper 通信，不接受 Kiosk 请求**，双向鉴权需校验 `service-helper-shared-token`（Service 启动时生成，与 Helper 进程共享）；Kiosk 请求仍走 9527 端口的 local-api-server。

**Session Helper 生命周期**：Service 在用户登录后检测到活跃 Session 时启动 Helper（通过 `CreateProcessAsUser`）；用户注销时 Helper 退出，Service 继续运行；Helper 崩溃时 Service 自动重启 Helper。

### 1.2 与 Kiosk 前端的关系

Kiosk 前端（Chrome/Edge Kiosk 模式）是纯 Web 应用，无法直接操作本地硬件。Agent Service 在本地提供 HTTP 服务（`http://127.0.0.1:9527`），**仅监听 127.0.0.1，不对外暴露**。

CORS 白名单（`http://localhost:5173` 等）是浏览器层辅助控制，**不能作为唯一安全边界**，必须配合 Token 校验。

| 场景 | Kiosk 发起 | 鉴权方式 | Agent 响应 |
|------|-----------|---------|----------|
| 查询设备状态 | `GET /local/status` | `localAuthToken` | 返回打印机、扫描仪状态 |
| 轮询扫描结果 | `GET /local/scan/:id` | `localAuthToken` | 返回进度或已完成的文件 URL |
| 获取 U 盘文件 | `GET /local/usb/files` | `localAuthToken` | 返回 U 盘可打印文件列表 |
| 发起打印 | `POST /local/print` | `actionToken`（一次性） | 创建本地打印任务，返回 taskId |
| 发起扫描 | `POST /local/scan` | `actionToken`（一次性） | 触发扫描，返回 scanId |
| 触发 U 盘打印 | `POST /local/usb/print` | `actionToken`（一次性） | 打印 U 盘指定文件 |

**localAuthToken**：终端注册完成后由 Agent 生成并加密保存，同时通过注册响应附带给后端，后端在 Kiosk 初始化时下发。Kiosk 在所有查询类请求头中携带：`Authorization: Bearer <localAuthToken>`。

**actionToken 签发语义**：Kiosk 创建打印/扫描任务时，后端在创建任务响应中一并签发 `actionToken`（携带 `terminalId + action + taskId + expiresAt + nonce` 的 HMAC 签名），Kiosk 将 `actionToken` 随任务 ID 传给 Agent。**Agent 不主动申请 token**，仅校验与 `taskId` 绑定的 token 是否合法并在有效期内（默认 5 分钟），校验通过后执行动作；SQLite 标记 nonce 已使用防重放。以下情形返回 **403**：Token 过期、nonce 已被使用、action 不匹配当前请求、签名校验失败。

### 1.3 与后端 API 的关系

Agent 是后端 API 的**主动客户端**（非被动服务端）：

| 方向 | 内容 |
|------|------|
| Agent → 后端 | 终端注册、心跳上报、设备状态、任务 claim、状态回传、扫描文件上传、告警 |
| 后端 → Agent | 打印任务（Agent 主动 claim）、配置下发（心跳响应中携带） |

### 1.4 与硬件设备的关系

| 设备 | 型号 / 标准 | 接入进程 | 接入方式 |
|------|------------|---------|---------|
| 打印机 | 奔图 CM2800ADN/CM2820ADN 系列（有线网络；Windows 识别名：`Pantum CM2800ADN Series`） | Service | Windows GDI Print API |
| 扫描仪 | CM2800ADN/CM2820ADN 内置扫描（ADF 50 页） | Helper | TWAIN / WIA 驱动（优先）；SMB 目录监听（备用） |
| U 盘 | USB 存储设备 | Service | Windows 卷挂载事件监听 |
| 摄像头 | 可选外接 USB 摄像头 | Helper | WIA / DirectShow（Phase 8.3） |
| 扫码器 | USB HID 键盘模拟扫码枪 | Helper | node-hid 输入拦截（Phase 8.3） |

> 重要约束（CLAUDE.md §3）：CM2800ADN/CM2820ADN 系列无 WiFi 仅有线网络；不支持 A3；无云端远程发起扫描的开放 API。

---

## 2. 核心能力

### 2.1 终端注册

Agent 首次启动时向后端注册本终端，获取 `terminalId` 和 `agentToken`：

- 读取本机 MAC 地址 / 机器码作为唯一标识
- 携带 Agent 版本、操作系统版本、IP 地址
- 生成本地 `localAuthToken`（32 字节随机值）一并提交，后端保存并下发给 Kiosk
- 注册成功后将 `terminalId` + `agentToken` + `localAuthTokenSecret`（用于 actionToken 验签）加密保存
- **`actionTokenSecret` 每台终端独立生成**，支持后端吊销和轮换；终端重置或重新注册时重新下发。长期可升级为后端私钥签发、Agent 公钥验签的方案。
- 重启时若本地已有 Token，跳过注册改为心跳验证
- 后端可设置终端为"待审核"状态，未审核终端心跳被拒绝

### 2.2 心跳上报

每 30 秒向后端发送一次心跳，携带：终端在线时间、打印机状态快照、磁盘可用空间、Agent 版本、当前活跃任务 ID。心跳响应中可携带配置下发（轮询间隔、日志级别等）。连续 3 次失败后写日志告警并尝试重新注册。

### 2.3 设备状态采集

每 60 秒采集并上报打印机（在线/离线、纸张、墨粉、故障码）、扫描仪（就绪/忙碌/故障）、磁盘（可用空间）、网络（心跳连通性）。状态变化时立即上报，不等定时周期。

### 2.4 打印任务 Claim

每 5 秒调用 `POST /api/v1/terminals/:terminalId/tasks/claim`（原 GET + PATCH 方案，改为原子 claim）：

- 后端**原子**将 `pending` 任务状态变为 `claimed`，写入 `claimedBy`（terminalId）和 `claimExpiresAt`（当前时间 + 5 分钟），防止多实例重复领取
- Agent 收到 claim 响应后立即在本地 SQLite 记录 `taskId + claimedAt`，即使网络随即断开也不会丢失任务
- Agent 崩溃或断网超过 `claimExpiresAt` 后，后端自动将任务重置为 `pending`，可被重新领取
- 一次最多 claim 3 条，防止同时执行过多任务
- **续租**：长时间任务（打印大文件 / 扫描 50 页 ADF）超过 `claimExpiresAt` 前，Agent 通过 `PATCH /api/v1/terminal-tasks/:id/lease` 续租 5 分钟，最多 3 次（总 lease 最长 20 分钟），超限则放弃并上报 `failed`，错误码 `LEASE_RENEW_FAILED`

### 2.5 打印任务执行

1. 下载打印文件到本地临时目录（临时签名 URL，有效期 10 分钟）
2. 校验文件 MD5 与后端下发值比对
3. 调用 Windows GDI Print API 或 PowerShell，指定奔图打印机、份数、双面设置
4. 轮询 Windows 打印队列（每秒），实时更新任务进度
5. 打印完成 / 失败后立即删除临时文件

### 2.6 打印状态回传

状态流转：`pending → claimed → printing → completed / failed`

每次状态变更 `PATCH /api/v1/print-tasks/:taskId/status`，`completed` 只上报一次（幂等）。API 失败时保留"待上报"状态，网络恢复后重试，不伪造成功。

### 2.7 扫描任务执行

1. Kiosk 携带有效 actionToken 调用 `POST /local/scan`
2. Agent 验证 actionToken，向后端创建 scan-task 记录获取 `scanId`
3. Service 进程通过 Named Pipe 向 Helper 进程发送扫描指令（含参数）
4. Helper 通过 TWAIN/WIA 触发扫描仪，将输出文件路径写回 Named Pipe
5. Service 接收文件路径，执行多页合并（→ 单 PDF）、上传、回传结果

**备用路径**：Helper 不可用时（用户未登录/TWAIN 不可用），Service 切换到 SMB 目录监听模式，等待用户从打印机面板发起扫描到共享目录。

### 2.8 扫描文件上传

- `multipart/form-data` 上传到 `POST /api/v1/files/upload`
- 携带 `terminalId`、`scanId`、`fileType`、`pageCount`
- 上传成功后立即删除本地临时文件
- 上传失败重试最多 3 次（2s / 4s / 8s），最终失败上报 scan-task failed

### 2.9 U 盘文件读取

- 监听 Windows `WM_DEVICECHANGE` / `drivelist`，检测 USB 存储挂载
- 插入后扫描根目录（深度 ≤ 2 层），返回 PDF / DOCX / JPG / PNG 文件
- Kiosk 轮询 `GET /local/usb/files`（需 localAuthToken），U 盘拔出时清空列表

### 2.10 本地文件临时缓存与自动清理

- 所有临时文件写入 **`%ProgramData%\AIJobPrintAgent\temp\`**（以日期命名子目录）
- 目录 ACL：**仅 Agent 服务账号和管理员组可读写**，普通用户账号无权限
- **打印文件**：打印结束（成功或失败）后立即同步删除
- **扫描文件**：上传后端成功后立即删除；上传失败则保留最多 30 分钟供重试
- **定时兜底清理**：每小时扫描临时目录，删除超过 60 分钟的所有文件，无例外
- 日志不记录文件完整路径（仅记录扩展名，防止泄露文件名中的用户信息）

### 2.11 外设状态检测

| 外设 | 检测方式 | 上报时机 |
|------|---------|---------|
| 打印机 | Windows 打印驱动查询 / WMI（Service） | 每 60s + 状态变化时 |
| 扫描仪 | TWAIN Source Manager（Helper）/ Named Pipe 查询 | 每 60s |
| U 盘 | USB 挂载/卸载事件（Service） | 事件驱动 |
| 网络 | HTTP ping 后端 /health（附在心跳中） | 每 30s |
| 磁盘 | WMI / `fs.statSync`（Service） | 每 60s + 低于 500MB 时告警 |

### 2.12 单实例锁

Agent 启动时创建 **Windows 全局 Mutex**（`Global\AIJobPrintAgentSingleton`）：

- Mutex 创建成功：继续启动流程
- Mutex 已存在（另一实例正在运行）：写日志 `DUPLICATE_INSTANCE_DETECTED`，`process.exit(1)`
- 无论正常退出还是崩溃，Windows 自动释放 Mutex，下次启动可重新创建
- Windows 服务的"崩溃自动重启"机制天然保证 Mutex 释放后重启不会死锁

---

## 3. 模块划分

```
apps/terminal-agent/
  src/
    agent-core/          # 入口、Mutex 加锁、生命周期、模块协调、事件总线
    session-helper/      # User Session Helper 进程入口（独立进程，Named Pipe 客户端）
    device-manager/      # 外设状态汇总（聚合 Service + Helper 数据）、告警触发
    printer-service/     # 打印任务执行、GDI Print API、队列轮询
    scanner-service/     # Named Pipe 扫描指令发送、SMB 目录监听备用
    scanner-helper/      # TWAIN/WIA 实际执行（运行于 session-helper 进程中）
    usb-service/         # U 盘挂载监听、文件枚举
    file-cache-service/  # %ProgramData%\AIJobPrintAgent\temp\ 管理、自动清理
    api-client/          # 后端 HTTP 请求封装、重试、agentToken 鉴权
    task-runner/         # 任务 claim、防重复、状态机、超时
    heartbeat-service/   # 定时心跳上报、配置热更新
    local-api-server/    # 127.0.0.1:9527；localAuthToken + actionToken 验证
    named-pipe/          # Named Pipe 服务端（Service）+ 客户端（Helper）封装
    logger/              # 结构化 JSON 日志、敏感字段脱敏
  config/
    agent-config.json    # 终端配置（API 地址、打印机名、轮询间隔、Named Pipe 名称）
  data/
    agent.db             # SQLite（任务幂等、nonce 去重、待上报状态）
```

### 模块职责说明

#### agent-core

- 程序入口：先获取单实例 Mutex，失败则退出
- 读取配置、初始化所有模块
- 管理启动顺序：注册/验证 Token → 启动 Named Pipe 服务端 → 启动 Helper → 启动心跳 → 启动任务轮询 → 启动本地 API
- 捕获 `uncaughtException` / `unhandledRejection`，写日志后 `process.exit(1)` 触发服务重启

#### session-helper

- 独立进程，由 agent-core 通过 `CreateProcessAsUser` 在用户 Session 中启动
- 连接 Named Pipe，等待扫描/扫码/摄像头指令
- 调用 scanner-helper（TWAIN/WIA）执行扫描，将结果文件路径写回 Pipe
- 崩溃时由 agent-core 检测并重启

#### device-manager

- 聚合 printer-service（Service 侧）和 scanner-helper 状态（通过 Named Pipe 查询 Helper 侧）
- 维护设备状态快照，变化持续 5 秒后触发告警，避免瞬时误报

#### printer-service

- 封装 Windows GDI Print API（`node-printer` 或 PowerShell `Start-Process -Verb Print`）
- 维护打印任务状态机（claimed → printing → completed/failed）
- 轮询打印队列状态（每秒），不依赖事件推送

#### scanner-service（Service 侧）

- 向 Named Pipe 发送扫描指令，等待 Helper 返回文件路径
- 备用方案：`chokidar` 监听 SMB 共享目录，等待打印机扫描落地
- 多页合并为单 PDF（`pdf-lib`），提供 `scan(settings)` → `Promise<{filePath, pageCount}>`

#### scanner-helper（Helper 侧）

- 运行于 session-helper 进程，调用 TWAIN 数据源管理器触发扫描
- 备选：PowerShell 调用 WIA COM 组件
- 将扫描输出文件路径写回 Named Pipe

#### file-cache-service

- 管理 `%ProgramData%\AIJobPrintAgent\temp\` 目录
- `allocateTempFile(ext)` 返回唯一临时路径；`release(filePath)` 立即同步删除
- 后台定时任务：每小时清理超过 60 分钟的全部文件，无豁免

#### api-client

- 封装所有后端 `/api/v1/...` HTTP 请求
- 请求头自动携带 `X-Terminal-Id` 和 `Authorization: Bearer <agentToken>`
- 4xx 不重试，5xx / 网络错误最多重试 3 次（指数退避）
- **HTTP 失败绝不伪造成功响应**

#### task-runner

- 每 5 秒 `POST /api/v1/terminals/:terminalId/tasks/claim`，分发给 printer-service 或 scanner-service
- SQLite 记录每个 taskId 的处理状态，防止重复执行
- 任务超过 10 分钟未完成自动标记失败并上报

#### heartbeat-service

- 每 30 秒 POST /terminals/heartbeat
- 解析响应中的配置下发，更新内存配置
- 连续 3 次失败后告警并尝试重新注册

#### local-api-server

- **仅监听** `127.0.0.1:9527`，绝不 bind `0.0.0.0`
- CORS 白名单（`http://localhost:5173` 等）作为浏览器辅助控制，**不作为唯一安全边界**
- **查询类接口**（GET /status、GET /scan/:id、GET /usb/files）：验证请求头 `Authorization: Bearer <localAuthToken>`，不匹配返回 **401**
- **动作类接口**（POST /print、POST /scan、POST /usb/print）：验证请求体中的 `actionToken`，校验 HMAC 签名、expiresAt、nonce 唯一性、action 字段与路由匹配，任一失败返回 **403**
- 所有接口失败时不伪造成功，返回准确错误码

#### named-pipe

- Service 侧：创建命名管道 `\\.\pipe\AIJobPrintAgent`，设置 ACL（仅 Service SID + Helper SID）
- Helper 侧：连接管道，JSON 消息协议（`{ type, payload, requestId }`），支持请求/响应配对
- 备用：若管道不可用，降级为 `http://127.0.0.1:9528`（仅 Service 与 Helper 使用，双向鉴权校验 `service-helper-shared-token`，不接受 Kiosk 请求）

#### logger

- 结构化 JSON 日志，写入 `%ProgramData%\AIJobPrintAgent\logs\`，按日期滚动，保留 30 天
- 脱敏规则：只记录文件扩展名、taskId，不记录文件路径、文件内容、用户姓名/身份证/手机号、actionToken 明文

---

## 4. 与后端 API 的接口契约

### 4.1 POST /api/v1/terminals/register

Agent 首次注册，获取 terminalId、agentToken 和 actionTokenSecret。

**请求体**

```json
{
  "machineId": "sha256-of-mac-address",
  "hostname": "KIOSK-001",
  "ip": "192.168.1.100",
  "os": "Windows 11 x64 23H2",
  "agentVersion": "1.0.0",
  "printerName": "Pantum CM2800ADN Series",
  "localAuthToken": "<32-byte-random-hex>"
}
```

**响应**

```json
{
  "terminalId": "term-abc123",
  "agentToken": "<jwt-or-opaque-token>",
  "actionTokenSecret": "<hmac-signing-secret>",
  "config": {
    "heartbeatIntervalSec": 30,
    "taskPollIntervalSec": 5,
    "claimLeaseSec": 300,
    "logLevel": "info"
  }
}
```

> `agentToken` 和 `actionTokenSecret` 只在注册响应中出现一次，必须立即 DPAPI 加密保存。

### 4.2 POST /api/v1/terminals/heartbeat

**请求体**

```json
{
  "terminalId": "term-abc123",
  "uptimeSeconds": 3600,
  "agentVersion": "1.0.0",
  "printer": {
    "online": true,
    "paperStatus": "ok",
    "tonerCyan": 85,
    "tonerMagenta": 82,
    "tonerYellow": 90,
    "tonerBlack": 78,
    "faultCode": null
  },
  "disk": { "tempDirFreeGB": 12.4 },
  "activeTaskId": null
}
```

**响应**

```json
{
  "ok": true,
  "config": {
    "heartbeatIntervalSec": 30,
    "taskPollIntervalSec": 5
  }
}
```

### 4.3 POST /api/v1/terminals/:terminalId/tasks/claim

原子领取任务（替代原 GET /tasks + PATCH processing 方案）。

**请求体**

```json
{
  "type": "print",
  "limit": 3
}
```

**响应**

```json
{
  "tasks": [
    {
      "taskId": "task-xyz789",
      "type": "print",
      "fileUrl": "https://storage.example.com/files/xxx?sig=yyy&expires=1748300000",
      "fileMd5": "d41d8cd98f00b204e9800998ecf8427e",
      "claimedBy": "term-abc123",
      "claimExpiresAt": "2026-05-26T10:05:00.000Z",
      "params": {
        "copies": 1,
        "colorMode": "black_white",
        "duplex": "duplex_long_edge",
        "paperSize": "A4",
        "orientation": "auto",
        "quality": "standard",
        "scale": "fit",
        "pagesPerSheet": 1
      },
      "createdAt": "2026-05-26T10:00:00.000Z"
    }
  ]
}
```

**Claim 语义**：
- 后端原子执行：`WHERE status='pending' LIMIT :limit → UPDATE status='claimed', claimedBy=:terminalId, claimExpiresAt=NOW()+5min`
- 若 `claimExpiresAt` 到期且状态仍为 `claimed`，后端定时任务将其重置为 `pending`，可被重新领取
- 同一 terminalId 重复 claim 同一 taskId 返回 200（幂等），不产生副作用

### 4.4 PATCH /api/v1/print-tasks/:taskId/status

回传打印任务状态。

**请求体（成功）**

```json
{
  "status": "completed",
  "completedAt": "2026-05-26T10:05:30.000Z",
  "pages": 2
}
```

**请求体（失败）**

```json
{
  "status": "failed",
  "errorCode": "PAPER_EMPTY",
  "errorDetail": "No paper in tray",
  "failedAt": "2026-05-26T10:01:00.000Z"
}
```

**预定义错误码**

| 错误码 | 含义 |
|--------|------|
| `PRINTER_OFFLINE` | 打印机不在线 |
| `PAPER_EMPTY` | 缺纸 |
| `TONER_EMPTY` | 墨粉耗尽 |
| `PAPER_JAM` | 卡纸 |
| `JOB_REJECTED` | 打印队列拒绝任务 |
| `FILE_DOWNLOAD_FAILED` | 文件下载失败（签名过期等） |
| `FILE_CORRUPT` | MD5 校验不通过 |
| `TIMEOUT` | 执行超时（10 分钟） |
| `CLAIM_EXPIRED` | claim 超时后任务被重置，本次执行结果无效 |

### 4.5 POST /api/v1/files/upload

上传扫描文件，`multipart/form-data`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | binary | 文件内容 |
| `terminalId` | string | 终端 ID |
| `scanId` | string | 扫描任务 ID |
| `fileType` | string | `pdf` / `jpeg` |
| `pageCount` | number | 页数 |

**响应**

```json
{
  "fileId": "file-abc123",
  "url": "https://storage.example.com/scan/xxx?sig=yyy&expires=...",
  "expireAt": "2026-05-26T11:00:00.000Z"
}
```

### 4.6 POST /api/v1/scan-tasks/:id/result

**请求体**

```json
{
  "status": "completed",
  "fileId": "file-abc123",
  "pageCount": 3,
  "fileType": "pdf",
  "completedAt": "2026-05-26T10:03:00.000Z"
}
```

### 4.7 POST /api/v1/device-events

**请求体**

```json
{
  "terminalId": "term-abc123",
  "events": [
    {
      "deviceType": "printer",
      "eventType": "paper_empty",
      "severity": "warning",
      "detail": "Main tray empty",
      "occurredAt": "2026-05-26T10:00:00.000Z"
    }
  ]
}
```

**eventType 枚举**：`printer_offline` / `printer_online` / `paper_empty` / `paper_low` / `toner_empty` / `toner_low` / `paper_jam` / `cover_open` / `usb_inserted` / `usb_removed` / `disk_low` / `network_unreachable`

### 4.8 POST /api/v1/terminals/:id/action-tokens

Kiosk / Agent 在发起动作前向后端获取 `actionToken`。

**请求体**

```json
{
  "action": "print",
  "taskId": "task-xyz789"
}
```

`action` 可选值：`print` | `scan` | `usb`

**响应**

```json
{
  "actionToken": "<hmac-signature>",
  "expiresAt": "2026-05-26T10:05:00.000Z",
  "nonce": "random-uuid"
}
```

### 4.9 PATCH /api/v1/terminal-tasks/:id/lease

Agent 为长时间运行任务续租 claim。

**请求体**

```json
{
  "claimedBy": "term-abc123",
  "extendSeconds": 300
}
```

**响应（成功）**

```json
{
  "ok": true,
  "newExpiresAt": "2026-05-26T10:10:00.000Z"
}
```

**响应（失败）**

```json
{
  "ok": false,
  "errorCode": "LEASE_RENEW_FAILED",
  "reason": "max renewals reached"
}
```

> 续租最多 3 次（总 lease 最长 20 分钟），超限则放弃并上报 `failed`。

---

## 5. 打印流程

```
用户在 Kiosk 选择打印参数，点击"确认打印"
       │
       ▼
Kiosk 调用后端 POST /api/v1/print-tasks
后端创建任务（status=pending），签发 actionToken（terminalId+action=print+expiresAt+nonce）
       │
       ▼
后端返回 { taskId, actionToken }，Kiosk 进入"打印进度"页面
       │
       ▼
（Kiosk 可选：调用 POST /local/print + actionToken 触发 Agent 立即轮询，加速响应）
       │
       ▼
Agent task-runner 每 5s 调用 POST /api/v1/terminals/:terminalId/tasks/claim
       │
       ▼
后端原子更新 status=claimed，返回任务详情（含 fileUrl + fileMd5 + claimExpiresAt）
       │
       ▼
Agent 下载文件到 %ProgramData%\AIJobPrintAgent\temp\<date>\<taskId>.pdf
       │  失败 → PATCH status=failed errorCode=FILE_DOWNLOAD_FAILED
       ▼
Agent 校验 MD5
       │  不一致 → PATCH status=failed errorCode=FILE_CORRUPT
       ▼
Agent 调用 Windows GDI Print API，提交到奔图打印机
       │  离线/缺纸 → PATCH status=failed errorCode=PRINTER_OFFLINE/PAPER_EMPTY
       ▼
PATCH status=printing
       │
       ▼
Agent 每秒轮询打印队列，等待任务出队
       │
       ▼  完成
PATCH status=completed，立即删除临时文件
       │
       ▼
Kiosk 轮询后端任务状态，completed 时展示"打印完成"页面
```

**超时保护**：claimed 起超过 10 分钟未 completed，Agent 自动 PATCH `failed` + `TIMEOUT`，并通知后端释放 claim。  
**断网情况**：PATCH 失败写入 SQLite 待上报队列，网络恢复后重试，completed 只上报一次。

### 5.1 打印机状态检测（State Detection）

#### Phase 8.0 Spike 验证目标

在真实 Windows 主机上执行以下检测项，结果记录到 `docs/device/local-print-spike.md` V12–V15。

| 检测项 | PowerShell / WMI 方法 | 期望结果 |
|--------|----------------------|---------|
| 打印机识别 | `Get-Printer -Name "Pantum CM2800ADN Series"` | 返回对象，不抛 error |
| 活动打印任务 | `Get-PrintJob -PrinterName "Pantum CM2800ADN Series"` | 打印进行中时返回 1+ 行 |
| 打印机离线状态 | WMI `Win32_Printer.PrinterStatus` | `5` = Offline；若不可识别 → `UNKNOWN_PRINTER_STATUS` |
| 打印机缺纸状态 | WMI `Win32_Printer.DetectedErrorState` | `5` = OutOfPaper；若不可识别 → `UNKNOWN_PRINTER_STATUS` |
| 任务完成检测 | `Get-PrintJob` 返回空 + 无 error | 判定为 `completed` |
| 任务失败检测 | `Win32_PrintJob.StatusMask` bit 8 (Error) | 判定为 `failed` |

> 如果 WMI 查询失败或返回不可解析状态，Agent 统一上报 `UNKNOWN_PRINTER_STATUS`，  
> 不假装知道打印机当前状态，不重试超过 3 次。

#### Phase 8.1 打印任务状态机

```
pending ──→ claimed ──→ printing ──→ completed
                │                        │
                │                        ↓
                └──────────────────→  failed
                   (error code /
                    timeout 10 min)
```

| Agent 内部状态 | 触发条件 |
|----------------|---------|
| `submitted` | 文件下载完成，调用 Windows 打印 API |
| `printing` | `Get-PrintJob` 存在对应作业 |
| `completed` | `Get-PrintJob` 作业消失 + 无错误码 |
| `failed` | 错误码 ≠ 0 / 超时 / 文件找不到 |
| `UNKNOWN_PRINTER_STATUS` | WMI 查询失败或返回非预期状态，上报原始值 |

---

## 6. 扫描流程

```
用户在 Kiosk 选择扫描参数，点击"开始扫描"
       │
       ▼
Kiosk 调用后端 POST /api/v1/scan-tasks（创建记录，status=pending）
后端签发 actionToken（action=scan），返回 { scanId, actionToken }
       │
       ▼
Kiosk 调用 POST http://127.0.0.1:9527/local/scan
请求体：{ scanId, settings, actionToken }
       │
       ▼
Agent local-api-server 验证 actionToken（签名/过期/nonce/action 全部校验）
验证失败 → 403，流程终止
       │
       ▼
Agent Service 通过 Named Pipe 向 Session Helper 发送扫描指令
       │  Helper 未就绪 → 切换 SMB 目录监听备用方案
       ▼
Helper 调用 TWAIN/WIA 触发扫描仪（可能弹出扫描仪面板让用户确认）
       │
       ▼
扫描完成，Helper 将输出文件路径写回 Named Pipe
       │
       ▼
Service 接收文件，存入 %ProgramData%\AIJobPrintAgent\temp\<date>\<scanId>\
多页合并为单 PDF（如 pageCount > 1）
       │
       ▼
Agent 上传文件：POST /api/v1/files/upload
       │  失败 → 重试 3 次（2s/4s/8s），最终失败上报 scan-task failed
       ▼
POST /api/v1/scan-tasks/:id/result（completed + fileId）
立即删除本地临时文件
       │
       ▼
Kiosk 轮询到 completed，展示扫描结果预览
（AI 简历识别 / 直接打印 / 保存到我的记录）
       │
       ▼
用户离开页面后，后端触发文件有效期倒计时（默认 30 分钟）
```

**扫描失败降级**：TWAIN 不可用时，Kiosk 提示用户切换"扫描到 U 盘"手动上传模式。

---

## 7. 安全要求

### 7.1 Agent Token 本地加密保存

- `agentToken` 使用 **Windows DPAPI LocalMachine scope** 加密保存，绑定本机机器密钥（不绑定具体用户账号），拷贝到其他机器无法解密
- 本机其他用户的访问控制依赖 `agent.token` 文件 ACL（仅 Agent 服务账号/管理员可读），而非 DPAPI scope 本身
- 加密存储路径：`%ProgramData%\AIJobPrintAgent\agent.token`
- 代码层：PowerShell `CryptProtectData`（`DataProtectionScope::LocalMachine`），token 通过 stdin 传入，不经过命令行参数

### 7.2 local-api-server Token 安全

- **只监听** `127.0.0.1`，不绑定 `0.0.0.0`
- CORS 白名单（浏览器辅助控制）**不作为唯一安全边界**
- **查询类接口**：Header `Authorization: Bearer <localAuthToken>`，不匹配返回 401
- **动作类接口**：Body 中 `actionToken` 验证全部通过才执行：
  1. HMAC 签名校验（使用 `actionTokenSecret`）
  2. `expiresAt` 未过期（默认 5 分钟有效期）
  3. `nonce` 在 SQLite 中未出现过（防重放）
  4. `action` 字段与当前请求路由匹配
  - 任一失败 → **403 FORBIDDEN**，不执行动作，不伪造成功
- actionToken 消费后 nonce 写入 SQLite，7 天后清理

### 7.3 文件临时缓存与清理

- 所有临时文件只写入 `%ProgramData%\AIJobPrintAgent\temp\`
- 目录 ACL：仅 Agent 服务账号（LocalSystem 或专用账号）和管理员组可读写
- 打印完成立即删除；定时兜底每小时清理超过 60 分钟的全部文件，无豁免
- 磁盘空间低于 500MB 时拒绝新任务并上报告警

### 7.4 不长期保存敏感文件

| 文件类型 | 最长保留时间 |
|---------|------------|
| 待打印文件（下载） | 打印结束立即删除 |
| 扫描文件（上传前） | 上传成功立即删除；失败最长 30 分钟 |
| 日志文件 | 最长 30 天（不含文件内容） |
| SQLite 幂等记录 | 7 天后清理已完成任务；nonce 记录 7 天后清理 |

### 7.5 日志脱敏规则

- 不记录文件完整路径（只记录扩展名，如 `.pdf`）
- 不记录文件内容、用户姓名、身份证号、手机号
- 不记录 actionToken 明文、打印文件下载 URL（只记录 taskId）
- 错误日志只记录错误码和描述

### 7.6 API 失败不伪造成功

- 后端 API 调用失败时，本地任务状态保持"待上报"
- 绝不在 API 失败时修改本地状态为 `completed`
- Kiosk 的任务状态来自后端，不来自 Agent 本地推断

### 7.7 离线重试与幂等

- 网络恢复后，待上报状态从 SQLite 重新上报
- 每个 `(taskId, status)` 组合标记"已上报"后不再重复发送
- 后端 `PATCH /api/v1/print-tasks/:taskId/status` 设计为幂等（相同状态重复 PATCH 返回 200）
- Claim lease 超时后任务可被重新领取，但前一次执行的 PATCH completed 会被后端拒绝（`CLAIM_EXPIRED`），不会产生重复计费

---

## 8. Windows 兼容性

### 8.1 运行环境

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 x64 21H2+，Windows 11 x64 |
| 架构 | x64（一体机标准配置） |
| 进程权限 | Service：LocalSystem 或专用服务账号；Helper：登录用户账号 |
| 网络 | 有线网络（建议 DHCP 静态绑定） |
| 依赖 | 奔图 CM2800ADN/CM2820ADN 系列 Windows 驱动 V3.x+ 已安装（Windows 识别名：`Pantum CM2800ADN Series`） |
| 运行时 | 打包为单文件可执行（不要求目标机预装 Node.js） |

### 8.2 开机自启动

```
方式 A（推荐）：注册为 Windows Service
  工具：node-windows 或 NSSM
  优点：系统级启动，无需用户登录，崩溃自动重启
  
方式 B（备用）：任务计划程序
  触发器：系统启动时
  适用：驱动访问权限不需要 SYSTEM 级别时
```

服务名称：`AIJobPrintAgent`  
显示名称：`AI 求职打印服务 - 终端代理`

Session Helper 由 Service 在用户登录事件后（监听 `WTS_SESSION_LOGON` 消息或轮询活跃 Session）通过 `CreateProcessAsUser` 启动。

### 8.3 崩溃自动重启

Windows 服务"失败操作"配置：

```
第 1 次失败：30 秒后重启服务
第 2 次失败：60 秒后重启服务
后续失败：120 秒后重启服务
重置计数器：每 24 小时
```

Agent 内部捕获 `uncaughtException` / `unhandledRejection`，写日志后 `process.exit(1)` 触发服务重启。

### 8.4 后台服务模式

- 无 GUI 窗口，完全后台运行
- 日志写入本地文件（`%ProgramData%\AIJobPrintAgent\logs\`）和 Windows 事件日志
- 提供命令行工具：`agent-ctl status / start / stop / restart / logs`
- 状态查询：`GET http://127.0.0.1:9527/local/status`（需 localAuthToken）

### 8.5 本地配置文件

路径：`%ProgramData%\AIJobPrintAgent\config.json`（仅 Agent 服务账号/管理员可读写）

```json
{
  "apiBaseUrl": "https://api.example.com/api/v1",
  "terminalId": "term-abc123",
  "printerName": "Pantum CM2800ADN Series",
  "heartbeatIntervalSec": 30,
  "taskPollIntervalSec": 5,
  "claimLeaseSec": 300,
  "tempDir": "%ProgramData%\\AIJobPrintAgent\\temp",
  "logLevel": "info",
  "scanMode": "twain",
  "smbScanDir": "\\\\192.168.1.10\\scan-drop",
  "namedPipeName": "\\\\.\\pipe\\AIJobPrintAgent",
  "localApiPort": 9527
}
```

### 8.6 日志路径

| 文件 | 路径 | 保留时间 |
|------|------|---------|
| 运行日志 | `%ProgramData%\AIJobPrintAgent\logs\agent-YYYY-MM-DD.log` | 30 天 |
| 错误日志 | `%ProgramData%\AIJobPrintAgent\logs\error-YYYY-MM-DD.log` | 30 天 |
| SQLite | `%ProgramData%\AIJobPrintAgent\data\agent.db` | 持续（任务记录 7 天后清理） |

### 8.7 打印驱动依赖

| 依赖项 | 安装要求 | 验证方式 |
|--------|---------|---------|
| 奔图 CM2800ADN/CM2820ADN 系列 Windows 驱动 | 部署前必须已安装，V3.x+（Windows 识别名：`Pantum CM2800ADN Series`） | 控制面板 → 设备和打印机中可见 |
| TWAIN 数据源 | 随奔图驱动安装 | Agent 启动时枚举 TWAIN Source |
| .NET Framework 4.8 | Windows 10 预装 | WIA COM 组件依赖 |

### 8.8 单实例锁

```
Agent 启动 → CreateMutex("Global\AIJobPrintAgentSingleton")
    │
    ├─ 成功（首个实例）→ 继续启动
    │
    └─ 失败（已有实例）→ 写日志 DUPLICATE_INSTANCE_DETECTED → process.exit(1)
```

Mutex 随进程终止（正常退出或崩溃）自动由 Windows 释放，后续重启可正常创建。Windows 服务的自动重启机制与 Mutex 释放天然衔接，不会死锁。

---

## 9. MVP 范围与技术验证清单

### Phase 8.0 — 技术验证（实现前必须完成）

**目的**：在真实 Windows 一体机上验证关键技术假设，确定最终实现方案后再进入编码。在 MVP 实现前完成，出现 FAIL 的项目需更新实现方案或切换备用路径。

| # | 验证项 | 验证方法 | 通过标准 |
|---|--------|---------|---------|
| V01 | **TWAIN 在 Windows Service（LocalSystem）下是否可用** | 在 LocalSystem 账号运行测试脚本，枚举 TWAIN Source Manager | 能枚举到奔图扫描仪 Source ✅；否则确认必须 Helper 进程 |
| V02 | **TWAIN 在 User Session Helper 下是否可用** | 用登录用户账号运行，触发实际扫描 | 能扫描出文件，格式正确 |
| V03 | **Named Pipe 跨进程通信（Service ↔ Helper）** | Service 创建管道 + ACL，Helper 连接，双向发送 JSON 消息 | 消息往返延迟 < 100ms，ACL 拒绝无授权进程连接 |
| V04 | **localAuthToken / actionToken 校验** | 构造合法 Token、过期 Token、重放 Token 分别请求 local-api-server | 合法→200，过期→403，重放→403，签名错误→403 |
| V05 | **Claim lease 超时重新领取** | Agent claim 任务后不 PATCH，等待 claimExpiresAt 过期，另一进程重新 claim | 原任务重置为 pending，可被重新 claim |
| V06 | **`node-printer` 调用奔图打印机** | 打印测试 PDF（1 页，A4，彩色） | 打印成功，状态正确回传 |
| V07 | **PowerShell 打印备用方案** | `Start-Process ... -Verb Print` 调用同一打印机 | 打印成功（V06 失败时的备用验证） |
| V08 | **Windows 服务开机自启 + 崩溃重启** | 注册服务，重启机器验证自启；kill 进程验证自动重启 | 开机后 30s 内服务 Running |
| V09 | **`CreateProcessAsUser` 启动 Helper** | Service 以 LocalSystem 调用 API 在当前登录用户 Session 启动子进程 | Helper 进程出现在用户 Session 的任务管理器中 |
| V10 | **打包方案对比（pkg / nexe / electron-builder / .NET wrapper）** | 各方案分别打包，测试：启动时间、文件大小、原生 addon 加载、Windows 服务兼容性 | 选定最优方案，记录结论 |
| V11 | **DPAPI 加密存储** | 加密写入 agent.token，在本机解密；拷贝 agent.token 到其他机器尝试解密；验证文件 ACL 拒绝普通用户读取 | 原机可解密；换机不可解密；普通用户收到拒绝访问错误 |
| V12 | **PDF 合并性能（50 页 ADF 扫描）** | 生成 50 张 A4 JPEG，合并为 PDF，记录耗时 | ≤ 10 秒 |
| V13 | **磁盘 ACL 验证** | 以普通用户账号尝试读写 `%ProgramData%\AIJobPrintAgent\temp\` | 普通用户收到拒绝访问错误 |
| V14 | **断网重连幂等** | 断网时完成打印，网络恢复后观察 PATCH 行为 | completed 只上报一次，不重复计费 |
| V15 | **单实例 Mutex** | 同时启动两个 Agent 实例 | 第二个实例立即退出并写日志 |

### Phase 8.1 — MVP（技术验证通过后实现）

> Phase 8.1A/8.1B/8.1C 实现状态（截至 2026-05-28）

| 能力 | 说明 | 状态 |
|------|------|------|
| 终端注册 | 注册获取 terminalId + agentToken（`POST /auth/terminal/register`） | ✅ Phase 8.1B |
| 单实例锁 | PID 文件锁（`%ProgramData%\AIJobPrintAgent\agent.pid`），ESRCH 僵尸锁检测，重复启动 exit 1 | ✅ Phase 8.1C |
| 心跳上报 | 每 30s（`PUT /terminals/:id/heartbeat`） | ✅ Phase 8.1B |
| 打印任务 Claim | `POST /terminals/:id/tasks/claim`，5s 轮询 | ✅ Phase 8.1B |
| 打印任务执行 | 下载 → MD5 校验 → pdf-to-printer/SumatraPDF → 状态回传 | ✅ Phase 8.1B |
| 重启幂等 | SQLite `print_tasks` 表防重复执行（`markTaskDone` before PATCH） | ✅ Phase 8.1C |
| 状态回传 | `PATCH /print-tasks/:id/status`，返回 boolean 供离线队列 | ✅ Phase 8.1C |
| 断网 PATCH 重试 | SQLite `pending_patches` 队列，60s 轮询，指数退避，max 10 次，4xx 放弃 | ✅ Phase 8.1C |
| DPAPI Token 加密 | agentToken PowerShell stdin 加密，LocalMachine scope，base64 存 `agent.token` | ✅ Phase 8.1C |
| Windows 服务安装 | `node dist/index.js install-service / uninstall-service`（node-windows） | ✅ Phase 8.1C 代码完成（专项验收 → Phase 8.2C） |
| 临时文件清理 | try/finally 任务结束立即删除临时 PDF | ✅ Phase 8.1B |
| image-to-pdf 路由 | pdfkit 将 JPG/PNG 转为临时 PDF → Method B | ✅ Phase 8.1A |
| 断网重试专项验证 | 真机断网条件下验证 pending_patches 入队与自动重试 | 📋 Phase 8.2C |
| 单实例锁专项验证 | 同时启动两个 Agent 进程，验证 DUPLICATE_INSTANCE exit 1 | 📋 Phase 8.2C |
| Windows 服务专项验证 | 安装→重启自启→心跳持续→卸载全流程 | 📋 Phase 8.2C |
| local-api-server | 127.0.0.1:9527，localAuthToken + actionToken 全部鉴权 | 📋 Phase 8.2C |
| actionToken HMAC | HMAC 签名校验（当前 base64 占位） | 📋 Phase 8.2C |
| lease 续租 | `PATCH /terminal-tasks/:id/lease` | 📋 Phase 8.2C |
| 扫描任务执行 | Named Pipe 触发 Helper → TWAIN → PDF 合并 → 上传 → 回传 | 📋 Phase 8.2+ |
| Session Helper | Named Pipe 通信，TWAIN 扫描 | 📋 Phase 8.2+ |

### Phase 8.2（第二阶段）

#### Phase 8.2A — Prisma 持久化（服务端）

| 能力 | 说明 |
|------|------|
| Terminal 表 | 持久化 terminalId/terminalCode/agentToken/registeredAt |
| PrintTask 表 | 持久化任务状态机（pending→claimed→printing→completed/failed），终态不可覆盖 |
| TerminalHeartbeat 表 | 记录心跳历史，支持在线状态查询 |
| PrintTaskStatusLog 表 | 记录每次状态变更日志（who/when/from/to） |
| 原子 Claim | 事务保证同一任务不被两台终端同时 claim |
| API 重启不丢数据 | 服务重启后 terminal + task 状态从 DB 恢复 |

#### Phase 8.2B — WMI 真实状态查询

| 能力 | 说明 |
|------|------|
| printerStatus 真实查询 | Win32_Printer WMI 查询替换 heartbeat 心跳中的 hardcoded 值 |
| diskFreeGB 真实查询 | WMI/PowerShell 查询系统磁盘剩余 |
| 设备事件告警 | 缺纸、墨粉不足、卡纸状态主动上报 |

#### Phase 8.2C — 安全加固 + 专项补验

| 能力 | 说明 |
|------|------|
| 断网重试专项验证 | 真机断网，验证 pending_patches 入队/重试/成功清空 |
| 单实例锁专项验证 | 双进程并发，验证 DUPLICATE_INSTANCE exit 1 |
| Windows 服务专项验证 | install→重启→自启→心跳→uninstall 全流程 |
| actionToken HMAC | HMAC-SHA256 签名校验替换当前 base64 占位 |
| lease 续租 | `PATCH /terminal-tasks/:id/lease` 防长任务超时 |
| local-api-server | 127.0.0.1:9527，localAuthToken + actionToken 全鉴权 |

#### Phase 8.2+ 扩展

| 能力 | 说明 |
|------|------|
| 扫描任务（TWAIN） | Named Pipe → Helper → TWAIN/WIA → PDF 合并 → 上传 |
| SMB 扫描备用 | TWAIN 不可用时监听 SMB 共享目录 |
| U 盘监听 | USB 存储挂载检测，文件列表推送 Kiosk |

### Phase 8.3（第三阶段扩展）

| 能力 | 说明 |
|------|------|
| 摄像头 | Helper 进程 DirectShow 采集，证件照上传 |
| 扫码器 | Helper 进程 node-hid 输入拦截，解码推送 Kiosk |
| Agent 自动更新 | 后端下发版本，自动下载替换 |

---

## 10. 风险清单

| # | 风险 | 可能性 | 影响 | 应对措施 |
|---|------|--------|------|---------|
| R1 | 奔图 CM2800ADN/CM2820ADN 系列无云端打印能力 | 已确认 | 高 | 主方案：Windows Terminal Agent + 本地 GDI 打印；开放 API 为后续预留，不替代本地方案 |
| R2 | TWAIN 在 LocalSystem 下不可用（需要用户 Session） | 高 | 高 | **V01/V02 为 Phase 8.0 必验项**；双进程架构已针对此设计 |
| R3 | `node-printer` Windows 兼容性不稳定 | 中 | 高 | **V06/V07** 提前验证；PowerShell 备用方案就位 |
| R4 | 临时文件目录权限问题 | 低 | 中 | 使用 `%ProgramData%\...`（服务账号有写权限）；**V13** 验证 ACL |
| R5 | 服务账号权限不足访问打印机队列 | 中 | 高 | 部署时配置专用服务账号或 LocalSystem；**V08** 验证 |
| R6 | Windows 打印队列事件不可靠 | 中 | 中 | 每秒主动轮询队列状态兜底 |
| R7 | 断网后任务状态重复上报或漏报 | 低 | 高 | SQLite 持久化 + 幂等上报；**V14** 验证 |
| R8 | 签名 URL 过期（10 分钟有效期） | 低 | 中 | claim 后立即下载，超期上报 `FILE_DOWNLOAD_FAILED` |
| R9 | PDF 合并在 50 页 ADF 扫描下性能不足 | 低 | 低 | **V12** 压测；备选 Ghostscript |
| R10 | 磁盘满导致临时文件无法写入 | 低 | 高 | 任务前检查可用空间（≥500MB），不足则拒绝并告警 |
| R11 | Named Pipe 在特殊 Windows 权限配置下建立失败 | 低 | 高 | **V03** 验证 ACL；准备 localhost:9528 降级方案 |
| R12 | `CreateProcessAsUser` 在某些 Windows 策略下受限 | 低 | 高 | 提前在目标机型上验证（**V09**）；备用：Helper 以任务计划程序在用户登录时启动 |

---

## 12. 打印分发层架构（Provider / Executor 分层）

> 目的：清晰区分"后端把任务分发给哪里"和"Agent 本地用什么方式执行打印"，不要混成一个运行时接口。

### 12.1 分层职责

```
┌─────────────────────────────────────────────────────────────────┐
│                        后端 services/api                         │
│                                                                  │
│  PrintDispatchProvider（接口）                                    │
│    ├─ LocalAgentDispatchProvider  ← Phase 8.1 主方案             │
│    │    把任务写入 print-tasks 表（pending），等 Agent claim       │
│    │    云端任务队列 → Agent 主动 claim → 本地驱动打印              │
│    │                                                             │
│    └─ PantumCloudDispatchProvider ← 未来预留（不替代主方案）       │
│         调用奔图开放打印 API                                       │
│         appSecret 只保存在后端；sign = MD5(body+nonce+secret)    │
│         color mode 待厂家确认后实现                                │
│                                                                  │
└────────────────────────────────────────────────────────────────┘
                              │ Agent claim
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Windows Terminal Agent                          │
│                                                                  │
│  LocalPrintExecutor（接口）                                      │
│    ├─ WindowsPowerShellExecutor   ← Method A（Phase 8.0 Spike） │
│    │    Start-Process -Verb PrintTo                              │
│    │                                                             │
│    ├─ PdfToPrinterExecutor        ← Method B（Phase 8.0 Spike） │
│    │    SumatraPDF + -print-settings                             │
│    │                                                             │
│    └─ NativeDriverExecutor        ← 后续可扩展                   │
│         node-printer / Win32 SetPrinter + DEVMODE                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 关键约束

| 约束 | 说明 |
|------|------|
| **主方案不变** | Phase 8.1 主方案始终是 `LocalAgentDispatchProvider` + Windows Terminal Agent 本地打印，不要在 Phase 8.1 切换为奔图云打印 |
| **appSecret 隔离** | `PantumCloudDispatchProvider` 的 appKey/appSecret 只保存在后端，Kiosk / Agent / 前端不得持有 |
| **color mode TODO** | `PantumCloudDispatchProvider` 中 `color` → Pantum API mode 取值**待厂家确认**，未确认前禁止假设为 `"color"` |
| **打印机名可配置** | Agent 打印机名称通过 `config/agent-config.json` 中 `printerName` 字段传入；默认值 `"Pantum CM2800ADN Series"`；严禁硬编码到执行器内部 |
| **能力待验证字段** | collate / paperType / feeder 为可选预留字段，CM2800ADN/CM2820ADN 实际支持情况需 Phase 8.2 真机验证后确认 |

### 12.3 Pantum 开放打印 API 状态码

> 仅供 `PantumCloudDispatchProvider` 未来实现参考。当前不影响 Phase 8.1。

| 状态码 | 含义 |
|--------|------|
| 100 | 打印完成 |
| 101 | 创建打印 |
| 102 | 打印中 |
| 103 | 取消打印 |
| 104 | 打印错误 |

预留接口：`device/register` / `print/createTask` / `print/cancel` / `device/status` / `callback/deviceUnbind` / `callback/printStatus`

---

## 11. 附录：技术选型建议

### 打包方案对比（V10 验证后选定）

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| `pkg`（Node.js） | 成熟，社区大，单文件输出 | 对 native addon 支持一般；部分 API 需额外配置 | 无复杂 native 依赖时首选 |
| `nexe`（Node.js） | 更原始，可控性强 | 社区活跃度下降，文档少 | pkg 不可用时备选 |
| `electron-builder`（Node.js） | 完整安装包生态，自动更新支持好 | 体积大（带 Chromium） | 若需要 GUI 管理界面 |
| `.NET wrapper`（C#） | Windows 原生 API 支持最强；服务/驱动/COM 访问最稳定 | 需要额外维护 .NET 组件 | node-printer/node-twain 在目标机持续失败时的最终备选 |

**推荐优先级**：`pkg` → `nexe` → `.NET wrapper`（具体由 V10 验证结果决定）

### 其他组件选型

| 组件 | 推荐方案 | 备选方案 |
|------|---------|---------|
| Windows 服务注册 | `node-windows` | NSSM |
| 打印 API | `node-printer` | PowerShell `Start-Process -Verb Print` → .NET wrapper |
| 扫描 API（Helper） | `node-twain` | PowerShell WIA COM → .NET wrapper |
| Named Pipe | Node.js `net.createServer()` + `\\.\pipe\...` | |
| USB 监听 | `drivelist` + `chokidar` | `node-usb` |
| Token 加密 | `node-dpapi` | `keytar`（Windows Credential Manager） |
| 本地数据库 | `better-sqlite3` | LevelDB |
| PDF 合并 | `pdf-lib` | Ghostscript CLI |
| HTTP 客户端 | `axios` + 自定义重试 | `got` |
| 日志 | `winston` + 日志滚动 | `pino` |
