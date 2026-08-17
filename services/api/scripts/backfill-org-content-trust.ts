/**
 * 机构内容信任(contentTrustStatus)回填 —— **只对显式列出的机构 id 生效**。
 *
 * 发布闸门(services/api/src/common/content-trust.ts)是 fail-closed 的:
 * 机构没被显式标成 active,其内容就发布不了。回填脚本的存在是为了把「已经
 * 完成来源授权核验」的存量机构一次性标上,而不是为了绕开闸门。
 *
 * 因此本脚本**故意没有** `--all` / `--everything` 之类的开关:
 *   一键把所有机构标成 active，等于把闸门拆了再装个空壳。
 * 必须显式传 --ids,一个都不能少。
 *
 * 用法:
 *   # 1) 先 dry-run(默认):只打印每个机构改前/改后,不写库
 *   pnpm --filter @ai-job-print/api maintenance:backfill-org-content-trust \
 *     -- --ids=org-a,org-b --reason="2026-08 授权书 XX-123"
 *
 *   # 2) 确认无误后加 --apply 才真正写库 + 写审计
 *   pnpm --filter @ai-job-print/api maintenance:backfill-org-content-trust \
 *     -- --ids=org-a,org-b --reason="2026-08 授权书 XX-123" --apply
 *
 * 参数:
 *   --ids=a,b,c    必填。要标记的机构 id,逗号分隔。可重复传。
 *   --reason=...   必填。核验依据(授权书/合同/公开声明编号),会进 AuditLog。
 *   --status=...   可选,默认 active。取值 pending/active/suspended/revoked。
 *   --actor=...    可选。**必须是真实 User.id**(AuditLog.actorId 有 FK → User);
 *                  不传或不存在时,审计 actorId 落 null、actorRole 落
 *                  'script:backfill-org-content-trust',执行人记在 payload.operator。
 *   --operator=... 可选。执行人标识(姓名/工号),只进 payload,不做 FK 校验。
 *   --apply        可选。不传 = dry-run。
 *
 * 安全行为:
 *   - id 不存在:报告 MISSING,不创建机构,不静默跳过。
 *   - 机构已归档(archivedAt 非空)且要标 active:拒绝该条,原因照实打印。
 *   - 已经是目标状态:报告 NOOP,仍然重写 reviewedBy/At(这是一次新的人工决策),
 *     但只在 --apply 时写。
 *   - 任何一条被拒绝,进程退出码为 1 —— 不允许「部分失败但看起来成功」。
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { ORG_CONTENT_TRUST_STATUSES } from '../src/orgs/admin-org-content-trust.service'

process.env['DATABASE_URL'] ||= 'file:./prisma/dev.db'

const SCRIPT_ACTOR_ROLE = 'script:backfill-org-content-trust'

interface Args {
  ids: string[]
  reason: string
  status: string
  actor: string
  operator: string
  apply: boolean
}

function readArgs(argv: string[]): Args {
  const ids: string[] = []
  let reason = ''
  let status = 'active'
  let actor = ''
  let operator = ''
  let apply = false

  for (const raw of argv) {
    if (raw === '--apply') { apply = true; continue }
    const eq = raw.indexOf('=')
    if (!raw.startsWith('--') || eq < 0) continue
    const key = raw.slice(2, eq)
    const value = raw.slice(eq + 1)
    if (key === 'ids') ids.push(...value.split(',').map((s) => s.trim()).filter(Boolean))
    else if (key === 'reason') reason = value.trim()
    else if (key === 'status') status = value.trim()
    else if (key === 'actor') actor = value.trim()
    else if (key === 'operator') operator = value.trim()
  }
  return { ids: [...new Set(ids)], reason, status, actor, operator, apply }
}

function usage(message: string): never {
  console.error(`\n[backfill-org-content-trust] ${message}\n`)
  console.error('用法: --ids=org-a,org-b --reason="核验依据" [--status=active] [--actor=...] [--apply]')
  console.error('说明: 本脚本不提供「全部机构一键 active」的开关 —— 那等于没有闸门。')
  process.exit(2)
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2))

  if (args.ids.length === 0) usage('必须显式传 --ids=<机构id列表>,不接受空集合、不支持全量。')
  if (args.reason.length === 0) usage('必须传 --reason=<核验依据>,这条依据会写进 AuditLog。')
  if (!(ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(args.status)) {
    usage(`--status 取值非法: ${args.status};可选 ${ORG_CONTENT_TRUST_STATUSES.join(' / ')}`)
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  // AuditLog.actorId 有 FK → User。传了不存在的 id 会让「审计写入」在业务更新
  // 之后炸掉 —— 改完库却没有审计,正是最不该出现的状态。所以先核实,再执行。
  let actorId: string | null = null
  if (args.actor.length > 0) {
    const actorRow = await prisma.user.findUnique({ where: { id: args.actor }, select: { id: true } })
    if (!actorRow) {
      console.error(`\n[backfill-org-content-trust] --actor=${args.actor} 不是存在的 User.id;`)
      console.error('AuditLog.actorId 有外键约束,传错会导致「库改了但审计没落」。')
      console.error('要么传真实管理员 User.id,要么不传 --actor(审计 actorId 落 null,执行人写 --operator)。')
      process.exit(2)
    }
    actorId = actorRow.id
  }

  const mode = args.apply ? 'APPLY' : 'DRY-RUN'
  console.log(`\n=== 机构内容信任回填 [${mode}] ===`)
  console.log(`目标状态: ${args.status}`)
  console.log(`核验依据: ${args.reason}`)
  console.log(`审计 actorId: ${actorId ?? 'null(脚本执行)'}  operator: ${args.operator || '(未提供)'}`)
  console.log(`机构数量: ${args.ids.length}\n`)

  let changed = 0
  let rejected = 0

  try {
    for (const id of args.ids) {
      const before = await prisma.organization.findUnique({ where: { id } })

      if (!before) {
        console.error(`  MISSING  ${id} —— 机构不存在,跳过(不会创建)`)
        rejected++
        continue
      }
      if (args.status === 'active' && before.archivedAt != null) {
        console.error(
          `  REJECT   ${id} (${before.name}) —— 已归档 archivedAt=${before.archivedAt.toISOString()},` +
          '不得标记 active;请先取消归档再重跑',
        )
        rejected++
        continue
      }

      const fromStatus = before.contentTrustStatus ?? 'null(未标记)'
      const noop = before.contentTrustStatus === args.status ? '  [已是目标状态,仅刷新核验记录]' : ''

      if (!args.apply) {
        console.log(`  DRY-RUN  ${id} (${before.name}): ${fromStatus} -> ${args.status}${noop}`)
        changed++
        continue
      }

      const reviewedBy = actorId ?? (args.operator ? `${SCRIPT_ACTOR_ROLE}:${args.operator}` : SCRIPT_ACTOR_ROLE)
      const after = await prisma.organization.update({
        where: { id },
        data: {
          contentTrustStatus: args.status,
          contentTrustReviewedBy: reviewedBy,
          contentTrustReviewedAt: new Date(),
          contentTrustReason: args.reason,
        },
      })
      await prisma.auditLog.create({
        data: {
          actorId,
          actorRole: actorId ? 'admin' : SCRIPT_ACTOR_ROLE,
          action: 'organization.content_trust',
          targetType: 'organization',
          targetId: id,
          payloadJson: JSON.stringify({
            source: 'backfill-org-content-trust',
            operator: args.operator || null,
            fromContentTrustStatus: before.contentTrustStatus,
            toContentTrustStatus: args.status,
            reason: args.reason,
          }),
        },
      })
      console.log(`  APPLIED  ${id} (${before.name}): ${fromStatus} -> ${after.contentTrustStatus}${noop}`)
      changed++
    }
  } finally {
    await prisma.onModuleDestroy?.()
  }

  console.log(`\n结果: ${args.apply ? '已写库' : '未写库(dry-run)'} ${changed} 条,拒绝/缺失 ${rejected} 条`)
  if (!args.apply) console.log('要真正写库,请在同样的参数后加 --apply 重跑。')
  if (rejected > 0) {
    console.error('存在被拒绝或缺失的机构 —— 退出码 1,请逐条处理后重跑。')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
