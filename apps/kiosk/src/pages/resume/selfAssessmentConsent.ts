// ============================================================
// 自我探索 · 知情同意的「这一版说明」—— 纯逻辑（无 JSX、不碰网络、不 import 运行时模块）
//
// 条款、勾选框文字、链接、版本号**全部来自同一次** GET /resume/self-assessment/questions。
// 一体机不再写死任何一条条款或版本号：写死的那份一旦和服务端差一个字，
// 用户看到的是 A、系统记下的是 B（合规 9/29 终裁：必须证明用户看到的就是当前这一版）。
//
// 版本号原样传递：不 trim、不拼接、不大小写归一。服务端逐字比对，
// 带空格的版本号就该原样送过去让服务端拒，而不是在这里「修好」再冒充当前版。
//
// 本文件只有类型级 import（编译后为空），门禁可以直接编译后运行，不必替换依赖。
// ============================================================

import type { SelfAssessmentConsentLink, SelfAssessmentDimensionKey } from '@ai-job-print/shared'
import type { SelfAssessmentSession } from './selfAssessmentSession'

/** 同一次下发里配套的一组说明。 */
export interface SelfAssessmentConsentBundle {
  version: string
  items: string[]
  checkboxLabel: string
  links: SelfAssessmentConsentLink[]
}

/** 服务端「你交的同意版本不是当前这一版」。 */
export const CONSENT_VERSION_STALE_CODE = 'SELF_ASSESSMENT_CONSENT_VERSION_STALE'

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 读下发的说明。缺任何一样（版本号、条款、勾选框文字、链接数组）都返回 null ——
 * 调用方据此**不放行**作答，也不回退到任何写死的条款。
 * 版本号只判「是不是非空字符串」，值原样保留。
 */
export function readConsentBundle(json: unknown): SelfAssessmentConsentBundle | null {
  if (!json || typeof json !== 'object') return null
  const body = json as Record<string, unknown>
  const { consentVersion, consentItems, consentCheckboxLabel, consentLinks } = body
  if (!nonEmptyString(consentVersion)) return null
  if (!Array.isArray(consentItems) || consentItems.length === 0 || !consentItems.every(nonEmptyString)) return null
  if (!nonEmptyString(consentCheckboxLabel)) return null
  if (!Array.isArray(consentLinks)) return null
  const links = consentLinks.filter((link): link is SelfAssessmentConsentLink => {
    if (!link || typeof link !== 'object') return false
    const l = link as Record<string, unknown>
    return nonEmptyString(l.label) && l.legalDocType === 'privacy_policy' && nonEmptyString(l.sectionTitle)
  })
  return {
    version: consentVersion,
    items: [...consentItems],
    checkboxLabel: consentCheckboxLabel,
    links: links.map((l) => ({ label: l.label, legalDocType: l.legalDocType, sectionTitle: l.sectionTitle })),
  }
}

/** 勾选框文字切段：链接的 label 在原句里原位变成可点的一段，其余照原文。 */
export type ConsentLabelSegment = { text: string; link?: SelfAssessmentConsentLink }

export function consentLabelSegments(label: string, links: readonly SelfAssessmentConsentLink[]): ConsentLabelSegment[] {
  const out: ConsentLabelSegment[] = []
  let rest = label
  // 按在原句里出现的先后切；找不到 label 的链接不硬塞（原句照样完整显示）。
  const ordered = links
    .map((link) => ({ link, at: label.indexOf(link.label) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
  for (const { link } of ordered) {
    const at = rest.indexOf(link.label)
    if (at < 0) continue
    if (at > 0) out.push({ text: rest.slice(0, at) })
    out.push({ text: link.label, link })
    rest = rest.slice(at + link.label.length)
  }
  if (rest) out.push({ text: rest })
  return out
}

/** 链接去处：一体机法务文档页，带上章节标题，由那一页选中标题包含它的那一章。 */
export function consentLinkRoute(link: SelfAssessmentConsentLink): string {
  return `/legal/privacy?section=${encodeURIComponent(link.sectionTitle)}`
}

/** 本机会话里有没有一份「服务端下发过的版本」下的显式同意。是否仍是当前版由同意页与服务端判。 */
export function hasRecordedConsent(s: SelfAssessmentSession): boolean {
  return s.consent.nonSensitive === true && typeof s.consentVersion === 'string' && s.consentVersion.length > 0
}

/** 同意页打开时勾选框是否沿用：只有本机记下的版本与这次下发的逐字相同才沿用，否则重勾。 */
export function initialCheckedVersion(s: SelfAssessmentSession, bundleVersion: string): boolean {
  const draft = s.consentDraft
  if (draft && draft.checkedVersion === bundleVersion) return true
  return s.consent.nonSensitive === true && s.consentVersion === bundleVersion
}

/**
 * 确认说明：记下这一版（原值）和勾选时刻。**已答的题不清空**；只去掉这次同意范围外的题
 * （`keepAnswer` 由调用方按题库裁剪给出）。
 */
export function sessionAfterConsent(
  s: SelfAssessmentSession,
  input: { sensitive: boolean; version: string; now: string; keepAnswer: (dim: SelfAssessmentDimensionKey, idx: number) => boolean },
): SelfAssessmentSession {
  const answers: SelfAssessmentSession['answers'] = {}
  for (const dim of Object.keys(s.answers) as SelfAssessmentDimensionKey[]) {
    const kept = Object.entries(s.answers[dim] ?? {}).filter(([idx]) => input.keepAnswer(dim, Number(idx)))
    if (kept.length > 0) answers[dim] = Object.fromEntries(kept)
  }
  const next: SelfAssessmentSession = {
    ...s,
    answers,
    consent: { nonSensitive: true, sensitive: input.sensitive },
    consentVersion: input.version,
    consentedAt: input.now,
  }
  delete next.consentDraft
  return next
}

/**
 * 服务端说版本不是当前版：撤掉本机记下的同意，**已答的题留着**，并记下「确认后自动重交一次」。
 */
export function sessionAfterStaleConsent(s: SelfAssessmentSession): SelfAssessmentSession {
  return {
    ...s,
    consent: { nonSensitive: false, sensitive: s.consent.sensitive },
    consentVersion: undefined,
    consentedAt: undefined,
    resubmitAfterConsent: true,
  }
}

export function isConsentVersionStale(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: unknown }).code === CONSENT_VERSION_STALE_CODE)
}
