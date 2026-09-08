import type { PendingTask } from '../../services/api/pendingTasks'
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
      <div className="sr-page qx-grow qx-scroll" data-screen="session-resume" data-state="loading" data-testid="session-resume-state-loading">
        <div className="sr-head">
          <div>
            <p className="sr-head-p">先确认登录还在不在，再取你名下没办完的打印任务。取不到就说取不到，不会先画一份任务出来。</p>
          </div>
        </div>
        <ul className="sr-list">
          {Array.from({ length: 7 }, (_, i) => (
            <li key={i} className="sr-row" aria-hidden="true" data-testid={`session-resume-skeleton-${i}`}>
              <span className="sr-row-ic" />
              <span className="sr-row-tx" style={{ flex: 1 }}>
                <span className="sr-skel t" />
                <span className="sr-skel s" />
              </span>
              <span className="sr-skel a" />
            </li>
          ))}
        </ul>
        <Truth />
      </div>
    )
  }

  if (screen === 'empty') {
    return (
      <div className="sr-page qx-grow qx-scroll" data-screen="session-resume" data-state="empty" data-testid="session-resume-state-empty">
        <div className="sr-banner" data-testid="session-resume-empty">
          <div>
            <b>名下没有未完成的打印任务</b>
            <p>这条结论来自服务端返回的空列表，不是读取失败。历史订单不在这里。</p>
          </div>
        </div>
        <div className="sr-list" style={{ marginTop: 12 }}>
          {RESUME_EMPTY_EXITS.map((item) => (
            <button key={item.id} type="button" className="sr-link" data-testid={`session-resume-exit-${item.id}`} onClick={() => onExit(item.route)}>
              <span>
                <span className="sr-fn">{item.title}</span>
                <span className="sr-sub">{item.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <Truth />
      </div>
    )
  }

  if (screen === 'unavailable') {
    return (
      <div className="sr-page qx-grow qx-scroll" data-screen="session-resume" data-state="unavailable" data-testid="session-resume-state-unavailable">
        <div className="sr-banner" data-tone="bad" data-testid="session-resume-unavailable">
          <div>
            <b>没读到未完成任务</b>
            <p>读不出列表不等于任务没了；已经建好的单继续排队或出纸。先别重新下单。</p>
          </div>
        </div>
        <div className="sr-list" style={{ marginTop: 12 }}>
          {RESUME_UNAVAILABLE_EXITS.map((item) => (
            <button key={item.id} type="button" className="sr-link" data-testid={`session-resume-exit-${item.id}`} onClick={() => onExit(item.route)}>
              <span>
                <span className="sr-fn">{item.title}</span>
                <span className="sr-sub">{item.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <Truth />
      </div>
    )
  }

  return (
    <div className="sr-page qx-grow qx-scroll" data-screen="session-resume" data-state="list" data-testid="session-resume-state-list">
      <div className="sr-head">
        <span className="sr-count" data-testid="session-resume-count">共 {tasks.length} 条</span>
      </div>
      <ul className="sr-list">
        {tasks.map((task) => {
          const verdict = resumeVerdict(task)
          const look = resumeRowCopy(task)
          const amount = formatResumeAmount(task.resume.amountCents)
          const orderNo = task.resume.orderNo
          return (
            <li
              key={task.id}
              className="sr-row"
              data-testid={`session-resume-task-${task.id}`}
              data-status={task.status}
              data-pay={task.payStatus ?? 'none'}
              data-kind={verdict.ok ? verdict.dest : 'blocked'}
              data-blocked={verdict.ok ? '0' : '1'}
            >
              <span className="sr-row-ic" data-tone={look.tone} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="sr-fn">{task.fileName ?? '未命名打印任务'}</span>
                <span className="sr-sub">{look.sub}</span>
                <span className="sr-meta">
                  <span className="sr-chip">{look.label}</span>
                  {orderNo ? <span className="sr-chip">单号 {orderNo}</span> : <span className="sr-chip">无关联订单</span>}
                  {amount ? <span className="sr-chip">{amount}</span> : null}
                  <span className="sr-chip">更新于 {formatResumeUpdatedAt(task.updatedAt)}</span>
                </span>
              </span>
              <span className="sr-acts">
                {verdict.ok ? (
                  <button
                    type="button"
                    className="qx-btn"
                    data-variant="primary"
                    data-testid={`session-resume-continue-${task.id}`}
                    onClick={() => onContinue(task)}
                  >
                    {resumeContinueRoute(verdict.dest) === '/print/cashier' ? '去收银台付款' : '去打印进度'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="qx-btn" aria-disabled="true" disabled data-testid={`session-resume-continue-${task.id}`}>
                      继续（暂不可用）
                    </button>
                    <span className="sr-why" data-testid={`session-resume-why-${task.id}`}>{verdict.why}</span>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <Truth />
    </div>
  )
}

function Truth() {
  return (
    <div className="sr-truth" data-disclaimer="true" data-testid="session-resume-truth">
      <span><b>去向</b>只回这一单原来那一步：待付款去收银台，其余去打印进度。</span>
      <span><b>归属</b>只列你名下没办完的打印任务；未登录会先去登录页。</span>
      <span><b>边界</b>不重新建单，也不删除服务端订单或文件。</span>
    </div>
  )
}
