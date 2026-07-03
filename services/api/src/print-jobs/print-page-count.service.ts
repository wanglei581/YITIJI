import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { StorageService } from '../storage/storage.service'
import { verifyFileSignature } from '../files/signing'
import { countPdfPages, isSinglePageImage } from '../files/file-page-count.util'
import type { PrintPageCount } from './print-page-count.types'

/**
 * P0a 后端计费页数识别（支付域底座，无 live 网关）。
 *
 * **绝不信任前端 `file.pages`**：只从本系统 files 服务签发并**验签**的 content URL 解析 fileId，
 * 读取 `FileObject`，经 `StorageService` 读取真实内容识别页数。
 * - PDF：轻量识别 `/Type /Page`；识别不到 / 0 页 → fail-closed。
 * - 图片（png/jpeg/webp）：按 1 页。
 * - 签名不合法 / FileObject 缺失或已删 / 未知 MIME / 读取失败 → fail-closed。
 *
 * fail-closed 语义：抛出 `BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')` 即拒绝创建付费订单，
 * 绝不回退到前端估算或单页假设。（Task 4 只提供能力；接线到建单/报价在 Task 5/6。）
 */
@Injectable()
export class PrintPageCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async resolveBillablePages(fileUrl: string): Promise<PrintPageCount> {
    const fileId = this.parseAndVerifySignedFileId(fileUrl)
    if (!fileId) throw new BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')

    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } })
    if (!file || file.deletedAt) throw new BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')

    if (file.mimeType === 'application/pdf') {
      const buffer = await this.readOrFail(file.storageKey, file.bucket)
      const pages = countPdfPages(buffer)
      if (pages === null || pages <= 0) throw new BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')
      return { billablePages: pages, billingPageSource: 'pdf_lightweight_scan' }
    }

    if (isSinglePageImage(file.mimeType)) {
      return { billablePages: 1, billingPageSource: 'image_single_page' }
    }

    // 未知 / 不支持的 MIME → fail-closed
    throw new BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')
  }

  private async readOrFail(storageKey: string, bucket: string | null): Promise<Buffer> {
    try {
      return await this.storage.getObject(storageKey, bucket)
    } catch {
      throw new BadRequestException('PRINT_PAGE_COUNT_UNAVAILABLE')
    }
  }

  /**
   * 只接受本系统 files 服务签发的签名 content URL（`/api/v1/files/<fileId>/content?expires&sig`），
   * 验签（HMAC + 未过期）通过才返回 fileId，否则 null（SSRF 防护）。
   * 注：与 print-jobs.service 的私有 parseAndVerifySignedFileUrl 同源；Task 6 建单接线时合并去重。
   */
  private parseAndVerifySignedFileId(fileUrl: string): string | null {
    let pathname: string
    let searchParams: URLSearchParams
    try {
      const u = new URL(fileUrl, 'http://internal.local')
      pathname = u.pathname
      searchParams = u.searchParams
    } catch {
      return null
    }
    const fileId = pathname.match(/\/files\/([^/]+)\/content$/)?.[1]
    if (!fileId) return null
    const expires = searchParams.get('expires')
    const sig = searchParams.get('sig')
    if (!expires || !sig) return null
    return verifyFileSignature(fileId, expires, sig) ? fileId : null
  }
}
