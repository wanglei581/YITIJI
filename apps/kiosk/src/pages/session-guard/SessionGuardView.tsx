import { SESSION_GUARD_ASKS, SESSION_GUARD_CLEARS, type SessionGuardState } from './sessionGuardModel'

export function SessionGuardView({
  state,
  seconds,
  sourcePath,
  sourceKnown,
}: {
  state: SessionGuardState
  seconds: number
  sourcePath: string
  sourceKnown: boolean
}) {
  const title = state === 'warning-no-continue'
    ? <>这次<em>不能</em>就地继续</>
    : state === 'clearing'
      ? <>正在<em>清除</em>本机会话</>
      : <>还在用吗？<em>没操作</em>有一会儿了</>
  const copy = state === 'warning-no-continue'
    ? '会话守卫这次没有给出「继续使用」的许可。你可以立刻结束并清场，也可以等计时走完。'
    : state === 'clearing'
      ? '清的是这台机器上的登录态与临时会话信息。结果由清场例程返回，本页不提前写成已完成。'
      : '这是公共终端的隐私保护。时间一到，本机上这趟留下的东西会被清掉；已经交给服务端的任务和账号数据不受影响。'

  return (
    <div className="sg-page qx-grow qx-scroll" data-screen="session-guard" data-state={state} data-testid={`session-guard-state-${state}`}>
      <section className="sg-hero">
        <div className="sg-num" role="group" aria-label="本机剩余计时">
          <b>{seconds}</b>
          <span>秒后按本机计时清场</span>
        </div>
        <div>
          <div className="sg-title" id="session-timeout-title">{title}</div>
          <p className="sg-copy">{copy}</p>
          {state === 'warning' ? (
            <div className="sg-from">
              继续后回到 {sourceKnown ? <b>{sourcePath}</b> : <b>首页</b>}
              {sourceKnown ? null : '（这次读不到可用的来源页，按 fail-closed 处理）'}
            </div>
          ) : null}
        </div>
      </section>

      {state === 'warning-no-continue' ? (
        <section className="sg-sec">
          <div className="qx-state" data-tone="info" data-testid="session-guard-fallback">
            <div>
              <div className="qx-state-t">为什么没有「继续使用」</div>
              <p className="qx-state-d">公共终端的会话有一个最长时限，到点就必须清场，不能靠反复点「继续」无限延长。</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sg-sec">
        <div className="sg-sec-h"><span className="t">这次会清掉什么</span></div>
        <div className="sg-grid">
          {SESSION_GUARD_CLEARS.map((card) => (
            <div key={card.title} className="sg-card">
              <h3>{card.title}</h3>
              <ul>
                {card.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {state === 'warning' ? (
        <section className="sg-sec">
          <div className="sg-sec-h"><span className="t">现场最常问的三件事</span></div>
          <div className="sg-grid3">
            {SESSION_GUARD_ASKS.map((ask) => (
              <div key={ask.title} className="sg-card">
                <h3>{ask.title}</h3>
                <p>{ask.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="sg-truth" data-disclaimer="true" data-testid="session-guard-truth">
        <div><b>倒计时</b>由本机时钟执行，不依赖网络与 AI；这台机器没有离人传感器，也不做人脸判断。</div>
        <div><b>清除范围</b>结束会话清除本机登录态与临时会话信息；服务端的订单与文件按留存期限管理。</div>
        <div><b>已创建的任务</b>打印/扫描任务在服务端继续运行，不会因为这次清场被取消。</div>
      </div>
    </div>
  )
}
