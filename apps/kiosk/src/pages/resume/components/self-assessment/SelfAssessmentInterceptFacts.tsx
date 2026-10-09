// 自我探索拦截态：三条事实、当前状态三格、链接参数说明。
//
// 同意来源门禁只在 SelfAssessmentFlow.tsx 里找六句标题
// （apps/kiosk/scripts/verify-self-assessment-consent-source.mjs 的拦截态 needles）。
// 那些标题由调用方传入。这里是没被钉住的说明正文。
// 临床词扫描只点名 SelfAssessmentFlow.tsx（services/api/scripts/verify-compliance.ts，
// 本批不改 services）。本文件落在 apps/kiosk/src，仓库根 verify-compliance-copy
// 与 verify-datetime-honesty 会整目录扫到。

import type { ReactNode } from 'react'
import {
  SaCard,
  SaChips,
  SaFlow,
  SaFrame,
  SaMeta,
  SaNotice,
  SaPicks,
  type SaStatus,
} from './SelfAssessmentQxKit'

export type InterceptKind = 'empty-bank' | 'stale' | 'no-consent' | 'submitted'

export type SaExitItem = {
  key: string
  icon: string
  title: string
  desc: string
  lead?: boolean
  route: string
  onClick: () => void
}

type SaFrameBase = {
  title: string
  eyebrow: string
  rail: readonly string[]
  steps?: readonly { readonly n: string; readonly text: string }[]
}

type SaFact = { key: string; step: string; desc: string; current?: boolean }

function GhostButton({ label, route, onClick }: { label: string; route?: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="ghost" data-route={route} onClick={onClick}>{label}</button>
  )
}

function PrimaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn" data-variant="primary" data-testid="self-assessment-primary" onClick={onClick}>{label}</button>
  )
}

function nowItems(consented: boolean, done: number, total: number, submitted: boolean) {
  return [
    { key: 'consent', label: '是否已确认说明', value: consented ? '已确认，可以作答。' : '尚未确认，不能开始作答。' },
    { key: 'done', label: '已作答题数', value: `${done} / ${total} 题${total > 0 && done >= total ? '，已答满。' : '，未答满不进入确认。'}` },
    { key: 'submit', label: '是否已提交', value: submitted ? '已提交，可查看结果。' : '未提交，不生成任何结果。' },
  ]
}

/** 条数不写死：说明页渲染的是这次下发的条款，这里只说「每一条」。 */
function consentFacts(kind: Exclude<InterceptKind, 'submitted'>, done: number): SaFact[] {
  if (kind === 'empty-bank') {
    return [
      { key: 'f1', step: '事实 1', desc: '当前题目集是空的，没有可以作答的题。', current: true },
      { key: 'f2', step: '事实 2', desc: '说明已经确认，但没有题目就不能进入作答。' },
      { key: 'f3', step: '事实 3', desc: '不会补一套题目，也不会跳过这一步。' },
    ]
  }
  if (kind === 'stale') {
    return [
      { key: 'f1', step: '事实 1', desc: '说明已经更新，这次作答里的确认不再算数。', current: true },
      { key: 'f2', step: '事实 2', desc: `你已答的 ${done} 题都还在，确认后会自动重新提交，不用重答。` },
      { key: 'f3', step: '事实 3', desc: '不会因为你直接打开答题链接就当作已按新说明同意。' },
    ]
  }
  return [
    { key: 'f1', step: '事实 1', desc: '这次作答里没有「已确认说明」的记录。', current: true },
    { key: 'f2', step: '事实 2', desc: '说明里的每一条前提，都要读完并勾选后才开始作答。' },
    { key: 'f3', step: '事实 3', desc: '不会因为你直接打开答题链接就当作已同意。' },
  ]
}

function submittedFacts(total: number): SaFact[] {
  return [
    { key: 'f1', step: '事实 1', desc: `本次 ${total} 题已提交，答题页不再打开以免答案与提交不一致。`, current: true },
    { key: 'f2', step: '事实 2', desc: '可以回完成页查看这次的结果。' },
    { key: 'f3', step: '事实 3', desc: '想换答案就重新开始一次新的作答。' },
  ]
}

function consentBody(kind: Exclude<InterceptKind, 'submitted'>, done: number): string {
  if (kind === 'empty-bank') return '当前题目集为空，请回到说明页重新开始。'
  if (kind === 'stale') {
    return `说明已经更新，提交前要请你按新的说明重新确认一次。你已答的 ${done} 题都还在，确认后会自动重新提交，不用重答。`
  }
  return '这台机器上还没有记录到你对当前说明的同意，或说明已更新。作答会被送去生成 AI 解读，所以必须先看过说明再开始。'
}

export function SelfAssessmentWhyCard({ head, facts }: { head: string; facts: readonly SaFact[] }) {
  return (
    <SaCard head={head} hint="三条都可核对">
      <SaFlow items={facts} />
    </SaCard>
  )
}

export function SelfAssessmentNowCard({
  head,
  consented,
  done,
  total,
  submitted,
}: {
  head: string
  consented: boolean
  done: number
  total: number
  submitted: boolean
}) {
  return (
    <SaCard head={head} hint="页面按这次作答如实显示">
      <SaMeta cols={3} items={nowItems(consented, done, total, submitted)} />
    </SaCard>
  )
}

export function SelfAssessmentRecordPreview() {
  return (
    <SaCard head="有记录时这里显示什么" hint="会列出哪些内容，不是已有数据">
      <SaMeta
        cols={3}
        items={[
          { key: 'done', label: '完成情况', value: '是否五个方向都已算出。' },
          { key: 'keep', label: '保留期限', value: '结果保留 24 小时，到期自动清理。' },
          { key: 'next', label: '还能做什么', value: '回看结果、打印或撤回。' },
        ]}
      />
    </SaCard>
  )
}

export function SelfAssessmentParamNotice({ lead }: { lead: string }) {
  return (
    <SaNotice>
      <b>{lead}</b>这里只说明是哪一类前置条件没满足，不回显参数原值。
    </SaNotice>
  )
}

export function SelfAssessmentQuizIntercept({
  frame,
  state,
  kind,
  consented,
  done,
  total,
  hasResult,
  whyHead,
  nowHead,
  paramLead,
  blockedHead,
  exits,
  resumeRoute,
  onResumeService,
  onIntro,
  onResult,
  onRestart,
}: {
  frame: SaFrameBase
  state: 'recover-consent' | 'recover-submitted'
  kind: InterceptKind
  consented: boolean
  done: number
  total: number
  hasResult: boolean
  whyHead: string
  nowHead: string
  paramLead: string
  blockedHead: string
  exits: readonly SaExitItem[]
  resumeRoute: string
  onResumeService: () => void
  onIntro: () => void
  onResult: () => void
  onRestart: () => void
}) {
  const submitted = kind === 'submitted'
  const facts = submitted ? submittedFacts(total) : consentFacts(kind, done)
  const status: SaStatus = { tone: 'warn', label: submitted ? '本次已提交' : '前置条件未满足' }
  const ask = <>这一步<em>还打不开</em>。</>
  const doing: ReactNode = submitted
    ? <>已提交的答案不再改动。<b>页面不会跳过这一步，也不会补一个假结果给你看。</b></>
    : <>这一步需要先在说明页确认。<b>页面不会跳过这一步，也不会补一个假结果给你看。</b></>
  const chips = submitted
    ? [
        { key: 'blocked', text: <>答题入口<b>不放行</b></>, tone: 'warn' as const },
        { key: 'kept', text: '本次结果仍可查看' },
        { key: 'redo', text: '重新开始会清空这一次' },
      ]
    : [
        { key: 'blocked', text: <>当前入口<b>不放行</b></>, tone: 'warn' as const },
        { key: 'keep', text: '已有作答不会被清空' },
        { key: 'none', text: '不生成任何结果' },
      ]
  const body = submitted
    ? '重新开始一次会清掉这台机器上的本次作答与结果；已提交的那一次若要物理删除，请在结果页用「撤回本次探索」。'
    : consentBody(kind, done)
  const secondary = submitted
    ? { label: '重新开始一次', route: undefined, onClick: onRestart }
    : { label: '返回简历服务', route: resumeRoute, onClick: onResumeService }
  const primary = submitted
    ? { label: '查看本次结果', onClick: onResult }
    : { label: '去看说明并确认', onClick: onIntro }

  return (
    <SaFrame
      {...frame}
      screen="resume-self-assessment-quiz"
      state={state}
      status={status}
      ask={ask}
      doing={doing}
      back={{ label: '返回简历服务', onBack: onResumeService }}
      ctabar={
        <>
          <GhostButton label={secondary.label} route={secondary.route} onClick={secondary.onClick} />
          <PrimaryButton label={primary.label} onClick={primary.onClick} />
        </>
      }
    >
      <SaCard head={blockedHead} hint={submitted ? '已提交的答案不再改动' : '这一步本来就有前置条件'} tone="down" testId="self-assessment-recover">
        <SaChips items={chips} />
        <p className="sa-sub">{body}</p>
      </SaCard>
      <SelfAssessmentWhyCard head={whyHead} facts={facts} />
      <SelfAssessmentNowCard head={nowHead} consented={consented} done={done} total={total} submitted={hasResult} />
      <SaCard head="现在可以做什么" hint="都是现在就能打开的入口">
        <SaPicks items={exits} />
      </SaCard>
      <SelfAssessmentParamNotice lead={paramLead} />
    </SaFrame>
  )
}
