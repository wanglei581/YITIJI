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

type OwnerlessFileRow = {
  endUserId: string | null
  deletedAt: Date | null
  status: string
  expiresAt: Date | null
}

/**
 * 仍可使用、且没有会员主人的文件，调用方必须另持本次签名地址。
 * 不存在、已删除、未就绪、已过期或已有会员主人的文件交给原有校验。
 * 测试桩没有 fileObject 时同样交给原有校验。
 */
export async function ownerlessActiveFileNeedsProof(
  prisma: object | null | undefined,
  fileId: string,
): Promise<boolean> {
  const findUnique = (prisma as {
    fileObject?: { findUnique?: (args: unknown) => Promise<OwnerlessFileRow | null> }
  } | null | undefined)?.fileObject?.findUnique
  if (typeof findUnique !== 'function' || !fileId) return false
  const row = await findUnique({
    where: { id: fileId },
    select: { id: true, endUserId: true, deletedAt: true, status: true, expiresAt: true },
  })
  if (!row || row.deletedAt || row.status !== 'active') return false
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return false
  if (row.endUserId) return false
  return true
}
