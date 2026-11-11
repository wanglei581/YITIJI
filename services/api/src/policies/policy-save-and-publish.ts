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
  save: '',
  review: '内容已保存，停在审核。',
  publish: '内容已保存并通过审核，停在发布。',
} as const

/**
 * 一次请求里依次走「保存（提交审核）→ 审核通过 → 发布」。
 * 每一步都调用现有方法，所以三步审计照常各写一条。
 * 某一步被拒就停在那里，前面已经完成的步骤不回滚。
 * 管理员不能走这条路，也不能代审、代发。
 */
export async function saveAndPublishPartnerPolicy(
  policies: PoliciesService,
  user: AuthedUser,
  dto: SaveAndPublishPolicyDto,
  options: { responsibilityAcknowledged?: boolean; id?: string },
): Promise<PolicyPostDto> {
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
    saved = options.id
      ? await policies.updatePartnerPolicy(options.id, fields, user)
      : await policies.createPartnerPolicy(stripNulls(fields), user)
  } catch (error) {
    rethrowStopped(error, 'save')
  }

  try {
    await policies.reviewPolicy(saved.id, 'approve', undefined, user)
  } catch (error) {
    rethrowStopped(error, 'review', saved.id)
  }

  try {
    return await policies.publishPolicy(saved.id, 'publish', user, { responsibilityAcknowledged: true })
  } catch (error) {
    rethrowStopped(error, 'publish', saved.id)
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

function rethrowStopped(error: unknown, stoppedAt: keyof typeof STOP_PREFIX, policyId?: string): never {
  if (!(error instanceof HttpException)) throw error
  const body = error.getResponse()
  const record = typeof body === 'object' && body && 'error' in body
    ? (body as { error?: { code?: string; message?: string } }).error
    : undefined
  const original = typeof record?.message === 'string' && /[\u4e00-\u9fff]/.test(record.message)
    ? record.message
    : '这一步没有完成，请稍后再试'
  const payload = {
    error: {
      code: record?.code ?? 'POLICY_SAVE_AND_PUBLISH_FAILED',
      message: `${STOP_PREFIX[stoppedAt]}${original}`,
      stoppedAt,
      ...(policyId ? { policyId } : {}),
    },
  }
  const status = error.getStatus()
  if (status === 403) throw new ForbiddenException(payload)
  if (status === 404) throw new NotFoundException(payload)
  if (status === 409) throw new ConflictException(payload)
  throw new BadRequestException(payload)
}
