import type { PrismaService } from '../prisma/prisma.service'
import { verifyFileSignature } from './signing'

const CONTENT_PATH = /^\/api\/v1\/files\/([^/]+)\/content$/

export type SignedContentGrant = {
  fileId: string
  expires: string
  sig: string
}

/**
 * 从本次签名地址取出编号、到期时间与签名。
 * 接受相对路径、带协议和域名的地址、百分号编码的编号、尾部斜杠和片段。
 * 重复的查询参数只取第一组。路径对不上则返回空。
 */
export function parseSignedContentUrl(url: string | null | undefined): SignedContentGrant | null {
  if (!url || typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url, 'http://local')
  } catch {
    return null
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  const matched = CONTENT_PATH.exec(pathname)
  if (!matched?.[1]) return null
  let fileId: string
  try {
    fileId = decodeURIComponent(matched[1])
  } catch {
    return null
  }
  if (!fileId || fileId.includes('/') || fileId.includes('\\') || fileId.includes('\0')) return null
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decodedPath !== `/api/v1/files/${fileId}/content`) return null
  const expires = parsed.searchParams.get('expires')
  const sig = parsed.searchParams.get('sig')
  if (!expires || !sig) return null
  return { fileId, expires, sig }
}

/** 签名地址未过期，且编号与这份文件一致。 */
export function assertGuestFileProof(fileId: string, url: string | null | undefined): boolean {
  const grant = parseSignedContentUrl(url)
  if (!grant || grant.fileId !== fileId) return false
  return verifyFileSignature(grant.fileId, grant.expires, grant.sig)
}

/**
 * 没查到带会员主人的文件行时，调用方必须另持本次签名地址。
 * 没有这一行、已删除、未就绪、已过期，或这一行没有会员主人，都要证明。
 * 只有查到 endUserId 不为空的行才不要证明。
 * 拿不到 fileObject.findUnique 时直接报错。
 */
export async function fileNeedsHolderProof(
  prisma: Pick<PrismaService, 'fileObject'>,
  fileId: string,
): Promise<boolean> {
  if (typeof prisma?.fileObject?.findUnique !== 'function') {
    throw new Error('文件记录读取不可用')
  }
  const row = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { endUserId: true },
  })
  return !row?.endUserId
}
