# Pantum 开放打印 API 集成设计

> 版本：v1.0  
> 创建时间：2026-05-27  
> 状态：预留设计，Phase 8.1 不实现；Phase 8.2+ 视需求评估  
> 关联文档：[windows-terminal-agent-design.md](./windows-terminal-agent-design.md) | [CLAUDE.md](../../CLAUDE.md)

---

## 1. 定位与边界

### 1.1 当前主方案

**Phase 8.1 主方案**：Windows Terminal Agent + 本地 Windows 驱动打印（`LocalAgentDispatchProvider`）。

该机器**没有直接云打印能力**，云打印应采用：
```
云端任务队列 → Windows Agent 主动 claim → 本地驱动打印
```
而不是假设打印机自己能云打印。

### 1.2 本文档的定位

本文档描述**奔图开放打印 API**（`PantumCloudDispatchProvider`）的集成规范，供未来评估和实现时参考。  
**当前 Phase 8.1 不实现该路径，不替代本地打印主方案。**

---

## 2. 设备信息

| 项目 | 值 |
|------|----|
| 型号系列 | 奔图 CM2800/CM2820 系列彩色激光多功能一体机 |
| Windows 驱动识别名称 | `Pantum CM2800ADN Series`（真机确认） |
| 硬件能力 | 黑白打印 ✅ / 彩色打印 ✅ / 自动双面 ✅ / A4 ✅ / ADF 50页 ✅ |
| 网络 | 有线网络（无 WiFi，无云端打印能力） |
| 配置项（Agent） | `printerName`（`config/agent-config.json`），禁止硬编码 |

---

## 3. 签名算法

> 来源：《开放打印能力.pdf》  
> **注意：不是 HMAC，是 MD5**

```
sign = md5Hex(body + "&nonce=" + nonce + "&timeStamp=" + timeStamp + "&" + appSecret).toUpperCase()
```

| 参数 | 说明 |
|------|------|
| `body` | 请求体字符串（JSON 序列化后的 UTF-8 字节字符串） |
| `nonce` | 随机字符串，每次请求唯一，必须防重放 |
| `timeStamp` | Unix 时间戳（毫秒），建议服务端限制 ±5 分钟窗口 |
| `appSecret` | 只保存在后端，**不得出现在前端、Kiosk、Agent** |

### 请求 Header

```
Content-Type: application/json
X-App-Key: <appKey>        ← appKey 放 Header，不参与签名
```

### 安全要求（服务端强制）

| 要求 | 说明 |
|------|------|
| appKey 位置 | Header `X-App-Key`，不参与签名 |
| appSecret 保存 | **只保存在后端**；Kiosk / Agent / 前端不得持有 |
| nonce 防重放 | 服务端记录已使用 nonce，相同 nonce 直接拒绝 |
| timeStamp 窗口 | 建议拒绝超出 ±5 分钟的请求 |
| 回调验签 | 接收奔图回调时必须用相同算法验签 |
| 回调幂等 | 同一 taskId 相同状态回调重复处理不产生副作用 |
| 日志脱敏 | appSecret、签名值不写入日志；只记录 taskId、状态码 |

---

## 4. 打印参数映射

### 4.1 PrintJobParams → Pantum API printSetting

> 仅已确认的字段映射。**未确认字段禁止直接使用，必须等厂家确认后实现。**

| PrintJobParams 字段 | Pantum API 字段 | 已确认映射值 | 备注 |
|--------------------|----------------|-------------|------|
| `colorMode: 'black_white'` | `printSetting.mode` | `"bw"` | ✅ 已确认（API 文档明确） |
| `colorMode: 'color'` | `printSetting.mode` | ⚠️ **TODO** | 待奔图厂家确认，**禁止假设为 `"color"`** |
| `copies` | `printSetting.copies` | 直接传递 | ✅ 已确认 |
| `duplex: 'simplex'` | `printSetting.duplex` | ⚠️ 待确认 | |
| `duplex: 'duplex_long_edge'` | `printSetting.duplex` | ⚠️ 待确认 | |
| `duplex: 'duplex_short_edge'` | `printSetting.duplex` | ⚠️ 待确认 | |
| `paperSize: 'A4'` | `printSetting.paperSize` | ⚠️ 待确认 | |
| `orientation` | `printSetting.orientation` | ⚠️ 待确认 | |
| `quality` | `printSetting.quality` | ⚠️ 待确认 | |

> **"不同机型，可选值集合不一样"**（API 文档原文）。所有 ⚠️ 待确认字段在厂家确认前不得上线。

---

## 5. 预留接口列表

以下接口为 `PantumCloudDispatchProvider` 未来实现时参考，**当前 Phase 8.1 不调用**。

| 接口 | 方法 | 说明 |
|------|------|------|
| `device/register` | POST | 设备注册 |
| `print/createTask` | POST | 创建打印任务 |
| `print/cancel` | POST | 取消打印任务 |
| `device/status` | GET | 查询设备状态 |
| `callback/deviceUnbind` | POST（回调） | 设备解绑通知 |
| `callback/printStatus` | POST（回调） | 打印状态通知 |

### 5.1 打印状态码（回调）

| 状态码 | 含义 | 对应 PrintTaskStatus |
|--------|------|----------------------|
| 100 | 打印完成 | `completed` |
| 101 | 创建打印 | `pending` |
| 102 | 打印中 | `printing` |
| 103 | 取消打印 | `cancelled` |
| 104 | 打印错误 | `failed` |

---

## 6. 与 Phase 8.1 主方案的关系

```
当前 Phase 8.1 主方案：
  Kiosk → POST /api/v1/print-tasks（后端）
         → LocalAgentDispatchProvider 写入 print-tasks 表（pending）
         → Windows Agent 每 5s POST /tasks/claim（主动 claim）
         → Agent 本地下载文件 + 调用 Windows GDI Print API
         → Agent PATCH /print-tasks/:id/status（状态回传）

未来可能预留的 Pantum 云路径（不替代主方案）：
  后端 PantumCloudDispatchProvider 调用奔图开放打印 API
  → appSecret 只在后端持有
  → 回调接收打印状态（验签 + 幂等）
  → 更新 print-tasks 状态
```

> **重要**：两个路径可以并存，但 Phase 8.1 只实现主方案。  
> 开放 API 路径需要等 `colorMode: 'color'` 的 Pantum API 取值确认后才能正式实现。

---

## 7. 未解决问题（待厂家确认）

| # | 问题 | 影响范围 |
|---|------|---------|
| Q1 | 彩色打印的 Pantum API `mode` 取值是什么？ | `PantumCloudDispatchProvider` colorMode 映射 |
| Q2 | `duplex` 参数的可用值集合（simplex / long / short 对应什么字符串）？ | 双面打印参数映射 |
| Q3 | A4 纸张的 `paperSize` 参数取值？ | 纸张参数映射 |
| Q4 | `copies` 是否支持 1–99 范围？ | 份数上限 |
| Q5 | `collate` 是否支持（逐份/逐页打印）？ | PrintJobParams 可选字段 collate |
| Q6 | `paperType` 可用值集合（CM2800ADN 支持哪些纸张类型）？ | PrintJobParams 可选字段 paperType |
| Q7 | `feeder` 可用值集合（CM2800ADN 是否有多纸盒）？ | PrintJobParams 可选字段 feeder |

---

## 8. 更新记录

| 日期 | 内容 | 操作人 |
|------|------|--------|
| 2026-05-27 | v1.0 初稿：签名算法、PrintJobParams 映射、预留接口、未解决问题清单 | Claude Code |
