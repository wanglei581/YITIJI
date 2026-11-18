/**
 * 版式调整的 resume_ai 授权。从 verify-resume-layout-adjust.ts 拆出：
 * 那份脚本已经超过 500 行，而这四条不需要桩模型。
 *
 * 11. 未同意 → 403，且不调用版式调整。
 * 11g. 游客不拦截。
 * 12. 已同意 → 照常调整。
 * 13. 撤回后再拒绝，且不再调用。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:resume-layout-adjust-consent
 */
import { ResumeLayoutAdjustController } from '../src/ai/resume-layout-adjust.controller'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

const baseResume: GeneratedResume = {
  basic: { name: 'Alex Chen', phone: '13800000000', email: 'alex@example.com' },
  intention: { position: '前端开发工程师' },
  summary: '',
  education: [],
  experience: [],
  projects: [],
  skills: [],
  certificates: [],
}

async function assertLayoutAdjustConsent(): Promise<void> {
  type ConsentRow = {
    id: string
    endUserId: string
    scope: string
    consentVersion: string
    grantedAt: Date
    revokedAt: Date | null
    terminalId: string | null
  }
  const rows: ConsentRow[] = []
  let seq = 0
  const memory = {
    userAiConsent: {
      findFirst: async (args: { where: { endUserId: string; scope: string } }) => {
        const matched = rows.filter((row) => row.endUserId === args.where.endUserId && row.scope === args.where.scope)
        matched.sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime() || (a.id < b.id ? 1 : -1))
        return matched[0] ?? null
      },
      create: async (args: { data: { endUserId: string; scope: string; consentVersion: string; terminalId: string | null } }) => {
        const row: ConsentRow = {
          id: `c${++seq}`,
          grantedAt: new Date(),
          revokedAt: null,
          terminalId: args.data.terminalId,
          endUserId: args.data.endUserId,
          scope: args.data.scope,
          consentVersion: args.data.consentVersion,
        }
        rows.push(row)
        return row
      },
      updateMany: async (args: { where: { endUserId: string; scope: string; revokedAt: null }; data: { revokedAt: Date } }) => {
        let count = 0
        for (const row of rows) {
          if (row.endUserId === args.where.endUserId && row.scope === args.where.scope && row.revokedAt == null) {
            row.revokedAt = args.data.revokedAt
            count += 1
          }
        }
        return { count }
      },
    },
  }
  const privacy = new MemberPrivacyService(memory as never)
  let aiCalls = 0
  const ai = {
    adjustResumeLayout: async () => {
      aiCalls += 1
      return { resume: baseResume, warnings: [] as string[] }
    },
  }
  const controller = new ResumeLayoutAdjustController(
    ai as never, { write: async () => undefined } as never, {} as never, {} as never, {} as never, privacy,
  )
  const memberId = 'layout-member'
  const asMember = async () => ({ endUserId: memberId, accessToken: null as string | null })
  const asGuest = async () => ({ endUserId: null as string | null, accessToken: 'tok' })
  const bind = (fn: typeof asMember) => {
    ;(controller as unknown as { resolveAiResultRequester: typeof asMember }).resolveAiResultRequester = fn
  }
  const dto = { resume: baseResume, action: 'condense' as const }
  const req = { headers: {} }
  const shape = (e: unknown) => {
    const ex = e as { getStatus?: () => number; getResponse?: () => { error?: { code?: string; message?: string } } }
    const body = ex.getResponse?.()
    return { status: ex.getStatus?.() ?? 0, code: body?.error?.code, message: body?.error?.message }
  }
  bind(asMember)
  try {
    await controller.adjustResumeLayout('task-layout', dto, req)
    fail('11. 未同意不应调整版式')
  } catch (e) {
    const info = shape(e)
    if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
      fail(`11. 拒绝形态不符: ${JSON.stringify(info)}`)
    }
  }
  if (aiCalls !== 0) fail('11. 未同意时调用了版式调整')
  pass('11. 未同意 resume_ai → 403，且未调用版式调整')

  bind(asGuest)
  await controller.adjustResumeLayout('task-layout', dto, req)
  if (aiCalls !== 1) fail('11g. 游客应放行并调用版式调整')
  pass('11g. 游客不拦截')

  bind(asMember)
  await privacy.grantConsent(memberId, 'resume_ai', null)
  await controller.adjustResumeLayout('task-layout', dto, req)
  if (aiCalls !== 2) fail('12. 已同意应调用版式调整')
  pass('12. 已同意 resume_ai → 照常调整版式')

  await privacy.revokeConsent(memberId, 'resume_ai')
  try {
    await controller.adjustResumeLayout('task-layout', dto, req)
    fail('13. 撤回后不应再调整')
  } catch (e) {
    const info = shape(e)
    if (info.status !== 403 || info.code !== 'USER_AI_CONSENT_REQUIRED' || info.message !== '请先确认简历 AI 服务授权') {
      fail(`13. 撤回后拒绝形态不符: ${JSON.stringify(info)}`)
    }
  }
  if (aiCalls !== 2) fail('13. 撤回后仍调用了版式调整')
  pass('13. 同意后撤回 → 再次拒绝且未调用版式调整')
}

async function main(): Promise<void> {
  console.log('\n=== 版式调整 resume_ai 授权 ===')
  await assertLayoutAdjustConsent()
  console.log('\n=== ALL PASS ===')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('VERIFY FAILED:', message)
  process.exit(1)
})
