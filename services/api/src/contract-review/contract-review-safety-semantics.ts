const LEGAL_SUBJECTS = ['合同', '协议', '约定', '条款', '本条', '规定', '细则', '安排', '本项'] as const
const LEGAL_OUTCOMES = [
  '无效', '违法', '违反法律', '不合法', '不合规', '不具法律效力', '不具有法律效力', '无法律效力', '违规',
] as const
const CERTAINTY_TERMS = ['一定', '必然', '必定', '肯定', '保证', '确保', '必须'] as const
const CLAIM_OUTCOMES = ['胜诉', '获赔', '赔偿'] as const
const ENTERPRISE_ORGS = ['企业', 'hr', '人事', '招聘方', '用人单位'] as const
const RECRUITING_ORGS = ['平台', ...ENTERPRISE_ORGS] as const
const RESUME_COLLECTION_ACTIONS = ['接收', '收取', '收集', '代收', '归集', '汇集', '留存', '保存', '获取', '获得'] as const
const RESUME_TRANSFER_ACTIONS = ['转交', '提供'] as const
const SCREENING_ACTIONS = ['筛选', '遴选', '甄选', '挑选', '审核', '初筛'] as const
const RESUME_INSPECTION_ACTIONS = ['查看', '查阅', '浏览'] as const
const UNSAFE_RESUME_REJECTION_PHRASES = ['不拒收', '未拒收', '不会拒收', '不能拒收', '不得拒收', '禁止拒收', '严禁拒收', '无权拒收'] as const
const RECOMMEND_ACTIONS = ['推荐', '推送', '介绍', '匹配'] as const
const INTERVIEW_ACTIONS = ['邀请', '邀约', '约见', '约谈', '约候选人', '约求职者'] as const
const DELIVERY_ACTIONS = ['发送', '发放', '发出'] as const
const INTERVIEW_FLOW_ACTIONS = [...DELIVERY_ACTIONS, '发起', '通知', '安排', '提供'] as const
const OFFER_ACTIONS = [...DELIVERY_ACTIONS, '创建', '维护', '修改', '撤回', '管理'] as const
const OFFER_OBJECTS = ['offer', '录用通知', '录取通知'] as const
const EN_INJECTION_ACTIONS = ['ignore', 'disregard', 'override', 'bypass', 'forget', 'discard', 'drop'] as const
const EN_INJECTION_CONTEXT = ['previous', 'prior', 'above', 'system', 'developer', 'all', 'every', 'the'] as const
const EN_INJECTION_OBJECT = ['instruction', 'instructions', 'prompt', 'prompts', 'rule', 'rules'] as const
const CN_INJECTION_ACTIONS = ['忽略', '无视', '覆盖', '绕过', '清空', '删除', '废弃', '放弃'] as const
const CN_INJECTION_CONTEXT = ['此前', '先前', '之前', '以上', '前述', '系统', '开发者', '全部', '所有'] as const
const CN_INJECTION_OBJECT = ['指令', '提示', '规则'] as const
const DIRECT_INJECTION_MARKERS = ['<|im_start|>', '<|im_end|>', '[inst]', '[inst_end]', '<<sys>>', '<sys>', '</sys>'] as const

interface TextSpan { readonly start: number; readonly end: number }

export function assertNoForbiddenContractSemantics(
  fragments: readonly string[],
  complianceForbiddenTerms: readonly string[],
  fragmentGroups: readonly (readonly string[])[] = [fragments],
): void {
  const normalizedFragments = fragments.map((fragment) => fragment.normalize('NFKC').toLowerCase())
  const semanticFragments = normalizedFragments.map(compactSemanticText)
  for (let index = 0; index < semanticFragments.length; index += 1) {
    if (DIRECT_INJECTION_MARKERS.some((marker) => normalizedFragments[index]?.includes(marker))) reject()
    assertSemanticText(semanticFragments[index] ?? '', complianceForbiddenTerms)
  }
  if (DIRECT_INJECTION_MARKERS.some((marker) => normalizedFragments.join('').includes(marker))) reject()
  assertSemanticText(semanticFragments.join(''), complianceForbiddenTerms)
  const semanticGroups = fragmentGroups.map((group) =>
    group.map((fragment) => compactSemanticText(fragment.normalize('NFKC').toLowerCase())))
  assertNoDistributedForbiddenSemantics(semanticFragments, semanticGroups)
}

function compactSemanticText(text: string): string {
  return text.replace(/[ \t\f\v]+/gu, '').replace(/[^\p{L}\p{N}]+/gu, '|')
    .replace(/^\|+|\|+$/gu, '').replace(/\|{2,}/gu, '|')
}

function assertSemanticText(text: string, forbiddenTerms: readonly string[]): void {
  const flat = text.replaceAll('|', '')
  if (forbiddenTerms.some((term) => flat.includes(term.normalize('NFKC').toLowerCase()))) reject()
  if (hasLegalConclusion(text) || hasRecruitingCapability(text) || hasPromptInjection(text)) reject()
}

function hasLegalConclusion(text: string): boolean {
  if (termsNear(text, CERTAINTY_TERMS, CLAIM_OUTCOMES) ||
    termsClustered(text, ['法院'], CERTAINTY_TERMS, ['支持']) ||
    termsNear(text, ['法院', '法官'], ['支持', '采纳'])) return true
  const legalOutcomeCount = spansOf(text, LEGAL_OUTCOMES)
    .filter((outcome) => spanHasNearTerm(text, outcome, LEGAL_SUBJECTS, 24)).length
  if (legalOutcomeCount === 0) return false
  if (legalOutcomeCount > 1 || hasStrongLegalOverride(text)) return true
  return !hasNarrowLegalCaution(text)
}

function hasStrongLegalOverride(text: string): boolean {
  return /(?:合同|协议|约定|条款|本条|规定|细则|安排|本项).{0,12}(?:依法|当然|应当|必然|必定|肯定|确定|系|属于|认定).{0,12}(?:无效|违法|违反法律|不合法|不合规|不具法律效力|不具有法律效力|无法律效力|违规)/u.test(text) ||
    /而是.{0,12}(?:依法|当然|应当|必然|必定|肯定|确定|系|属于|认定).{0,12}(?:无效|违法|违反法律|不合法|不合规|不具法律效力|不具有法律效力|无法律效力|违规)/u.test(text)
}

function hasNarrowLegalCaution(text: string): boolean {
  const subject = '(?:合同|协议|约定|条款|本条|规定|细则|安排|本项)'
  const outcome = '(?:无效|违法|违反法律|不合法|不合规|不具法律效力|不具有法律效力|无法律效力|违规)'
  const pair = `${subject}.{0,12}${outcome}`
  return new RegExp(`(?:尚不能|不能|无法)(?:直接)?(?:判断|确定|认定).{0,12}${pair}`, 'u').test(text) ||
    new RegExp(`(?:请勿|不要|不应|不可|不得)(?:直接)?(?:断言|认定).{0,12}${pair}`, 'u').test(text) ||
    new RegExp(`${pair}.{0,4}(?:并非|不是|不代表)(?:本报告|本次报告|本分析)?结论`, 'u').test(text) ||
    new RegExp(`(?:这)?不代表.{0,12}${pair}`, 'u').test(text) ||
    new RegExp(`${subject}.{0,12}不一定.{0,12}${outcome}`, 'u').test(text) ||
    new RegExp(`${subject}.{0,12}是否.{0,12}${outcome}.{0,12}尚不确定`, 'u').test(text) ||
    new RegExp(`${subject}.{0,12}(?:可能|或许|疑似).{0,12}${outcome}`, 'u').test(text) ||
    new RegExp(`是否构成.{0,12}${pair}.{0,12}应由.{0,24}判断`, 'u').test(text) ||
    new RegExp(`${pair}.{0,12}应由.{0,24}判断`, 'u').test(text) ||
    new RegExp(`${subject}.{0,12}(?:存在)?${outcome}风险`, 'u').test(text) ||
    new RegExp(`建议核实.{0,12}${pair}`, 'u').test(text)
}

function hasRecruitingCapability(text: string): boolean {
  const flat = text.replaceAll('|', '')
  if (flat === '面试邀约' || flat === '面试邀请' || flat === 'offer管理' || text.includes('候选人管理')) return true
  if (hasUnsafeResumeRejection(text)) return true
  if (hasUnsafePhrase(text, ['面试邀约', '面试邀请'], RECRUITING_ORGS)) return true
  if (hasUnsafeAction(text, RESUME_COLLECTION_ACTIONS, ['简历'], RECRUITING_ORGS)) return true
  if (hasUnsafeAction(text, RESUME_TRANSFER_ACTIONS, ['简历'], ENTERPRISE_ORGS)) return true
  if (hasUnsafeAction(text, SCREENING_ACTIONS, ['候选人', '简历', '求职者'], RECRUITING_ORGS)) return true
  if (hasUnsafeAction(text, RESUME_INSPECTION_ACTIONS, ['简历'], ENTERPRISE_ORGS)) return true
  if (hasUnsafeAction(text, INTERVIEW_ACTIONS, ['候选人'], RECRUITING_ORGS)) return true
  if (hasUnsafeAction(text, INTERVIEW_FLOW_ACTIONS, ['面试'], RECRUITING_ORGS)) return true
  if (hasUnsafeAction(text, OFFER_ACTIONS, OFFER_OBJECTS, RECRUITING_ORGS)) return true
  return hasUnsafeAction(text, RECOMMEND_ACTIONS, ['候选人', '简历', '求职者'], ENTERPRISE_ORGS)
}

function hasUnsafeResumeRejection(text: string): boolean {
  return spansOf(text, ['拒收']).some((action) => spanHasNearTerm(text, action, ['简历'], 24) &&
    spanHasNearTerm(text, action, RECRUITING_ORGS, 24) &&
    /(?:不|未|不会|不能|不得|禁止|严禁|无权)$/u.test(text.slice(Math.max(0, action.start - 8), action.start)))
}

function hasUnsafePhrase(text: string, phrases: readonly string[], actors: readonly string[]): boolean {
  return spansOf(text, phrases).some((phrase) =>
    spanHasNearTerm(text, phrase, actors, 24) && !isDirectlyNegated(text, phrase.start) &&
    !spansNear(text, phrase, INTERVIEW_FLOW_ACTIONS, 12).some((action) => isDirectlyNegated(text, action.start)))
}

function hasUnsafeAction(
  text: string,
  actions: readonly string[],
  objects: readonly string[],
  actors: readonly string[],
): boolean {
  if (!termsClustered(text, actions, objects, actors)) return false
  return spansOf(text, actions).some((action) => hasNearRecruitingObject(text, action, objects) &&
    spanHasNearTerm(text, action, actors, 24) && !isDirectlyNegated(text, action.start))
}

function hasNearRecruitingObject(text: string, action: TextSpan, objects: readonly string[]): boolean {
  return spansNear(text, action, objects, 24).some((object) =>
    text.slice(object.start, object.end) !== '简历' || !/^(?:模板|范本|示例|样本)/u.test(text.slice(object.end)))
}

function isDirectlyNegated(text: string, actionStart: number): boolean {
  let prefix = text.slice(Math.max(0, actionStart - 24), actionStart)
  const contrastStart = Math.max(prefix.lastIndexOf('|'), ...['但是', '然而', '不过', '可是', '而是', '但', '却']
    .map((term) => prefix.lastIndexOf(term)))
  if (contrastStart >= 0) prefix = prefix.slice(contrastStart + (prefix.startsWith('而是', contrastStart) ? 2 : 1))
  if (/(?:不能不|不得不|不是不|并非不|并不是不|不会拒绝|不能拒绝|不得拒绝|无权拒绝|禁止拒绝|不排除|不仅|不拒绝)[\p{L}\p{N}]{0,4}$/u.test(prefix)) return false
  const directBridge = '(?:(?:直接|主动|统一)|(?:通过|在)(?:本)?平台|(?:向|给|为)(?:平台|企业|hr|人事|招聘方|用人单位)){0,2}'
  if (new RegExp(`(?:不会|不能|不再|不予|不得|禁止|严禁|无权|不|未)${directBridge}$`, 'u').test(prefix)) return true
  const shared = prefix.match(/(?:不会|不能|不再|不予|不得|禁止|严禁|无权|不|未)([\p{L}\p{N}]{1,8})(?:并|和|及|或)$/u)?.[1]
  if (shared && recruitingActions().includes(shared)) return true
  const wrapperBridge = prefix.match(/(?:不提供|不支持|不具备)([\p{L}\p{N}|]{0,24})$/u)?.[1]
  if (wrapperBridge === undefined) return false
  const allowedBridgeTerms = [
    ...recruitingActions(), ...OFFER_OBJECTS, '面试', '简历', '候选人', '求职者', '服务', '功能', '或', '和', '及', '与', '的', '|',
  ] as const
  return allowedBridgeTerms.reduce((remaining, term) => remaining.replaceAll(term, ''), wrapperBridge).length === 0
}

function recruitingActions(): readonly string[] {
  return [
    ...RESUME_COLLECTION_ACTIONS, ...RESUME_TRANSFER_ACTIONS, ...SCREENING_ACTIONS,
    ...RESUME_INSPECTION_ACTIONS, ...RECOMMEND_ACTIONS, ...INTERVIEW_ACTIONS,
    ...INTERVIEW_FLOW_ACTIONS, ...OFFER_ACTIONS,
  ]
}

function hasPromptInjection(text: string): boolean {
  return termsClustered(text, EN_INJECTION_ACTIONS, EN_INJECTION_CONTEXT, EN_INJECTION_OBJECT) ||
    termsClustered(text, CN_INJECTION_ACTIONS, CN_INJECTION_CONTEXT, CN_INJECTION_OBJECT) ||
    termsClustered(text, ['输出', '泄露'], ['系统', '开发者'], ['提示']) ||
    termsClustered(text, ['执行', '遵循'], ['系统', '开发者'], ['指令', '规则']) ||
    termsNear(text, ['system', 'developer'], ['prompt'])
}

function assertNoDistributedForbiddenSemantics(
  fragments: readonly string[], groups: readonly (readonly string[])[],
): void {
  const clusters = [
    [['一键'], ['投递']], [['立即'], ['投递']], [['平台'], ['投递']], [['企业'], ['收'], ['简历']],
    [['候选人'], ['管理']], [['一键'], ['报名']], [LEGAL_SUBJECTS, LEGAL_OUTCOMES],
    [CERTAINTY_TERMS, CLAIM_OUTCOMES], [['法院', '法官'], ['支持', '采纳']],
    [EN_INJECTION_ACTIONS, EN_INJECTION_CONTEXT, EN_INJECTION_OBJECT],
    [CN_INJECTION_ACTIONS, CN_INJECTION_CONTEXT, CN_INJECTION_OBJECT],
    [RESUME_COLLECTION_ACTIONS, ['简历'], RECRUITING_ORGS], [RESUME_TRANSFER_ACTIONS, ['简历'], ENTERPRISE_ORGS],
    [SCREENING_ACTIONS, ['候选人', '简历', '求职者'], RECRUITING_ORGS],
    [RECOMMEND_ACTIONS, ['候选人', '简历', '求职者'], ENTERPRISE_ORGS],
    [INTERVIEW_ACTIONS, ['候选人'], RECRUITING_ORGS], [INTERVIEW_FLOW_ACTIONS, ['面试'], RECRUITING_ORGS],
    [OFFER_ACTIONS, OFFER_OBJECTS, RECRUITING_ORGS],
  ] as const
  for (const groups of clusters) {
    const across = groups.every((terms) => fragments.some((text) => terms.some((term) => text.includes(term))))
    const local = fragments.some((text) => groups.every((terms) => terms.some((term) => text.includes(term))))
    if (across && !local) reject()
  }
  if (hasDistributedUnsafeInspection(groups) || hasDistributedUnsafeResumeRejection(groups)) reject()
}

function hasDistributedUnsafeInspection(groups: readonly (readonly string[])[]): boolean {
  const fragments = groups.flat()
  if (!fragments.some((text) => ENTERPRISE_ORGS.some((actor) => text.includes(actor))) ||
      !fragments.some(containsStandaloneResume)) return false
  return groups.some((group) => {
    const bound = group.some(containsStandaloneResume) ||
      group.some((text) => ENTERPRISE_ORGS.some((actor) => text.includes(actor)))
    return bound && group.some((text) => spansOf(text, RESUME_INSPECTION_ACTIONS).some((action) => {
      const prefix = text.slice(Math.max(0, action.start - 12), action.start)
      if (/(?:请|建议|核实|确认)[\p{L}\p{N}|]{0,8}$/u.test(prefix) ||
          /(?:候选人|求职者|用户)[\p{L}\p{N}|]{0,6}(?:可|可以|能够)[\p{L}\p{N}|]{0,4}$/u.test(prefix)) return false
      const suffix = text.slice(action.end).replaceAll('|', '')
      return containsStandaloneResume(text) || suffix.length === 0 || /^(?:候选人|求职者)(?:信息|资料)?$/u.test(suffix)
    }))
  })
}

function hasDistributedUnsafeResumeRejection(groups: readonly (readonly string[])[]): boolean {
  const fragments = groups.flat()
  return fragments.some(containsStandaloneResume) &&
    fragments.some((text) => RECRUITING_ORGS.some((actor) => text.includes(actor))) &&
    groups.some((group) => {
      const bound = group.some(containsStandaloneResume) ||
        group.some((text) => RECRUITING_ORGS.some((actor) => text.includes(actor)))
      return bound && group.some((text) =>
        UNSAFE_RESUME_REJECTION_PHRASES.some((phrase) => text.endsWith(phrase)))
    })
}

function containsStandaloneResume(text: string): boolean {
  return spansOf(text, ['简历']).some((resume) =>
    !/^(?:模板|范本|示例|样本)/u.test(text.slice(resume.end)))
}

function termsNear(text: string, leftTerms: readonly string[], rightTerms: readonly string[]): boolean {
  return spansOf(text, leftTerms).some((left) => spanHasNearTerm(text, left, rightTerms, 24))
}

function termsClustered(text: string, anchors: readonly string[], second: readonly string[], third: readonly string[]): boolean {
  return spansOf(text, anchors).some((anchor) => {
    const secondSpans = spansNear(text, anchor, second, 24)
    const thirdSpans = spansNear(text, anchor, third, 24)
    return secondSpans.some((middle) => thirdSpans.some((last) => spanGap(middle, last) <= 24))
  })
}

function spanHasNearTerm(text: string, anchor: TextSpan, terms: readonly string[], maxGap: number): boolean {
  return spansNear(text, anchor, terms, maxGap).length > 0
}

function spansNear(text: string, anchor: TextSpan, terms: readonly string[], maxGap: number): TextSpan[] {
  const start = Math.max(0, anchor.start - maxGap)
  return spansOf(text.slice(start, Math.min(text.length, anchor.end + maxGap)), terms)
    .map((span) => ({ start: span.start + start, end: span.end + start }))
    .filter((span) => spanGap(anchor, span) <= maxGap)
}

function spansOf(text: string, terms: readonly string[]): TextSpan[] {
  const spans: TextSpan[] = []
  for (const term of terms) {
    let start = text.indexOf(term)
    while (start >= 0) {
      spans.push({ start, end: start + term.length })
      start = text.indexOf(term, start + term.length)
    }
  }
  return spans
}

function spanGap(left: TextSpan, right: TextSpan): number {
  if (left.end < right.start) return right.start - left.end
  if (right.end < left.start) return left.start - right.end
  return 0
}

function reject(): never {
  throw new Error('CONTRACT_SEMANTIC_REJECTED')
}
