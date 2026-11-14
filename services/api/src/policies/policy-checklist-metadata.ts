import { ConflictException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { scopeForAmbientPolicyRead } from './policy-scope.service'
import { publicPolicyLookupWhere } from './policy-public-visibility'

const PREFIX = 'policy_checklist:'

/** FileObject.createdBy 的系统来源标记；不用用户归属列存政策编号。 */
export function checklistMetadata(policyId: string, contentVersion: number): string {
  return PREFIX + JSON.stringify({ policyId, contentVersion })
}

function readMetadata(value: string | null | undefined): { policyId: string; contentVersion: number } | null {
  if (!value?.startsWith(PREFIX)) return null
  try {
    const data = JSON.parse(value.slice(PREFIX.length))
    return typeof data.policyId === 'string' && data.policyId.length > 0
      && Number.isSafeInteger(data.contentVersion) && data.contentVersion > 0 ? data : null
  } catch {
    return null
  }
}

/** 在所有共享打印建单闸门中使用，且必须早于派生件免检查的 return。 */
export async function assertPolicyChecklistPrintable(
  prisma: PrismaService,
  file: { purpose: string; createdBy?: string | null },
): Promise<void> {
  if (file.purpose !== 'policy_checklist') return
  const metadata = readMetadata(file.createdBy)
  const policy = metadata && await prisma.policyPost.findFirst({
    where: await publicPolicyLookupWhere(prisma, {
      id: metadata.policyId, reviewStatus: 'approved', publishStatus: 'published',
    }, await scopeForAmbientPolicyRead()),
    select: { contentVersion: true },
  })
  if (!policy) {
    throw new ConflictException({ error: {
      code: 'POLICY_CHECKLIST_WITHDRAWN', message: '这条政策已经撤下，清单不能再打印。',
    } })
  }
  if (policy.contentVersion !== metadata!.contentVersion) {
    throw new ConflictException({ error: {
      code: 'POLICY_CHECKLIST_WITHDRAWN', message: '这条政策刚更新过，请回到政策页重新生成清单。',
    } })
  }
}
