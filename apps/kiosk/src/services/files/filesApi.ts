// ============================================================
// Kiosk File Upload API — W7
//
// POST /api/v1/files/kiosk-upload
//   - Multipart form upload (anonymous, no JWT)
//   - Returns signedUrl (5-min HMAC TTL), sha256, fileId
//
// 哈希说明（方案②）：后端计算的是 **SHA-256**（sha256 字段）。提交打印任务时，
// 调用方把它放进 createPrintJob 的 `fileMd5` 字段（wire 字段名暂未改名以避免跨端
// rename + Prisma migration）。Terminal Agent 据此用 SHA-256 重算并比对。
// 后续 fileSha256 命名清理时再统一改名。
//
// 注意：本模块过去自带一份直连 fetch 的 kioskUploadFile，与
// services/api/files.ts 的 adapter 版（支持 mock + http、需传 purpose）签名/返回
// 不一致，易混淆。现统一转发到 adapter 版，保留 print 流程「单参数 + 默认
// print_doc」的调用习惯不变，同时获得 mock 模式支持。返回类型为 shared 的
// FileUploadResponse（结构与旧 KioskUploadResult 完全一致）。
// ============================================================

import type { FileUploadResponse } from '@ai-job-print/shared'
import { kioskUploadFile as kioskUploadFileWithPurpose } from '../api/files'

/** @deprecated 使用 shared 的 FileUploadResponse；此别名仅为向后兼容保留。 */
export type KioskUploadResult = FileUploadResponse

/**
 * Kiosk 打印文档上传（匿名，无 JWT）。purpose 固定为通用打印文档 'print_doc'。
 * 需要其它业务 purpose（如简历/证件）时请直接使用 services/api 的 kioskUploadFile。
 */
export function kioskUploadFile(file: File): Promise<FileUploadResponse> {
  return kioskUploadFileWithPurpose(file, 'print_doc')
}
