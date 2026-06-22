# 补齐 Gate 4 人工证据与 AI 优化产物文件分类链路

## 目标

1. 修复真实 AI 简历优化/修改后导出的 PDF 仍以 `assetCategory=original` 入库的问题。
2. 让 `/resume/generate/export` 产出的确认版简历文件可以作为 `optimized` 用户成果物，并能走长期保存策略。
3. 尽量绑定 `sourceFileId`，使优化/修改后文件能追溯到原始上传简历文件。
4. 将 Gate 4 后续人工证据补齐拆到下一独立任务：浏览器截图、签名 URL 过期等待窗口、COS HEAD/控制台脱敏证据不在本分支执行。

## 非目标

- 不新增 Kiosk 功能入口。
- 不开发招聘平台闭环。
- 不修改腾讯短信、域名 HTTPS、OCR、AI provider、TRTC、ASR/TTS、COS 生命周期或 CAM 权限。
- 不触碰真实用户文件。
- 不做 Windows 真机、打印、扫描验收。

## 设计方案

### A. AI 导出文件分类

当前 `services/api/src/ai/ai.service.ts` 的 `exportGeneratedResume()` 通过 `FilesService.upload()` 写文件，但 `FilesService.upload()` 只有默认 `assetCategory=original`，也不支持 `sourceFileId` 参数。建议做最小改动：

- 给 `FilesService.upload()` 增加可选参数：
  - `assetCategory?: FileAssetCategory`
  - `sourceFileId?: string | null`
- 默认保持现状：未传时仍为 `original` / `null`，避免影响打印、扫描、机构材料等既有上传。
- `AiService.exportGeneratedResume()` 增加可选 `sourceFileId?: string | null` 参数，并传：
  - `assetCategory: 'optimized'`
  - `sourceFileId`
- `AiController.exportGeneratedResume()` 从 `taskId` 查找本人授权的 parse/generate 记录时，优先取 parse payload 中的 `fileId` 作为候选源文件。
- 候选 `sourceFileId` 必须经过四步校验后才能写入：
  1. 通过已授权的 parse/generate 记录推导，不接受前端直接传入。
  2. `FileObject` 行存在；不存在时回退 `null`，不得让导出 500。
  3. 文件归属必须与当前请求者一致；不一致时回退 `null`。
  4. 任一校验失败只是不绑定 `sourceFileId`，不阻断用户导出确认版简历。

### B. 安全与合规

- `sourceFileId` 必须通过既有 AI 记录归属门禁获取，不能相信前端直接传入。
- `sourceFileId` 必须二次校验文件存在和归属，不能只信任 AI 记录里的 payload。
- 审计日志仍只记录元数据，不记录简历正文、完整签名 URL 或 token。
- 原始文件仍不能长期保存；只有 `assetCategory=optimized/derived` 的成果物允许长期保存。
- `optimized` 导出默认仍按既有保存期限策略，不自动长期保存；长期保存必须由会员本人主动确认保存条款后设置。

### C. 验证

- 新增或扩展 API verify 脚本，覆盖：
  - 会员上传原始简历。
  - 会员调用简历生成/导出接口。
  - 导出文件入库为 `assetCategory=optimized`。
  - 导出文件 `sourceFileId` 指向原始文件。
  - 导出文件允许设置 `long_term` 并 `expiresAt=null`。
  - 原始文件设置 `long_term` 仍拒绝。
  - 既有普通上传未传可选参数时仍为 `assetCategory=original`、`sourceFileId=null`。
  - 不带 `taskId` 导出仍成功，但 `sourceFileId=null`。
  - 匿名导出文件不可设置长期保存。
- 更新 Gate 4 文档，把“optimized DB 夹具”改为“真实导出链路可验收”，但仍保留浏览器截图、COS HEAD 和签名 URL 过期证据待补，直到实际执行。

## Gate 4 人工证据执行边界（下一独立任务）

本分支不执行人工证据采集。下一独立任务执行前需再次列出：

- 目标：只补浏览器截图、签名 URL 过期等待窗口、COS HEAD/控制台脱敏证据。
- 非目标：不修改云资源配置、不改 `.env`、不重启 PM2、不触碰真实用户文件。
- 允许写入：受控测试会员文件、测试文件保存期限、测试审计日志、脱敏证据记录。
- 回滚：删除或标记本轮测试文件；如涉及短信 B 方案，必须回滚 `SMS_PROVIDER=tencent` 并复核。

## 停止条件

- 任何真实密钥、token、完整手机号、完整 COS objectKey、完整签名 URL 出现在日志/文档。
- `sourceFileId` 由前端直接信任。
- 原始文件可设置 `long_term`。
- 导出文件无法证明本人归属。
- 会员 B 可访问会员 A 文件。
