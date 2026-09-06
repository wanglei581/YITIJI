# 奔图 Pantum CM2800ADN Series 设备文档

> 最后更新：2026-05-27
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [pantum-api-design.md](./pantum-api-design.md)

---

## 一、设备基本信息

| 项目 | 信息 |
|------|------|
| Windows 打印机驱动名称 | **Pantum CM2800ADN Series** |
| 硬件型号 | CM2820ADN（实际采购机型） |
| 类型 | 彩色激光多功能一体机 |
| 产品文案称呼 | 奔图 CM2800/CM2820 系列彩色激光多功能一体机 |

> ⚠️ 项目中 printerName 配置项不得写死为 CM2820ADN，应配置为 `"Pantum CM2800ADN Series"`。

---

## 二、硬件能力（已确认）

以下为设备原生硬件能力，不依赖任何 API：

| 能力 | 说明 |
|------|------|
| 黑白打印 | 支持 |
| 彩色打印 | 支持 |
| A4 幅面 | 最大支持 A4，不支持 A3 |
| 自动双面打印 | 硬件支持自动翻面 |
| 复印 | 支持 |
| 扫描 | 支持平板扫描和 ADF 扫描 |
| ADF 自动输稿器 | 50 页 ADF，支持多页连续扫描 |
| USB 接口 | 支持 U 盘打印和扫描到 U 盘 |
| 有线网络 | 支持以太网连接 |
| 扫描到 SMB | 支持扫描到 SMB 网络共享文件夹 |

### 支持的扫描格式

- PDF / PDF/A / OFD / JPEG / PNG / TIFF

---

## 三、开放打印 API 能力（需单独确认）

以下为《开放打印能力.pdf》描述的 API 能力，**不代表 CM2800ADN Series 当前可用**。

> ⚠️ 硬件支持彩色打印，不代表开放 API 的 color 参数已确认。
> `printSetting.mode` 只明确写了 `"bw"`（黑白）。
> **彩色值需厂家另行确认，不得默认假设可用。**

| API 能力 | 状态 | 说明 |
|---------|------|------|
| 设备注册 /device/register | 预留 | |
| 创建打印任务 /print/createTask | 预留 | 文件类型：doc/docx/ppt/pptx/xls/xlsx/txt/jpg/png/jpeg/bmp/pdf |
| 取消打印 /print/cancel | 预留 | |
| 查询设备状态 /device/status | 预留 | |
| 打印状态回调 | 预留 | 100 完成 / 101 创建 / 102 打印中 / 103 取消 / 104 错误 |
| 设备解绑回调 | 预留 | |

详细 API 规范见 [pantum-api-design.md](./pantum-api-design.md)。

---

## 四、明确不支持的能力

| 不支持的能力 | 说明 |
|------------|------|
| A3 幅面打印 | 只支持 A4 及以下 |
| 云端远程发起扫描 | 没有开放的扫描 API，扫描由本地 Agent 处理 |
| 无线 WiFi 连接 | 有线网络型号，无 WiFi |

---

## 五、打印集成方案

### 主方案：Windows 本地驱动（Phase 8.1 当前）

- Terminal Agent 拉取打印任务
- 下载文件到本地临时目录
- 调用 Windows 打印 API，指定 `"Pantum CM2800ADN Series"` 打印机
- 打印完成后上报状态

### 后续扩展：PantumCloudDispatchProvider

未来如厂家开放云打印能力，在后端 `services/print/` 层实现 PantumCloudDispatchProvider。
详细设计见 [windows-terminal-agent-design.md](./windows-terminal-agent-design.md) §PrintProvider 架构。

---

## 六、开发注意事项

1. **printerName 配置化**：Windows 打印机驱动名称为 `"Pantum CM2800ADN Series"`，不要写死为 CM2820ADN
2. **不要假设 A3**：所有打印功能设计只考虑 A4 及以下
3. **不要假设 WiFi**：设备只有有线网络
4. **不要假设云端扫描 API**：扫描由本地 TWAIN/WIA 或 SMB 目录监听实现
5. **彩色 API 值待确认**：printSetting.mode 的彩色值不得假设为 `"color"`，需厂家确认
6. **测试环境**：开发阶段可用虚拟打印机（PDF 打印机）模拟，上线前必须在真机测试
7. **驱动安装**：部署时需预装 `"Pantum CM2800ADN Series"` 驱动程序

## 七、现场网络部署口径

### 推荐主路径：USB 打印、随身 WiFi 上网

- Windows 一体机通过随身 WiFi 访问生产 API；不要求公网 IP，也不需要端口映射。
- 打印机通过 USB 直连 Windows，生产打印队列只保留一个 `Pantum CM2800ADN Series` 队列，并核对实际 USB 端口（例如 `USB001`）。
- 打印机网口在不需要网络扫描或设备管理时保持不接入，避免 USB 队列和 TCP/IP 队列同时参与打印。

### 需要使用打印机网口时：独立无网关内网

- Windows 有线网卡与打印机网口接入独立小交换机；该网卡只用于打印机内网通信。
- 示例地址：Windows `192.168.50.1/24`，打印机 `192.168.50.2/24`；两端不填写默认网关和 DNS，Windows 默认上网路由继续走随身 WiFi。
- 打印机不直接接入公网，不在随身 WiFi 上暴露管理端口，不启用 Windows 网络桥接或 Internet Connection Sharing。
- USB 与网口不得为同一台机器各建一个生产打印队列；必须明确一个主打印端口，另一条链路只服务于经验证的扫描或管理用途。

### 每台设备交付前必须复验

- 随身 WiFi 自动重连、Windows 重启后 Agent 自动启动、打印机断电重启后状态恢复。
- Agent 只监听 `127.0.0.1:9527`，云端通过 HTTPS 心跳；后台显示终端在线、打印机 `ready`。
- 记录终端编号、打印机驱动名称、USB/TCP 连接方式、局域网地址（如有）和 Agent 版本；每台设备单独绑定凭证，不复制另一台设备的 token 或系统镜像。
