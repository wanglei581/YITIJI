# Windows 真机打印首单验收记录（2026-08-07）

> 本记录只陈述当天已在 Windows 主机 + 真实奔图打印机（外设，非一体机整机）上完成与未完成的事实；不作整机商用通过结论。

## 1. 结论摘要

- **已完成**：Terminal Agent 服务在线、9527 本地 API 可用且带来源守卫（fail-closed）、真实打印首单已出纸（任务 `ptask_kiosk_337d61d38b698d61` / 订单 `cmsirshmc001clga8n1i2ind2`）、Kiosk 页面显示已完成。
- **未完成**：打印机面板扫描（`scanWatchFolder` 未配置，Agent 日志“跳过扫描监听”）；扫码枪付款码支付未实测；摄像头按已确认决策不接入。
- **现场目标口径**（用户确认）：用户没有一体机整机，只有 Windows 主机 + 打印机 + 扫码枪 + 摄像头；“只要打开这个网站，在本地电脑能完成打印操作就行了”，另规划小程序云打印（M2，方案见 `docs/superpowers/plans/2026-08-07-miniapp-cloud-print-m2-first-slice.md`）。

## 2. 环境

- 主机：Windows（无一体机整机，外设形态）。
- 打印机驱动：`Pantum CM2800ADN Series`（系统打印列表真机识别；代码侧仍通过 `printerName` 配置，不硬编码型号）。
- Terminal Agent：服务 `aijobprintagent`（已启动），日志目录 `C:\ProgramData\AIJobPrintAgent\logs`。
- 关键日志文件：`aijobprintagent.out.log`（2026-08-07 17:45，约 56 KB）、`aijobprintagent.wrapper.log`（17:49）、`aijobprintagent.err.log`（0 字节）。

## 3. 已验证证据

### 3.1 本地 API 与来源守卫（fail-closed）

`127.0.0.1:9527` 处于 LISTENING（PID 23328）。逐项探测：

| 请求 | 结果 |
|------|------|
| `GET /`（无 Origin） | `403 Forbidden`，`{"success":false,"error":{"code":"LOCAL_QR_ORIGIN_FORBIDDEN","message":"扫码登录来源不被允许"}}` |
| `GET /local/terminal-identity`（`Origin: https://zyidai.cn`） | `200 OK`，`{"success":true,"data":{"terminalId":"t_ksk_001","terminalCode":"KSK-001"}}`，响应头含 `Access-Control-Allow-Origin: https://zyidai.cn`、`Access-Control-Allow-Private-Network: true` |

结论：本地桥接端点默认拒绝无来源请求，只有允许的来源才能读取终端身份；跨源私有网络访问头已就绪。

### 3.2 真实打印首单

- 任务：`ptask_kiosk_337d61d38b698d61`；订单：`cmsirshmc001clga8n1i2ind2`。
- 结果：已出纸张，Kiosk 页面显示任务已完成。
- Agent 日志关键行（`aijobprintagent.out.log`，时间 UTC）：

  ```text
  [2026-08-07T09:56:24.600Z] INFO  task-runner: claimed task ptask_kiosk_337d61d38b698d61
  [2026-08-07T09:56:24.600Z] INFO  task ptask_kiosk_337d61d38b698d61: start — type=print ext=.pdf (mime=application/pdf, name=<中文简历文件名，控制台 GBK 显示为乱码>)
  ```

说明：日志中文文件名经 Windows 控制台 GBK 显示为乱码（如 `鐜嬬绠€鍘?pdf`），真实为中文简历文件名；本记录不落具体文件名/内容，避免泄露用户简历信息。

## 4. 未完成 / 待验收

- **打印机面板扫描**：Agent 日志多次出现 `scan-watcher: scanWatchFolder 未配置，跳过扫描监听`（08:12:40 / 09:42:23 / 09:49:50 UTC 附近）。需按 `docs/device/peripheral-field-acceptance-2026-08.md` 配置 `scanWatchFolder` + 面板扫描到网络/SMB 后复验。
- **扫码枪 → 付款码支付**：未实测；需先按商户开通清单确认微信“付款码支付”开通，并探测 18 位/25–30 位码格式。
- **摄像头**：不接入（已确认决策，无真实业务闭环）。
- **彩色/双面 mode、多主机并发、支付异常路径、生产文件链路**：不在本次单机首单范围内。

## 5. 证据与衔接

- 原始日志：`C:\ProgramData\AIJobPrintAgent\logs\aijobprintagent.out.log`（保留现场副本）。
- 外设验收准备包：`docs/device/peripheral-field-acceptance-2026-08.md`
- Windows 现场总执行单：`docs/device/windows-field-acceptance-runsheet-2026-08.md`
- 云打印 M2 第一片方案：`docs/superpowers/plans/2026-08-07-miniapp-cloud-print-m2-first-slice.md`

## 6. 边界

- 本记录只覆盖单机打印履约首单；不构成像素封板、支付、扫描、多机或生产文件链路验收。
- 打印机型号不得硬编码；未知彩色 mode 不得假设。
- 未连接生产写入、未执行部署；现场只读/本机操作。
