import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { ArtBox, Card, K } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusStack } from '../public-touch/PublicIllus'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import { SESSION_GUARD_ASKS, sessionGuardClears, sessionGuardSourceName, type SessionGuardState } from './sessionGuardModel'

/**
 * 闲置提醒的正文（触屏稿 cleared）。顶栏标题是「还在用吗？」，所以这里不再写第二个同名标题，只用 h2 写本页状态。
 * 版式：左边倒计时、右边说明；下面「本机会清除 / 不因此清除」两张清单；再是三个现场常问的事和求助句。
 * 倒计时由本机时钟执行；清除结果要等清除做完才算数，本页不提前写成已完成。
 */
export function SessionGuardView({
  state,
  seconds,
  sourcePath,
  sourceKnown,
  sessionImpact,
  isAnonymous,
  accountLabel,
}: {
  state: SessionGuardState
  seconds: number
  sourcePath: string
  sourceKnown: boolean
  /**
   * 按来源域定制的一句影响说明（「已创建的打印/扫描任务会继续运行…」等）。
   * 「这次会清掉什么」那几张卡说的是**所有会话都一样**的清除范围；
   * 这一句说的是**你这一趟**特有的后果——正在扫描的人最需要知道的是
   * 「任务会继续跑」，而不是通用的「登录态会清除」。
   */
  sessionImpact: string
  /** 匿名与已登录的后果不同：匿名这一趟清掉就没了，登录用户服务端上的数据不受影响。 */
  isAnonymous: boolean
  accountLabel: string
}) {
  const helpLine = useVisibleHelpLine()
  const copy = state === 'warning-no-continue'
    ? '这一次不允许再点「继续使用」。你可以立刻结束并清场，也可以等计时走完。这台机器上的一次使用有最长时限，到点就必须清场。'
    : state === 'clearing'
      ? (isAnonymous
        ? '清的是这台机器上这次的临时使用记录。结果要等清除做完才算数，本页不提前写成已完成。'
        : '清的是这台机器上的登录状态和这次的临时使用记录。结果要等清除做完才算数，本页不提前写成已完成。')
      : '这是公用设备的隐私保护。时间一到，本机上这趟留下的东西会被清掉；已经交给系统的任务和账号数据不受影响。'
  const heading = state === 'warning-no-continue'
    ? '这次不能就地继续'
    : state === 'clearing'
      ? '正在清除这台机器上的这次使用记录'
      : '没操作有一会儿了'
  const clears = sessionGuardClears(isAnonymous)

  return (
    <div className="cg-page" data-screen="session-guard" data-state={state} data-testid={`session-guard-state-${state}`}>
      <div className="qxp-pair cg-top">
        <Card className="cg-num">
          <div className="cg-count" role="group" aria-label="本机剩余计时">
            <b>{seconds}</b>
            <span>秒后自动结束这次使用</span>
          </div>
        </Card>
        <Card className="cg-copy">
          {/* 页面名由顶栏承担；这里的 h2 只给读屏说明本页状态，视觉上收起。 */}
          <h2 className="cg-sr" id="session-timeout-title">{heading}</h2>
          <p className="qxp-note">{copy}</p>
          <p className="qxp-note" data-testid="session-guard-impact">{sessionImpact}</p>
          <p className="qxp-note" data-testid="session-guard-identity">
            <span>{isAnonymous ? '这次使用：' : '当前登录：'}<b>{accountLabel}</b></span>
            {' · '}
            {/* 独立 span：用例按 exact 匹配这一句，混在同一个元素里会匹配不到，
                而这句是匿名用户唯一能看到的「退出就没了」的提示，不能被稀释。 */}
            <span>{isAnonymous ? '匿名任务退出后无法恢复' : '账号中已保存的数据不受本次终端清场影响'}</span>
          </p>
          {state === 'warning' ? (
            <p className="qxp-note sg-from">
              {/* 屏上只写页面名，不写路径；名字统一由 sessionGuardSourceName 给。 */}
              继续后回到 {sourceKnown ? <b>{sessionGuardSourceName(sourcePath)}</b> : <b>首页</b>}
              {sourceKnown ? null : '（这次读不到可用的来源页，所以回到首页）'}
            </p>
          ) : null}
          <p className="qxp-note">现在结束使用，会结束并清除这台机器上的这次使用记录。</p>
        </Card>
      </div>

      <div className="qxp-pair qxp-pair-grow cg-clears">
        {clears.map((card) => (
          <Card key={card.title} className="cg-clear">
            <K as="h3">{card.title}</K>
            <ul className="cg-list">
              {card.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <ArtBox>{card.title === '本机会清除' ? <IllusStack w={200} n={3} /> : <IllusChecklist w={200} />}</ArtBox>
          </Card>
        ))}
      </div>

      {state === 'warning' ? (
        <div className="qxp-col cg-asks">
          {SESSION_GUARD_ASKS.map((ask) => (
            <div key={ask.title} className="qxp-card cg-ask">
              <h3>{ask.title}</h3>
              <small>{ask.body}</small>
            </div>
          ))}
        </div>
      ) : null}

      <p className="qxp-note cg-truth" data-disclaimer="true" data-testid="session-guard-truth">
        倒计时由本机时钟执行，不依赖网络与 AI；这台机器没有离人传感器，也不做人脸判断。
      </p>
      {helpLine ? <QxTouchCallout kind="remind">{helpLine}</QxTouchCallout> : null}
    </div>
  )
}
