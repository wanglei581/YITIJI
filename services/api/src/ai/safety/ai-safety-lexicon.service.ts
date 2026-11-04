import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service'
import { withBootTimeout } from '../../common/boot/boot-readiness'
import type { AuthedUser } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { registerSafetyBlockSink } from './block-log'
import { applyLexiconRows, lexiconView, resetLexiconToSeed, type LexiconRow } from './matcher'
import { normalizeForSafety } from './normalize'
import { isSafetyCategory } from './refusal'

const MAX_BATCH = 40

interface UpdateBody {
  category?: unknown
  addBlock?: unknown
  removeBlock?: unknown
  addAllow?: unknown
  removeAllow?: unknown
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ error: { code: 'AI_SAFETY_LEXICON_INVALID', message } })
}

function readList(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw invalid('词条无效')
  return value
}

function dedupe(terms: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const term of terms) {
    const trimmed = term.trim()
    const key = normalizeForSafety(trimmed)
    if (!trimmed || key.length < 2) throw invalid('词条无效')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

@Injectable()
export class AiSafetyLexiconService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 拦截记录落审计表（AuditLog，动作 ai_safety.content_blocked）。只记五个字段：
    // 时间（行的 createdAt）、终端编号、入口、类别代码、位置。不存用户原文，也不存命中词。
    registerSafetyBlockSink((record) => this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'ai_safety.content_blocked',
      targetType: 'ai_feature',
      targetId: record.feature,
      payload: {
        terminalCode: record.terminalCode,
        feature: record.feature,
        category: record.category,
        position: record.position,
      },
    }))
    // 启动期读库必须有界：库慢或不可达时先用种子词库启动，库迟到返回再补上后台增删的词。
    try {
      const rows = await withBootTimeout(
        () => this.prisma.aiSafetyTerm.findMany({ select: { category: true, term: true, kind: true, enabled: true } }),
        {
          subsystem: 'ai_safety_lexicon',
          operation: 'loadLexicon',
          timeoutMs: 5000,
          onSettleAfterTimeout: (result) => {
            if (result.ok) applyLexiconRows(result.value)
          },
        },
      )
      applyLexiconRows(rows)
    } catch {
      resetLexiconToSeed()
    }
  }

  view() {
    return lexiconView()
  }

  async update(body: UpdateBody, actor: AuthedUser) {
    if (!body || typeof body !== 'object' || typeof body.category !== 'string' || !isSafetyCategory(body.category)) {
      throw invalid('类别无效')
    }
    const category = body.category
    const addBlock = dedupe(readList(body.addBlock))
    const removeBlock = dedupe(readList(body.removeBlock))
    const addAllow = dedupe(readList(body.addAllow))
    const removeAllow = dedupe(readList(body.removeAllow))
    const added = addBlock.length + addAllow.length
    const removed = removeBlock.length + removeAllow.length
    if (added + removed === 0) throw invalid('没有要改的词')
    if (added + removed > MAX_BATCH) throw invalid('一次改动太多')
    if (overlaps(addBlock, removeBlock) || overlaps(addAllow, removeAllow)) throw invalid('同一词不能同时增加和删除')

    const updatedBy = actor.userId
    for (const term of addBlock) await this.upsert(category, 'block', term, true, updatedBy)
    for (const term of removeBlock) await this.upsert(category, 'block', term, false, updatedBy)
    for (const term of addAllow) await this.upsert(category, 'allow', term, true, updatedBy)
    for (const term of removeAllow) await this.upsert(category, 'allow', term, false, updatedBy)

    const rows = await this.prisma.aiSafetyTerm.findMany({
      select: { category: true, term: true, kind: true, enabled: true },
    })
    applyLexiconRows(rows)
    await this.audit.write({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'ai_safety.lexicon.update',
      targetType: 'ai_safety_lexicon',
      targetId: category,
      payload: { category, added, removed },
    })
    return this.view()
  }

  private upsert(category: string, kind: 'block' | 'allow', term: string, enabled: boolean, updatedBy: string) {
    return this.prisma.aiSafetyTerm.upsert({
      where: { category_kind_term: { category, kind, term } },
      create: { category, kind, term, enabled, updatedBy },
      update: { enabled, updatedBy },
    })
  }
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const keys = new Set(left.map((term) => normalizeForSafety(term)))
  return right.some((term) => keys.has(normalizeForSafety(term)))
}

export type { LexiconRow }
