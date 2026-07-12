# Node 20 PDF Renderer Compatibility Design

**Goal:** 让 `unpdf` 1.6.2 的 pdfjs 在 Node 20 环境也能将扫描版 PDF 渲染为非空 PNG，恢复 OCR 前置渲染能力。

## Root cause

预生产 Node 20.20.2 缺少 `ArrayBuffer.prototype.transferToFixedLength`。`unpdf` 内嵌 pdfjs 在页面 operator-list 处理中调用该 API，异常被 pdfjs 降级为 warning 后返回空白画布。相同锁文件在 Node 22.22.3 下具备该 API，合成 PDF 探针产生非空像素。预生产独立进程临时注入内容拷贝兼容实现后，同一探针恢复有效像素。

## Scope

- 在 `pdf-page-renderer.ts` 中增加仅当宿主 API 缺失时生效的 `transferToFixedLength` 兼容函数，并在 `openPdfForRender()` 调用 pdfjs 前执行。
- 在既有离线 OCR verify 中删除该 API 来模拟 Node 20，断言兼容函数正确安装、保留字节语义，并让既有扫描 PDF 真实渲染回归继续运行。

## Boundaries

- 不升级服务器 Node、不改 package 版本或 lockfile、不改 OCR Provider / API / Prisma / 密钥。
- 兼容函数不记录输入内容、不会发起网络请求，仅拷贝调用方提供的内存 buffer。
- Node 原生支持该 API 时不替换、不包装原实现；Node 20 无法模拟原生 transfer 的 detach 行为，因此只实现 pdfjs 所需的固定长度内容拷贝语义。

## Verification

1. 先让离线 verify 调用不存在的兼容函数，确认 RED。
2. 实现后重跑 14 项离线 OCR verify、API typecheck、lint 和 diff 检查。
3. 用 Node 20 预生产无网络渲染探针确认 PNG 非空；随后才运行一次合成样张的真实百度 OCR live verify。
