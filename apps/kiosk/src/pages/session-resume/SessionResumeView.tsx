import type { PendingTask } from '../../services/api/pendingTasks'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { ArtBox, Card, Hit, Note } from '../public-touch/PublicBlocks'
import { IllusMachine } from '../public-touch/PublicIllus'
import {
  formatResumeAmount,
  formatResumeUpdatedAt,
  RESUME_EMPTY_EXITS,
  RESUME_UNAVAILABLE_EXITS,
  resumeContinueRoute,
  resumeRowCopy,
  resumeVerdict,
  type ResumeScreen,
} from './sessionResumeModel'

type Exit = { id: string; title: string; sub: string; route: string }

function Exits({ items, onExit }: { items: readonly Exit[]; onExit: (route: string) => void }) {
  return (
    <div className="qxp-col sr-exits">
      {items.map((item) => (
        <Hit
          key={item.id}
          title={item.title}
          sub={item.sub}
          chevron
          testId={`session-resume-exit-${item.id}`}
          onClick={() => onExit(item.route)}
        />
      ))}
    </div>
  )
}

/** 已登录后的正文：读取中 / 空 / 读不到 / 列表。读取中不画骨架，只说明在做什么。 */
export function SessionResumeView({
  screen,
  tasks,
  onContinue,
  onExit,
}: {
  screen: ResumeScreen
  tasks: PendingTask[]
  onContinue: (task: PendingTask) => void
  onExit: (route: string) => void
}) {
  if (screen === 'loading') {
    return (
      <div className="qxp-grow sr-page" data-screen="session-resume" data-state="loading" data-testid="session-resume-state-loading">
        <QxTouchCallout kind="howto" icon="alert">先确认登录还在不在，再取你名下没办完的打印任务。取不到就说取不到，不会先画一份任务出来。</QxTouchCallout>
        <Card className="sr-sink">
          <ArtBox><IllusMachine /></ArtBox>
        </Card>
      </div>
    )
  }

  if (screen === 'empty') {
    return (
      <div className="qxp-grow sr-page" data-screen="session-resume" data-state="empty" data-testid="session-resume-state-empty">
        <div data-testid="session-resume-empty">
          <QxTouchCallout kind="howto" icon="alert">没有没办完的打印。已经完成的不在这里。</QxTouchCallout>
        </div>
        <Exits items={RESUME_EMPTY_EXITS} onExit={onExit} />
        <Card className="sr-sink" testId="session-resume-truth">
          <Note>这条结论来自系统返回的空列表，不是读取失败。历史订单不在这里。</Note>
          <ArtBox><IllusMachine /></ArtBox>
        </Card>
      </div>
    )
  }

  if (screen === 'unavailable') {
    return (
      <div className="qxp-grow sr-page" data-screen="session-resume" data-state="unavailable" data-testid="session-resume-state-unavailable">
        <div data-testid="session-resume-unavailable">
          <QxTouchCallout kind="howto" icon="alert">读不出列表不等于任务没了；已经建好的单继续排队或出纸。先别重新下单。</QxTouchCallout>
        </div>
        <Exits items={RESUME_UNAVAILABLE_EXITS} onExit={onExit} />
        <Card className="sr-sink" testId="session-resume-truth">
          <Note>读不到不等于没有。可以点下面的「重新读取」再试一次，或先用到机码继续。</Note>
          <ArtBox><IllusMachine /></ArtBox>
        </Card>
      </div>
    )
  }

  return (
    <div className="qxp-grow sr-page" data-screen="session-resume" data-state="list" data-testid="session-resume-state-list">
      <p className="qxp-k" data-testid="session-resume-count">共 {tasks.length} 条</p>
      <ul className="qxp-col sr-list">
        {tasks.map((task) => {
          const verdict = resumeVerdict(task)
          const look = resumeRowCopy(task)
          const amount = formatResumeAmount(task.resume.amountCents)
          const orderNo = task.resume.orderNo
          const taskName = task.fileName ?? '未命名打印任务'
          const go = verdict.ok && resumeContinueRoute(verdict.dest) === '/print/cashier' ? '去收银台付款' : '去打印进度'
          return (
            <li
              key={task.id}
              className="qxp-card sr-row"
              data-testid={`session-resume-task-${task.id}`}
              data-status={task.status}
              data-pay={task.payStatus ?? 'none'}
              data-kind={verdict.ok ? verdict.dest : 'blocked'}
              data-blocked={verdict.ok ? '0' : '1'}
            >
              <b className="sr-name">{taskName}</b>
              <span className="sr-meta">
                {look.label} · {orderNo ? `单号 ${orderNo}` : '无关联订单'}{amount ? ` · ${amount}` : ''} · 更新于 {formatResumeUpdatedAt(task.updatedAt)}
              </span>
              <span className="sr-sub">{look.sub}</span>
              {verdict.ok ? (
                <button
                  type="button"
                  className="qxp-hit sr-go"
                  data-testid={`session-resume-continue-${task.id}`}
                  /* 可见文案只说去哪，不说是哪一份——待办有好几条时，这些按钮读起来
                     一模一样，屏读用户听不出点的是哪个材料。把文件名并进无障碍名。 */
                  aria-label={`${taskName} · ${go}`}
                  onClick={() => onContinue(task)}
                >
                  <span className="qxp-tx"><b>{go}</b></span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="qxp-hit qxp-hit-off sr-go"
                    aria-disabled="true"
                    disabled
                    aria-label={`${taskName} · 继续（暂不可用）`}
                    data-testid={`session-resume-continue-${task.id}`}
                  >
                    <span className="qxp-tx"><b>继续（暂不可用）</b></span>
                  </button>
                  <span className="sr-why" data-testid={`session-resume-why-${task.id}`}>{verdict.why}</span>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <Card className="sr-sink" testId="session-resume-truth">
        <Note>继续回到这一单原来那一步。已经完成的不在这里。</Note>
        <ArtBox><IllusMachine /></ArtBox>
      </Card>
    </div>
  )
}
