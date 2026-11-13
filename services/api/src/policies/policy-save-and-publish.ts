import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  ADMIN_POLICY_PUBLISH_DISABLED_CODE,
  POLICY_RESPONSIBILITY_ACK_REQUIRED_CODE,
} from '../recruitment-hosting/recruitment-hosting'
import type { CreatePolicyPostDto, SaveAndPublishPolicyDto, UpdatePolicyPostDto } from './dto/policy.dto'
import type { PoliciesService, PolicyPostDto } from './policies.service'

const STOP_PREFIX = {
  review: '内容已保存，停在审核。',
  publish: '内容已保存并通过审核，停在发布。',
} as const

export interface SaveAndPublishOutcome {
  /** 这条政策现在的样子。中途停下时，是已保存（或已审核通过）但还没发布的状态。 */
  policy: PolicyPostDto
  /** 三步都走完为 null；中途停下时写明停在哪一步、为什么。 */
  stopped: { at: keyof typeof STOP_PREFIX; code: string; message: string } | null
}

/**
 * 一次请求里依次走「保存（提交审核）→ 审核通过 → 发布」。
 * 每一步都调用现有方法，所以三步审计照常各写一条。
 * 某一步被拒就停在那里，前面已经完成的步骤不回滚。
 * 管理员不能走这条路，也不能代审、代发。
 *
 * 保存这一步被拒：什么都没写进去，照常抛错。
 * 审核或发布被拒：内容已经保存，所以不抛错，而是把这条政策连同「停在哪一步、为什么」一起返回。
 * 全局错误过滤器只放行错误码和一句话，政策编号带不出去；页面拿不到编号，
 * 改完再点一次就会新建出第二条。放在正常返回里，页面才能接着改同一条。
 */
export async function saveAndPublishPartnerPolicy(
  policies: PoliciesService,
  user: AuthedUser,
  dto: SaveAndPublishPolicyDto,
  options: { responsibilityAcknowledged?: boolean; id?: string },
): Promise<SaveAndPublishOutcome> {
  if (user.role !== 'partner') {
    throw new ForbiddenException({
      error: {
        code: ADMIN_POLICY_PUBLISH_DISABLED_CODE,
        message: '管理员不能代为审核或发布政策，请由机构自己操作',
      },
    })
  }
  if (options.responsibilityAcknowledged !== true) {
    throw new BadRequestException({
      error: {
        code: POLICY_RESPONSIBILITY_ACK_REQUIRED_CODE,
        message: '发布前必须确认对本条政策内容负责',
      },
    })
  }

  let saved: PolicyPostDto
  try {
    const fields = withoutAck(dto)
    const { publishWarning, ...policy } = options.id
      ? await policies.updatePartnerPolicy(options.id, fields, user)
      : await policies.createPartnerPolicy(stripNulls(fields), user)
    void publishWarning
    saved = policy
  } catch (error) {
    rethrowSaveRejected(error)
  }

  let approved: PolicyPostDto
  try {
    approved = await policies.reviewPolicy(saved.id, 'approve', undefined, user)
  } catch (error) {
    return { policy: saved, stopped: stoppedBy(error, 'review') }
  }

  try {
    const published = await policies.publishPolicy(saved.id, 'publish', user, { responsibilityAcknowledged: true })
    return { policy: published, stopped: null }
  } catch (error) {
    return { policy: approved, stopped: stoppedBy(error, 'publish') }
  }
}

function withoutAck(dto: SaveAndPublishPolicyDto): UpdatePolicyPostDto {
  const { responsibilityAcknowledged, ...fields } = dto
  void responsibilityAcknowledged
  return fields
}

/** 新建不接受 null。编辑里用来清空的 null，在新建时直接省略。 */
function stripNulls(dto: UpdatePolicyPostDto): CreatePolicyPostDto {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(dto)) {
    if (value !== null && value !== undefined) next[key] = value
  }
  return next as unknown as CreatePolicyPostDto
}

/** 取出服务端写的中文原因；没有的话给一句能照着做的兜底。 */
function readRejection(error: HttpException): { code: string | undefined; message: string } {
  const body = error.getResponse()
  const record = typeof body === 'object' && body && 'error' in body
    ? (body as { error?: { code?: string; message?: string } }).error
    : undefined
  // 404 多半是这一条已被删掉，稍后再试也没用，直接说该怎么办。
  const fallback = error.getStatus() === 404 ? '这条政策已经不在了，请刷新列表后再操作' : '这一步没有完成，请稍后再试'
  const message = typeof record?.message === 'string' && /[\u4e00-\u9fff]/.test(record.message)
    ? record.message
    : fallback
  return { code: typeof record?.code === 'string' ? record.code : undefined, message }
}

/** 审核或发布被拒：内容已经保存，把原因交回去。不是业务拒绝（例如数据库出错）的照常抛出。 */
function stoppedBy(error: unknown, at: keyof typeof STOP_PREFIX): NonNullable<SaveAndPublishOutcome['stopped']> {
  if (!(error instanceof HttpException)) throw error
  const { code, message } = readRejection(error)
  return { at, code: code ?? 'POLICY_SAVE_AND_PUBLISH_FAILED', message: `${STOP_PREFIX[at]}${message}` }
}

/** 保存被拒：什么都没写进去。保留原来的状态码和错误码，只把没有中文的原因换成兜底句。 */
function rethrowSaveRejected(error: unknown): never {
  if (!(error instanceof HttpException)) throw error
  const { code, message } = readRejection(error)
  const payload = { error: { code: code ?? 'POLICY_SAVE_AND_PUBLISH_FAILED', message } }
  const status = error.getStatus()
  if (status === 403) throw new ForbiddenException(payload)
  if (status === 404) throw new NotFoundException(payload)
  if (status === 409) throw new ConflictException(payload)
  throw new BadRequestException(payload)
}
