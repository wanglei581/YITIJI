# Windows 一体机现场验收执行单

> 版本：`main@1c60ac62`（2026-08-07）· 执行人：____ · 核对人：____ · 日期：____
> 本单把既有验收文档合并为按序执行步骤，不替代权威来源：`production-deployment-and-windows-host-checklist.md`、`gate-0k-usb-bridge-token-field-acceptance.md`、`gate-0k-smb-scan-field-acceptance.md`、`windows-host-acceptance-runbook.md`、`production-agent-onboarding.md`。
> 每项必须记录证据（脱敏截图、文件 ID、订单/任务 ID、Agent 日志行、时间）；未覆盖项不得在本单画勾。

## 0. 前置与授权

- [ ] 已取得现场执行授权（本机 Windows 主机 + 奔图打印机），且已知发布窗口与回滚联系人。
- [ ] 目标页面为生产 `https://zyidai.cn`（Edge/Chrome Kiosk 模式），非本地 mock。
- [ ] 如使用测试数据，仅用可丢弃的本人账号与小额/免费单，不触碰其他会员数据。

## 1. 环境与版本核对

- [ ] Windows 版本、Edge/Chrome 版本、Kiosk 启动参数记录。
- [ ] Agent 服务 `AIJobPrintAgent` 为 Running / Automatic；日志路径可用。
- [ ] `netstat -ano | findstr "9527"` 确认 local API 仅监听 `127.0.0.1`。
- [ ] `GET http://127.0.0.1:9527/local/terminal-identity`（正确 Origin）只返回 `terminalId` / `terminalCode`；错误 Origin 返回 403，且不泄露 token/API URL/打印机名/本地路径。
- [ ] `localApiBridgeToken` 与 Kiosk `VITE_TERMINAL_AGENT_BRIDGE_TOKEN` 一致；未配置时 `/local/usb/*` 与 `/local/print/wake` fail-closed。
- [ ] `printerName` 配置为 Windows 实际识别名（现场 `Pantum CM2800ADN Series`），代码/配置无硬编码其他型号。
- [ ] `https://zyidai.cn/api/v1/health` 返回 `status=ok` / `db=postgres`。
- [ ] 首页 bundle 与 `DEPLOY_SOURCE` / PM2 `COMMIT` 一致（当前 `e78f3668`，如已前进以现场为准）。

## 2. 上传链路

- [ ] 本机上传：真实 PDF / JPG / PNG 各一，页内显示真实内容（PDF 插件肉眼可见，不只 iframe 200）；10MB 边界与错误扩展名提示。
- [ ] 手机扫码上传：二维码拉起本人会话，`resume_upload` 归属正确，30 分钟短时预览 URL 不落 Storage/Cookie。
- [ ] U 盘：插拔识别、隐藏文件、PDF/JPG/PNG、10MB 边界；`/local/usb/*` 走 bridge token；无 U 盘时 `usb` tab 诚实禁用。
- [ ] 会员 / 匿名身份：本人文件只进本人“我的文档”；匿名会话不附会员 Bearer。
- [ ] 错误恢复：上传失败/取消不产生脏数据；重复点击被 busy 锁抑制；退出/清场后无残留预览。

## 3. 扫描链路

- [ ] SMB/扫描目录真实生成 PDF/图片，文件进入“我的文档”。
- [ ] 扫描失败有明确提示且不伪造文件；扫描会话与隐私删除路径可用。
- [ ] 若现场做“身份证复印”：证件放置 → 扫描 → A4 排版 → 真实出纸全链路；产物不落长期存储并按敏感文件策略清理、有删除日志。

## 4. 打印履约链路

- [ ] 免费单：建单 → Agent 领取 → 真实出纸 → 进度 `pending → claimed → printing → completed` → 完成页/取件闭环。
- [ ] 已支付单：收银页服务端确认 `paid` 后才可 claim；未支付不可 claim。
- [ ] wake 加速：`POST http://127.0.0.1:9527/local/print/wake`（无 body/query）在已授权任务上返回 202；连续点击/刷新不重复出纸；Agent/loopback 离线时回落周期 claim，不报业务失败。
- [ ] 串行性：两笔任务严格串行，无并发领取/重复出纸；PrintService/计数器/任务状态一致。
- [ ] 失败/异常：打印失败可重试或按既有订单核查/退款路径处理；Agent 重启后任务不丢、不重复出纸。

## 5. 异常与隐私

- [ ] 断网/重启恢复：Kiosk 与 Agent 重启后会话/任务可恢复，不误清后台打印。
- [ ] 隐私超时清场：普通 idle 与硬截止均 fail-closed，历史/回退/BFCache 不可恢复。
- [ ] 敏感文件清理：打印/扫描完成后本地与云端临时文件按 TTL/删除策略清理，删除有日志。
- [ ] `/contract-review` 保持 fail-closed（默认不可用），未开放格式（Word 打印转换/政策附件/合同报告）不恢复为可点击占位。

## 6. 多主机（如现场 ≥2 台）

- [ ] 每台显示的 `terminalCode`、Agent 心跳、Admin 设备在线状态正确。
- [ ] 向指定主机下发可识别任务，仅目标主机领取，另一台不领取；每台至少一次真实出纸。
- [ ] 同一发布批次共享 bridge token 的口径已确认；若要求每机不同，先完成运行时本机会话凭证再启用 QR/U 盘。

## 7. 收尾

- [ ] 汇总证据：本单勾选项 + 脱敏截图 + 文件/订单/任务 ID + Agent 日志行 + PrintService 事件。
- [ ] 未通过项单独列出原因与阻塞等级；不把部分通过写成整机商用通过。
- [ ] 验收结论写入 `docs/progress/current-progress.md` / `next-tasks.md` 并提交（带证据引用）。

## 8. 边界声明

- 本单通过 ≠ 像素封板；未覆盖彩色/双面未知 mode、真实支付渠道全部异常、多机批量灰度与生产文件链路验收。
- 打印机型号不得硬编码；未知彩色 mode 不得假设。
- 未获部署授权前，现场只读/操作本机，不覆盖线上 Kiosk/API。
