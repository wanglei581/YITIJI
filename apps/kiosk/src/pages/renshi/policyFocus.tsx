import { AlertTriangleIcon, FileTextIcon, HeartIcon, InfoIcon, RotateCcwIcon } from 'lucide-react'
import { RqDeadEnd, type DeadEndExit } from './components'
import type { PolicyFocusPhase } from './usePolicyFocus'

const OTHERS: Omit<DeadEndExit, 'onClick'> = {
  key: 'others',
  icon: FileTextIcon,
  title: '看看其他政策',
  desc: '先看现在能打开的',
}
const FAVORITES: Omit<DeadEndExit, 'onClick'> = {
  key: 'favorites',
  icon: HeartIcon,
  title: '返回我的收藏',
  desc: '这条收藏还留着',
}

export function PolicyFocusDeadEnd({
  phase,
  onOthers,
  onFavorites,
  onRetry,
}: {
  phase: Exclude<PolicyFocusPhase, 'idle'>
  onOthers: () => void
  onFavorites: () => void
  onRetry: () => void
}) {
  const others = { ...OTHERS, onClick: onOthers }
  const favorites = { ...FAVORITES, onClick: onFavorites }
  const retry: DeadEndExit = {
    key: 'retry',
    icon: RotateCcwIcon,
    title: '再试一次',
    desc: '再读一次这一条',
    onClick: onRetry,
  }
  if (phase === 'checking') {
    return (
      <div data-testid="renshi-policy-focus" data-focus-phase="checking">
        <RqDeadEnd
          tone="info"
          icon={InfoIcon}
          title="正在打开这条政策"
          exitsHint="不想等也可以先离开"
          exits={[others, favorites]}
          uploadDesc="打印你自己带来的文件"
          note="确认之前不拿别的政策顶上。"
        >
          先确认这条还在可查看的政策里。
        </RqDeadEnd>
      </div>
    )
  }
  if (phase === 'missing') {
    return (
      <div data-testid="renshi-policy-focus" data-focus-phase="missing">
        <RqDeadEnd
          tone="warn"
          icon={AlertTriangleIcon}
          title="这条政策现在打不开"
          exitsHint="收藏还留着"
          exits={[others, favorites]}
          uploadDesc="打印你自己带来的文件"
          note="不会用另一条政策顶上。"
        >
          收藏还在，但这条已经不在可查看的政策里，可能已经撤回，或这台机器上看不到。
        </RqDeadEnd>
      </div>
    )
  }
  return (
    <div data-testid="renshi-policy-focus" data-focus-phase="failed">
      <RqDeadEnd
        tone="error"
        icon={AlertTriangleIcon}
        title="这次没有打开这条政策"
        exitsHint="可以再试，也可以先离开"
        exits={[retry, others, favorites]}
        uploadDesc="打印你自己带来的文件"
        note="再试一次仍打不开时，先看其他政策。"
        noteTone="warn"
      >
        这次没有读到这条政策。
      </RqDeadEnd>
    </div>
  )
}
