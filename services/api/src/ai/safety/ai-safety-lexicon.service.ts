import { BadRequestException, Injectable, type OnModuleInit } from '@nestjs/common'
import { AuditService } from '../../audit/audit.service'
import type { AuthedUser } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
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
    try {
      const rows = await this.prisma.aiSafetyTerm.findMany({
        select: { category: true, term: true, kind: true, enabled: true },
      })
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
