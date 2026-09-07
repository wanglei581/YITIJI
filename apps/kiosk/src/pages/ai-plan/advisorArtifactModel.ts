// 小青作业面：三种真实产物的形状、8 态派生、capture 夹具。
// 夹具必须 ?capture=1 或 ?debug=1 才开，否则 fail-closed 回 no-artifact。

export const ARTIFACT_STATES = [
  'no-artifact',
  'loading',
  'error',
  'qa-pins',
  'slot-draft',
  'slot-draft-blanks',
  'compare-report',
  'compare-all-covered',
  'print-unavailable',
  'expired',
] as const

export type ArtifactViewState = (typeof ARTIFACT_STATES)[number]

export const PROTO_STATES = [
  'no-artifact',
  'qa-pins',
  'slot-draft',
  'slot-draft-blanks',
  'compare-report',
  'compare-all-covered',
  'print-unavailable',
  'expired',
] as const

export type ProtoState = (typeof PROTO_STATES)[number]

export type EvidenceLevel = 'E1' | 'E2' | 'E3'
export type CompareVerdict = 'covered' | 'missing' | 'not_a_capability'

export interface QaPin {
  content: string
  evidenceLevel: EvidenceLevel
  sourceNote: string | null
}

export interface QaPinsPayload {
  kind: 'qa_pins'
  title?: string
  pins: QaPin[]
}

export interface SlotBasedOn {
  slotKey: string
  prompt: string
  value: string
}

export interface SlotDraftPayload {
  kind: 'slot_draft'
  draft: string
  blanks: string[]
  summary: string
  basedOn: SlotBasedOn[]
}

export interface CompareItem {
  requirement: string
  verdict: CompareVerdict
  evidence: string
}

export interface CompareReportPayload {
  kind: 'compare_report'
  items: CompareItem[]
  extras: Array<{ point: string; note: string }>
  summary: string
}

export type AdvisorArtifactPayload = QaPinsPayload | SlotDraftPayload | CompareReportPayload

export interface AdvisorArtifactView {
  artifactId: string
  kind: AdvisorArtifactPayload['kind']
  status: string
  payload: AdvisorArtifactPayload | null
  provider: string
  printedFileId: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export interface AdvisorSessionView {
  sessionId: string
  expiresAt: string
  artifacts: AdvisorArtifactView[]
}

export interface AdvisorArtifactLocationState {
  sessionId?: string
  artifactId?: string
  accessToken?: string
  printUnavailableReason?: string
  artifact?: AdvisorArtifactPayload
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const VERDICT_LABEL: Record<CompareVerdict, string> = {
  covered: '写到了',
  missing: '没写到',
  not_a_capability: '不是能力项',
}

export const LEGEND: ReadonlyArray<{ level: EvidenceLevel; text: string }> = [
  { level: 'E1', text: '你自己说过的原话' },
  { level: 'E2', text: '本机已有的数据' },
  { level: 'E3', text: 'AI 的判断，仅供参考' },
]

export function isProtoState(value: string | null): value is ProtoState {
  return Boolean(value && (PROTO_STATES as readonly string[]).includes(value))
}

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return value === 'E1' || value === 'E2' || value === 'E3'
}

export function parseId(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? ''
  return ID_RE.test(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function parseQaPins(value: unknown): QaPinsPayload | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'qa_pins' || !Array.isArray(row.pins)) return null
  const pins: QaPin[] = []
  for (const item of row.pins) {
    if (!item || typeof item !== 'object') return null
    const pin = item as Record<string, unknown>
    const content = asString(pin.content)
    if (!content || !isEvidenceLevel(pin.evidenceLevel)) return null
    pins.push({
      content,
      evidenceLevel: pin.evidenceLevel,
      sourceNote: asString(pin.sourceNote),
    })
  }
  return {
    kind: 'qa_pins',
    title: asString(row.title) ?? undefined,
    pins,
  }
}

export function parseSlotDraft(value: unknown): SlotDraftPayload | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'slot_draft' || typeof row.draft !== 'string' || !Array.isArray(row.blanks) || !Array.isArray(row.basedOn)) {
    return null
  }
  const blanks = row.blanks.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  const basedOn: SlotBasedOn[] = []
  for (const item of row.basedOn) {
    if (!item || typeof item !== 'object') return null
    const slot = item as Record<string, unknown>
    const slotKey = asString(slot.slotKey)
    const prompt = asString(slot.prompt)
    const slotValue = asString(slot.value)
    if (!slotKey || !prompt || !slotValue) return null
    basedOn.push({ slotKey, prompt, value: slotValue })
  }
  return {
    kind: 'slot_draft',
    draft: row.draft,
    blanks,
    summary: typeof row.summary === 'string' ? row.summary : '',
    basedOn,
  }
}

export function parseCompareReport(value: unknown): CompareReportPayload | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.kind !== 'compare_report' || !Array.isArray(row.items) || !Array.isArray(row.extras)) return null
  const items: CompareItem[] = []
  for (const item of row.items) {
    if (!item || typeof item !== 'object') return null
    const cmp = item as Record<string, unknown>
    const requirement = asString(cmp.requirement)
    const evidence = typeof cmp.evidence === 'string' ? cmp.evidence : ''
    const verdict = cmp.verdict
    if (!requirement || (verdict !== 'covered' && verdict !== 'missing' && verdict !== 'not_a_capability')) return null
    items.push({ requirement, verdict, evidence })
  }
  const extras: CompareReportPayload['extras'] = []
  for (const item of row.extras) {
    if (!item || typeof item !== 'object') return null
    const extra = item as Record<string, unknown>
    const point = asString(extra.point)
    if (!point) return null
    extras.push({ point, note: typeof extra.note === 'string' ? extra.note : '' })
  }
  return {
    kind: 'compare_report',
    items,
    extras,
    summary: typeof row.summary === 'string' ? row.summary : '',
  }
}

export function parsePayload(value: unknown): AdvisorArtifactPayload | null {
  return parseQaPins(value) ?? parseSlotDraft(value) ?? parseCompareReport(value)
}

export function parseSessionView(value: unknown): AdvisorSessionView | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const sessionId = parseId(typeof row.sessionId === 'string' ? row.sessionId : null)
  if (!sessionId || !Array.isArray(row.artifacts)) return null
  const artifacts: AdvisorArtifactView[] = []
  for (const item of row.artifacts) {
    if (!item || typeof item !== 'object') continue
    const art = item as Record<string, unknown>
    const artifactId = parseId(typeof art.artifactId === 'string' ? art.artifactId : null)
    if (!artifactId) continue
    artifacts.push({
      artifactId,
      kind: art.kind === 'slot_draft' || art.kind === 'compare_report' ? art.kind : 'qa_pins',
      status: typeof art.status === 'string' ? art.status : 'completed',
      payload: parsePayload(art.payload),
      provider: typeof art.provider === 'string' ? art.provider : '',
      printedFileId: typeof art.printedFileId === 'string' ? art.printedFileId : null,
      createdAt: typeof art.createdAt === 'string' ? art.createdAt : '',
      updatedAt: typeof art.updatedAt === 'string' ? art.updatedAt : '',
      expiresAt: typeof art.expiresAt === 'string' ? art.expiresAt : '',
    })
  }
  return {
    sessionId,
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : '',
    artifacts,
  }
}

export function pickArtifact(session: AdvisorSessionView, artifactId: string | null): AdvisorArtifactView | null {
  if (artifactId) return session.artifacts.find((item) => item.artifactId === artifactId) ?? null
  return session.artifacts[0] ?? null
}

export function isExpiredIso(iso: string, now = Date.now()): boolean {
  if (!iso) return false
  const at = Date.parse(iso)
  return Number.isFinite(at) && at <= now
}

export function deriveContentState(payload: AdvisorArtifactPayload): ProtoState {
  if (payload.kind === 'qa_pins') return 'qa-pins'
  if (payload.kind === 'slot_draft') return payload.blanks.length > 0 ? 'slot-draft-blanks' : 'slot-draft'
  const actionable = payload.items.filter((item) => item.verdict !== 'not_a_capability')
  const allCovered = actionable.length > 0 && actionable.every((item) => item.verdict === 'covered')
  return allCovered ? 'compare-all-covered' : 'compare-report'
}

export function isContentState(state: ArtifactViewState): boolean {
  return state === 'qa-pins' || state === 'slot-draft' || state === 'slot-draft-blanks'
    || state === 'compare-report' || state === 'compare-all-covered'
}

export function resolveFixtureState(search: URLSearchParams): ProtoState | null {
  const fixture = search.get('capture') === '1' || search.get('debug') === '1'
  const want = search.get('state')
  if (!isProtoState(want)) return fixture ? 'no-artifact' : null
  if (want === 'no-artifact') return want
  return fixture ? want : null
}

export interface ArtifactCopy {
  heroBefore: string
  heroEm: string
  heroAfter: string
  sub: string
  statusLabel: string
  statusTone: 'ok' | 'warn' | 'bad' | 'unknown'
}

export function copyFor(state: ArtifactViewState): ArtifactCopy {
  switch (state) {
    case 'qa-pins':
      return {
        heroBefore: '你钉住的，我都',
        heroEm: '整理好了',
        heroAfter: '。',
        sub: '对话本身不保存，只有你钉住的条目留了下来。',
        statusLabel: '这一趟的产物已生成',
        statusTone: 'ok',
      }
    case 'slot-draft':
      return {
        heroBefore: '拼成了一段',
        heroEm: '可以直接念',
        heroAfter: '的话。',
        sub: '下面这段全部来自你自己说过的话，我只做了拼接。',
        statusLabel: '这一趟的产物已生成',
        statusTone: 'ok',
      }
    case 'slot-draft-blanks':
      return {
        heroBefore: '拼成了一段',
        heroEm: '可以直接念',
        heroAfter: '的话。',
        sub: '还有几处你没答，我留了空 —— 不替你编。',
        statusLabel: '这一趟的产物已生成',
        statusTone: 'ok',
      }
    case 'compare-report':
    case 'compare-all-covered':
      return {
        heroBefore: '逐条比过了：',
        heroEm: '有没有写到',
        heroAfter: '。',
        sub: '只比「有没有写到」，不评价「写得好不好」。',
        statusLabel: '这一趟的产物已生成',
        statusTone: 'ok',
      }
    case 'expired':
      return {
        heroBefore: '这份产物',
        heroEm: '已经过期',
        heroAfter: '了。',
        sub: '公共终端按留存期清理，过期后不再展示正文。',
        statusLabel: '没有可看的产物',
        statusTone: 'unknown',
      }
    case 'print-unavailable':
      return {
        heroBefore: '东西在，',
        heroEm: '但打印读不到',
        heroAfter: '。',
        sub: '正文仍可看，打印按钮先不放出来。',
        statusLabel: '打印能力读不到',
        statusTone: 'warn',
      }
    case 'loading':
      return {
        heroBefore: '正在把这一趟的产物',
        heroEm: '读回来',
        heroAfter: '。',
        sub: '读到之前这一页不假装已经有结果。',
        statusLabel: '正在读取产物',
        statusTone: 'unknown',
      }
    case 'error':
      return {
        heroBefore: '这一趟的产物',
        heroEm: '这次没读到',
        heroAfter: '。',
        sub: '不是没有做过，是这一次请求没有成功。',
        statusLabel: '产物读取失败',
        statusTone: 'bad',
      }
    default:
      return {
        heroBefore: '这一趟',
        heroEm: '还没有',
        heroAfter: '能带走的东西。',
        sub: '先去问小青，产出的东西会回到这一页。',
        statusLabel: '没有可看的产物',
        statusTone: 'unknown',
      }
  }
}

export const FIXTURE_QA: QaPinsPayload = {
  kind: 'qa_pins',
  title: '你钉住的条目',
  pins: [
    { content: '我做过两年社群运营，最多同时管 6 个群。', evidenceLevel: 'E1', sourceNote: '来源：你在第 2 轮说的原话' },
    { content: '你在本机的简历里写了「用户增长」相关经历，可以在面试里直接引用。', evidenceLevel: 'E2', sourceNote: '来源：本机已有的简历诊断结果' },
    { content: '被问到离职原因时，可以把重点放在「想做更靠近用户的岗位」。', evidenceLevel: 'E3', sourceNote: 'AI 的建议，仅供参考 —— 说不说、怎么说由你定' },
    { content: '我能接受青岛市内通勤，不接受长期出差。', evidenceLevel: 'E1', sourceNote: '来源：你在第 5 轮说的原话' },
  ],
}

export const FIXTURE_SLOT: SlotDraftPayload = {
  kind: 'slot_draft',
  draft: '我做过两年社群运营，最多同时管 6 个群，日常处理入群审核、活动通知和答疑。\n去年负责的一次线下招聘会宣讲，从建群到活动结束一共来了 180 多人。\n我想换到更靠近用户的岗位，因为我更喜欢直接听到用户怎么说。',
  blanks: [],
  summary: '由你自己说过的话拼接',
  basedOn: [
    { slotKey: 'current_role', prompt: '现在做什么', value: '社群运营，两年，最多同时管 6 个群' },
    { slotKey: 'best_achievement', prompt: '最拿得出手的结果', value: '线下招聘会宣讲来了 180 多人' },
    { slotKey: 'why_this_job', prompt: '为什么想做这个岗位', value: '想更靠近用户，喜欢直接听用户怎么说' },
  ],
}

export const FIXTURE_SLOT_BLANKS: SlotDraftPayload = {
  ...FIXTURE_SLOT,
  blanks: ['你最想让对方记住的一个结果', '你为什么选这家公司'],
}

export const FIXTURE_COMPARE: CompareReportPayload = {
  kind: 'compare_report',
  summary: '5 条要求里有 2 条没写到',
  extras: [{ point: '有基础的平面设计能力', note: '岗位没提，面试时可以主动说' }],
  items: [
    { requirement: '两年以上社群或用户运营经验', verdict: 'covered', evidence: '我做过两年社群运营，最多同时管 6 个群' },
    { requirement: '有线下活动组织经验', verdict: 'covered', evidence: '线下招聘会宣讲，从建群到活动结束一共来了 180 多人' },
    { requirement: '熟练使用数据分析工具（如 Excel / SQL）', verdict: 'missing', evidence: '材料里没有出现相关表述。要是你会，补一句写清「用什么工具、做到什么程度」。' },
    { requirement: '有内容撰写或短视频经验', verdict: 'missing', evidence: '材料里没有出现相关表述。' },
    { requirement: '本科及以上学历', verdict: 'not_a_capability', evidence: '这是硬性条件，不是能写进材料的能力，本机不做判定。' },
  ],
}

export const FIXTURE_COMPARE_ALL: CompareReportPayload = {
  kind: 'compare_report',
  summary: '5 条要求都写到了',
  extras: FIXTURE_COMPARE.extras,
  items: [
    FIXTURE_COMPARE.items[0]!,
    FIXTURE_COMPARE.items[1]!,
    { requirement: '熟练使用数据分析工具（如 Excel / SQL）', verdict: 'covered', evidence: '日常用 Excel 做群活跃度周报' },
    { requirement: '本科及以上学历', verdict: 'not_a_capability', evidence: '这是硬性条件，不是能写进材料的能力，本机不做判定。' },
  ],
}

export function fixturePayload(state: ProtoState): AdvisorArtifactPayload | null {
  if (state === 'qa-pins') return FIXTURE_QA
  if (state === 'slot-draft') return FIXTURE_SLOT
  if (state === 'slot-draft-blanks') return FIXTURE_SLOT_BLANKS
  if (state === 'compare-report') return FIXTURE_COMPARE
  if (state === 'compare-all-covered' || state === 'print-unavailable') return FIXTURE_COMPARE
  return null
}
