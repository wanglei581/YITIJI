import type { ReactNode } from 'react'
import type { RailMark } from './components/ResumeTriageHero'
import type { ResumeParseTerminalCopy, ResumeParseTerminalKind } from '../../services/resumeParseIntent'

export type ParseView = 'missing-file' | 'consent-checking' | 'consent-needed' | 'waiting' | 'failed' | 'unknown'

export type ShownTerminal =
  | { mode: 'charged'; copy: ResumeParseTerminalCopy; source: ResumeParseTerminalKind }
  | { mode: 'file_changed'; copy: ResumeParseTerminalCopy }
  | { mode: 'blocked'; note: string }

type FrameCopy = {
  ask: ReactNode
  doing: string
  flag: string
  warn: boolean
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  rail: RailMark[]
}

const VIEW: Record<ParseView, FrameCopy> = {
  'missing-file': {
    ask: <>没找到<em>要用的简历文件</em>。</>,
    doing: '这一步需要一份已经拿到的简历，现在没有，所以不往下走。',
    flag: '已阻断', warn: true,
    status: { tone: 'warn', label: '这一步没有文件' },
    rail: ['current', 'todo', 'todo', 'todo'],
  },
  'consent-checking': {
    ask: <>先确认<em>授权状态</em>。</>,
    doing: '确认完成之前，文件不会交给 AI 服务。',
    flag: '确认中', warn: false,
    status: { tone: 'unknown', label: '确认授权中' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  'consent-needed': {
    ask: <>用简历 AI 前，<em>需要你先授权</em>。</>,
    doing: '不授权就不解析；取消会回到来源选择，文件不会交给 AI。',
    flag: '待授权', warn: true,
    status: { tone: 'warn', label: '等待授权' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  waiting: {
    ask: <>文件收到了，正在等<em>最终解析结果</em>。</>,
    doing: '解析是一次出结果的处理，中间没有阶段可以播报。',
    flag: '解析中', warn: false,
    status: { tone: 'unknown', label: '正在解析 · 一次性出结果' },
    rail: ['done', 'current', 'todo', 'todo'],
  },
  failed: {
    ask: <>这次<em>没能读出内容</em>。</>,
    doing: '文件已经传到服务端了，正在转到失败说明页，可以直接重新解析，不用再传一遍。',
    flag: '解析失败', warn: true,
    status: { tone: 'bad', label: '解析失败 · 可重试' },
    rail: ['done', 'bad', 'todo', 'todo'],
  },
  unknown: {
    ask: <>这一次解析<em>暂时无法确认有没有完成</em>。</>,
    doing: '可能已经完成，也可能没有；本页不会自动再提交，也不会把它当成失败。',
    flag: '结果未知', warn: true,
    status: { tone: 'warn', label: '解析结果未知' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
}

export function frameCopy(view: ParseView, terminal: ShownTerminal | null): FrameCopy {
  const base = VIEW[view]
  if (!terminal || view !== 'unknown') return base
  if (terminal.mode === 'file_changed') {
    return {
      ...base,
      ask: <>这份文件<em>已停止使用</em>。</>,
      doing: '内容在调用模型之前就被拒绝了。这次没有调用模型。',
      flag: '请重新上传',
      status: { tone: 'warn', label: '文件内容已变化' },
    }
  }
  if (terminal.mode === 'blocked') {
    return {
      ...base,
      ask: <>这次标识<em>不能安全继续</em>。</>,
      doing: '本机标识对不上，没有清除，也没有另起一次解析。',
      flag: '已停下',
      status: { tone: 'warn', label: '没有另起一次' },
    }
  }
  return {
    ...base,
    ask: <>这次解析<em>不能沿用原标识</em>。</>,
    doing: '同一标识不能恢复结果。本页不会自动再调用 AI。',
    flag: '标识已结束',
    status: { tone: 'warn', label: '原标识不能恢复' },
  }
}

export function ResumeParseUnknownNote(props: {
  terminal: ShownTerminal | null
  pendingTask: boolean
  recheck: string
  blockNote: string | null
  storageBlocked: boolean
  confirmFresh: number
  loggedIn: boolean
  onFresh: () => void
}) {
  const { terminal, pendingTask, recheck, blockNote, storageBlocked, confirmFresh, loggedIn, onFresh } = props
  if (terminal?.mode === 'blocked') {
    return <p className="qx-rt-note" data-tone="warn" role="status" data-testid="resume-parse-terminal">{terminal.note}</p>
  }
  if (terminal) {
    return (
      <>
        <p className="qx-rt-note resume-parse-terminal" data-tone="warn" data-testid="resume-parse-terminal">
          <b>{terminal.copy.title}</b>{terminal.copy.lead}
        </p>
        <dl className="qx-rt-kv">
          <div><dt>服务端确认</dt><dd>{terminal.copy.happened}</dd></div>
          <div><dt>本机标识</dt><dd>{terminal.copy.kept}</dd></div>
          <div><dt>建议这样做</dt><dd data-testid="resume-parse-terminal-next">{terminal.copy.next}</dd></div>
        </dl>
      </>
    )
  }
  return (
    <>
      <p className="qx-rt-note resume-parse-unknown" data-tone="warn">
        <b>结果未知</b>{pendingTask ? '服务端已经登记了这一次解析，但还没给出最终结果。' : '暂时无法确认这一次解析有没有完成。'}本页不会自动再提交，也不会把它当成失败。
      </p>
      <dl className="qx-rt-kv">
        <div><dt>发生了什么</dt><dd>{pendingTask ? '解析已经提交并拿到了编号，服务端还没返回最终结果。' : '提交解析后网络或服务出了问题，这台机器没能确认结果。'}</dd></div>
        <div><dt>还不确定的</dt><dd>这一次解析可能已经完成，也可能没有。</dd></div>
        {pendingTask ? (
          <div><dt>按编号再查</dt><dd>只是读取这一次的结果，不会重新解析，也不会多出记录。</dd></div>
        ) : (
          <>
            <div><dt>同一次重查</dt><dd>用已经保存的同一次标识再问一次，不会另起一次解析。</dd></div>
            <div><dt>重新提交</dt><dd>会作为新的一次解析重新调用 AI；如果刚才那次其实已经完成，记录里可能多出一条。</dd></div>
          </>
        )}
        <div>
          <dt>建议这样做</dt>
          <dd data-testid="resume-parse-unknown-next">
            {pendingTask
              ? '稍后点下方「按同一编号再查结果」；也可以返回简历来源换一份文件。'
              : loggedIn
                ? '可先到「我的 → 我的简历」核对；暂时没看到时可稍后刷新。先按同一次重查。若决定重新提交，这是新的一次解析。'
                : '当前未登录，暂时无法核对这一次的结果。需要继续时，先按同一次重查；重新提交会是新的一次解析。也可以返回简历来源。'}
          </dd>
        </div>
      </dl>
      {recheck === 'not-ready' && (
        <p className="qx-rt-note" role="status" data-testid="resume-parse-recheck-result">这次查到的仍不是最终结果，可以稍后再查。</p>
      )}
      {recheck === 'error' && (
        <p className="qx-rt-note" data-tone="warn" role="status" data-testid="resume-parse-recheck-result">这次没查到结果，可能是网络问题或编号已失效；可以稍后再查，或返回简历来源。</p>
      )}
      {blockNote && (
        <p className="qx-rt-note" data-tone="warn" role="status" data-testid="resume-parse-intent-note">{blockNote}</p>
      )}
      {!storageBlocked && confirmFresh === 0 && (!pendingTask || recheck === 'not-found') && (
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onFresh}>
          重新提交解析（新的一次）
        </button>
      )}
    </>
  )
}
