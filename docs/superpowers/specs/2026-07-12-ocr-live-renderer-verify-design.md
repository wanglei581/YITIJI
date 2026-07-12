# OCR Live Verify Renderer Design

**Goal:** 让百度 OCR 联网验证使用与运行时扫描件提取相同的 PDF 渲染路径，避免 `unpdf.renderPageAsImage` 与 `@napi-rs/canvas` 1.x 不兼容而产生空白 PNG。

## Scope

- 修改 `services/api/scripts/verify-ocr-baidu-live.ts`：改为调用既有 `openPdfForRender()`，渲染首个 PDF 页面后始终释放 renderer。
- 修改 `services/api/scripts/verify-ocr-baidu.ts`：增加静态防回退断言，禁止 live verify 再使用 `renderPageAsImage`。

## Boundaries

- 不改 `ResumeExtractionService`、`pdf-page-renderer.ts`、OCR provider、依赖版本、Prisma、部署配置或密钥。
- 不把联网 OCR 冒烟纳入 CI；live 验证继续只使用合成简历样张。
- 不改变运行时扫描件提取行为；其已使用兼容渲染器。

## Verification

1. 新增守卫先在旧 live script 上失败，证明能捕获旧的不兼容调用。
2. 替换为 `openPdfForRender()` 后，离线 `verify:ocr-baidu`、API typecheck 与 lint 通过。
3. 在 staging 上用合成样张重跑 `verify:ocr-baidu-live`；只在离线门禁通过后执行，消耗约三次 OCR 调用。
