/**
 * 规范 objectKey 生成。
 *
 * 合规 / 安全约束(CLAUDE.md §11、用户需求三):
 *   - 绝不用原始文件名作为 COS key(原始名含 PII / 不可控字符 / 可枚举)。
 *   - 统一前缀分桶,便于按 owner / 用途做生命周期与授权:
 *       users/{userId}/resumes/{fileId}.{ext}
 *       users/{userId}/scans/{fileId}.{ext}
 *       users/{userId}/print-files/{fileId}.{ext}
 *       partners/{partnerOrgId}/profiles/{fileId}.{ext}
 *       partners/{partnerOrgId}/job-images/{fileId}.{ext}
 *       partners/{partnerOrgId}/job-fair-materials/{fileId}.{ext}
 *       partners/{partnerOrgId}/videos/{fileId}.{ext}
 *       admin/uploads/{fileId}.{ext}
 *       screensaver/materials/{fileId}.{ext}
 *       tmp/uploads/{uploadSessionId}/{fileId}.{ext}
 *   - objectKey 全程限制在 [A-Za-z0-9/_.-],杜绝路径穿越(../)与编码歧义。
 *
 * fileId / uploadSessionId 由调用方提供(cuid / uuid hex),本模块不生成随机数,
 * 以保持纯函数、可单测、可在 workflow resume 下确定性复现。
 */

import type { FilePurpose } from '../files/file.types'

/** owner 维度。决定 objectKey 顶层归属与授权边界。 */
export type FileOwnerType = 'user' | 'partner' | 'admin' | 'system'

export interface ObjectKeyArgs {
  purpose: FilePurpose
  ownerType: FileOwnerType
  /** user→endUserId / partner→orgId / admin→userId;system / 匿名为 null。 */
  ownerId: string | null
  /** 文件主键(cuid / uuid hex)。作为 objectKey 文件名,避免冲突与 PII。 */
  fileId: string
  /** 扩展名(不带点)。 */
  ext: string
  /** 匿名 / temp 用途时的会话分桶 id;缺省回退用 fileId。 */
  uploadSessionId?: string | null
}

/** 仅保留安全字符,防注入 / 路径穿越;非法字符替换为 ''。 */
function safeSegment(input: string, fallback: string): string {
  const cleaned = (input ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

/** 扩展名归一:小写 + 去点 + 仅字母数字,最长 10,空则 'bin'。 */
export function normalizeExt(ext: string): string {
  return (ext ?? '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10) || 'bin'
}

/**
 * purpose → 在 owner 前缀下的二级目录。
 * owner-scoped 的用途(简历/扫描/打印/机构素材)需要 ownerId;
 * 缺 ownerId 时由 generateObjectKey 回退到 tmp/。
 */
const PURPOSE_FOLDER: Record<FilePurpose, { scope: 'user' | 'partner' | 'admin' | 'screensaver' | 'tmp'; folder: string }> = {
  // ── C 端求职者(users/{userId}/...)──────────────────────────────
  resume_upload: { scope: 'user', folder: 'resumes' },
  cover_letter: { scope: 'user', folder: 'resumes' },
  resume_scan: { scope: 'user', folder: 'scans' },
  id_scan: { scope: 'user', folder: 'scans' },
  print_doc: { scope: 'user', folder: 'print-files' },
  signature_source: { scope: 'user', folder: 'signatures' },
  // ── 合作机构(partners/{orgId}/...)─────────────────────────────
  partner_profile: { scope: 'partner', folder: 'profiles' },
  partner_image: { scope: 'partner', folder: 'job-images' },
  partner_video: { scope: 'partner', folder: 'videos' },
  job_fair_material: { scope: 'partner', folder: 'job-fair-materials' },
  fair_material: { scope: 'partner', folder: 'job-fair-materials' },
  // ── 平台运营 ─────────────────────────────────────────────────────
  admin_upload: { scope: 'admin', folder: 'uploads' },
  screensaver_material: { scope: 'screensaver', folder: 'materials' },
  temp: { scope: 'tmp', folder: 'uploads' },
}

/**
 * 生成规范 objectKey。owner 信息缺失时安全回退到 tmp/uploads/{session}/...
 * (短期留存,由清理策略回收),绝不把无主敏感文件落到 users/ 持久前缀。
 */
export function generateObjectKey(args: ObjectKeyArgs): string {
  const ext = normalizeExt(args.ext)
  const fileId = safeSegment(args.fileId, 'file')
  const mapping = PURPOSE_FOLDER[args.purpose] ?? PURPOSE_FOLDER.temp
  const session = safeSegment(args.uploadSessionId ?? fileId, fileId)

  switch (mapping.scope) {
    case 'user': {
      if (!args.ownerId) return `tmp/uploads/${session}/${fileId}.${ext}`
      return `users/${safeSegment(args.ownerId, 'unknown')}/${mapping.folder}/${fileId}.${ext}`
    }
    case 'partner': {
      if (!args.ownerId) return `tmp/uploads/${session}/${fileId}.${ext}`
      return `partners/${safeSegment(args.ownerId, 'unknown')}/${mapping.folder}/${fileId}.${ext}`
    }
    case 'admin':
      return `admin/${mapping.folder}/${fileId}.${ext}`
    case 'screensaver':
      return `screensaver/${mapping.folder}/${fileId}.${ext}`
    case 'tmp':
    default:
      return `tmp/uploads/${session}/${fileId}.${ext}`
  }
}

/** 从 purpose 推断默认 ownerType(调用方可显式覆盖)。 */
export function defaultOwnerType(purpose: FilePurpose): FileOwnerType {
  const mapping = PURPOSE_FOLDER[purpose]
  if (!mapping) return 'system'
  if (mapping.scope === 'user') return 'user'
  if (mapping.scope === 'partner') return 'partner'
  if (mapping.scope === 'admin') return 'admin'
  return 'system'
}
