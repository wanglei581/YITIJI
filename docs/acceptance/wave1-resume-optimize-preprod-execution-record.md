# Wave 1 AI 简历优化闭环 · 预生产执行记录

> 状态：RW1-G1~RW1-G3 与 Windows 服务模式真机打印已通过。
> 本文件只记录脱敏摘要；原始日志、完整签名 URL、token、验证码、真实用户文件和现场照片不得进入 Git。

## 一、候选与环境

- 代码链路：PR #121（Wave 1 代码）、PR #122（验收 runbook）、PR #123（PDF `printFileUrl` hotfix）已合入。
- 预生产曾完成 RW1-G1~RW1-G3：真实 LLM、PostgreSQL、COS、OCR、会员四格式导出、`/me/documents`、PDF `printFileUrl` 安全探针。
- 后续部署已引入 DP-GATE，当前预生产部署源为 `6497c5a4`，公网 health 为 `db=postgres`。
- Windows 终端：`KSK-001` / `t_ksk_001`。
- 打印机：`Pantum CM2800ADN Series`。
- Terminal Agent：`0.3.0`，先前台模式验证，再安装 `AIJobPrintAgent` Windows 服务并验证服务模式心跳。

## 二、真机打印补证

### 2.1 前台 Agent 受控测试页

- 测试内容：无个人信息的受控 PDF 测试页。
- `PrintTask`：`ptask_kiosk_bb8ee9802e7ee1c1`。
- 状态链路：`pending -> claimed -> printing -> completed`。
- 认领终端：`t_ksk_001`。
- 完成时间：`2026-07-03 16:34:04`。
- 错误码：无。

### 2.2 Windows 服务模式受控测试页

- 测试内容：无个人信息的服务模式 PDF 测试页。
- `PrintTask`：`ptask_kiosk_6d751fe0210f1aef`。
- 状态链路：`pending -> claimed -> printing -> completed`。
- 认领终端：`t_ksk_001`。
- 完成时间：`2026-07-03 17:04:00`。
- 错误码：无。

### 2.3 合成简历优化版 PDF 真机打印

- 测试内容：合成简历，不含真实个人信息，用于验收 AI 简历链路。
- 上传源文件：`FileObject` 前缀 `c2ab75402240...`，`purpose=resume_upload`，`assetCategory=original`。
- 诊断 / 优化任务：`llm-ai-1783098434497-1`。
- Provider：诊断 `llm`，优化 `llm`。
- 优化版 PDF：`FileObject` 前缀 `4e6b84c165fd...`，`purpose=resume_upload`，`assetCategory=optimized`，`createdBy=ai_resume_generate`。
- `PrintTask`：`ptask_kiosk_4aeb9125b84c4a5c`。
- 状态链路：`pending -> printing -> completed`（DB 记录含 `claimedAt`）。
- 认领终端：`t_ksk_001`。
- 完成时间：`2026-07-03 17:08:00`。
- 错误码：无。

## 三、测试数据处置

当前仅做 SELECT 范围确认，未执行 DELETE。

命中测试数据：

- `PrintTask`：3 行，均 `completed`，均绑定 `t_ksk_001`。
- `FileObject`：4 行，均为匿名测试文件；其中两行为 `print_doc/original` 受控测试页，两行为合成简历 `resume_upload` 源文件与优化版 PDF。
- `AiResumeResult`：`taskId=llm-ai-1783098434497-1` 的 `parse` / `optimize` 两行。

处置口径：

- 可保留这些匿名测试数据作为验收证据，等待 TTL / 生命周期清理。
- 如需清理，必须先再次 SELECT 确认只命中上述测试 ID，再删除；不得按会员账号、时间范围或 purpose 泛删。
- COS 对象如无专用删除工具，避免只删 DB 造成对象孤儿；可按生命周期策略清理。

## 四、完成口径

可以宣称：

- AI 简历优化 Wave 1 已完成代码合并、预生产真实 LLM / PostgreSQL / COS / 会员四格式导出验收。
- PDF 打印链路已完成 Windows Terminal Agent 前台模式与服务模式真机验证。
- 合成简历优化版 PDF 已通过 `printFileUrl -> PrintTask -> Agent claim -> Pantum 出纸 -> completed` 链路。

不得宣称：

- 正式生产上线完成。
- docx / txt / md 可直接打印完成。
- 支付 / 计费 / 套餐 / 卡券完成。
- 语音生成简历、岗位 URL/JD 定向优化、格式转换、扫描 / U 盘等后续 Wave 已完成。
- 旧 Wave2/3/4 部署数据丢失事故原因已完全坐实；该项仍按 DP-GATE 与追证清单单独处理。
