import { Clock, Lock, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { helpNeededLine, type PublicSupportContact } from '../../../../copy/unattendedCopy'
import { FeedbackMark } from './FeedbackMark'
import type { FeedbackStateScreen, FeedbackUiState } from './feedbackRules'
import { CATEGORY_OPTIONS } from './types'

export function FeedbackStateBody({ state, contact }: { state: FeedbackStateScreen; contact: PublicSupportContact }) {
  const help = helpNeededLine(contact)
  return (
    <>
      <StateBanner state={state} />
      <section
        className="qx-me-list fb-list fb-fill"
        aria-label={state === 'loading' || state === 'detail-loading' ? '正在加载的工单占位' : '反馈分类'}
      >
        {state === 'loading' || state === 'detail-loading'
          ? [0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="qx-me-row" aria-hidden="true" data-testid={`member-feedback-skeleton-${index}`}>
              <span className="qx-me-row-ico" data-tone="off" />
              <span className="qx-me-row-main">
                <span className="fb-skel fb-skel-t" />
                <span className="fb-skel fb-skel-s" />
              </span>
            </div>
          ))
          : CATEGORY_OPTIONS.map((option) => (
            <div
              key={option.value}
              className="qx-me-row"
              data-testid={`member-feedback-cat-slot-${option.value}`}
            >
              <FeedbackMark category={option.value} off />
              <span className="qx-me-row-main">
                <span className="qx-me-row-title">{option.label}</span>
                <span className="qx-me-row-sub">{option.hint}</span>
              </span>
              {state === 'login' ? (
                <span className="qx-me-small" aria-disabled="true" data-testid={`member-feedback-cat-slot-${option.value}-locked`}>
                  <Lock size={19} aria-hidden="true" />
                  登录后可提交
                </span>
              ) : (
                <span className="qx-me-small" aria-disabled="true" data-testid={`member-feedback-cat-slot-${option.value}-off`}>
                  <TriangleAlert size={19} aria-hidden="true" />
                  当前不可提交
                </span>
              )}
            </div>
          ))}
        <p className="qx-me-legal">{foot(state, help)}</p>
      </section>
      <Guide state={state} help={help} />
    </>
  )
}

function StateBanner({ state }: { state: FeedbackStateScreen }) {
  const tone = state === 'login' ? 'lock' : state === 'loading' || state === 'detail-loading' ? 'calm' : 'warn'
  const icon = tone === 'lock' ? <Lock size={28} aria-hidden="true" /> : tone === 'calm' ? <Clock size={28} aria-hidden="true" /> : <TriangleAlert size={28} aria-hidden="true" />
  const copy = bannerCopy(state)
  return (
    <section className="qx-me-banner" data-testid="member-feedback-fallback" data-kind={tone}>
      <span className="qx-me-banner-ico" data-tone={tone}>{icon}</span>
      <span className="qx-me-banner-main">
        <span className="qx-me-banner-t">{copy.title}</span>
        <span className="qx-me-banner-p">{copy.desc}</span>
      </span>
      <span className="qx-me-banner-mini">
        {copy.minis.map((item) => <i key={item}>{item}</i>)}
      </span>
    </section>
  )
}

function bannerCopy(state: FeedbackStateScreen): { title: string; desc: ReactNode; minis: string[] } {
  if (state === 'login') {
    return {
      title: '登录后提交与查看本人反馈',
      desc: <>公共一体机不会在未登录时展示任何工单标题、正文或联系方式。<b>下面是登录后能提交的五类反馈。</b></>,
      minis: ['共 —', '登录后回填'],
    }
  }
  if (state === 'service-unavailable') {
    return {
      title: '当前无法提交反馈',
      desc: <>没有连接到会员服务，或当前没有有效的会员登录。<b>本页不做本地假提交</b>：连接真实服务并登录后，才可查看和提交本人反馈。</>,
      minis: ['共 —', '服务未连接'],
    }
  }
  if (state === 'loading') {
    return {
      title: '正在加载本人反馈',
      desc: <>正在读取当前账号的工单。<b>返回前一律显示「—」</b>，不会闪回上一位用户的工单。</>,
      minis: ['共 —', '正在安全读取'],
    }
  }
  if (state === 'detail-loading') {
    return {
      title: '正在读取详情',
      desc: <>正在读取这条工单的正文与沟通记录。<b>返回前不显示任何内容</b>。</>,
      minis: ['—', '正在安全读取'],
    }
  }
  return {
    title: '反馈列表这次没有加载出来',
    desc: <>当前列表没有更新。<b>本页不会拿上一次的内容冒充当前账号</b>；已提交的反馈不会因为这次失败而丢失。</>,
    minis: ['共 —', '本次未取到'],
  }
}

function foot(state: FeedbackStateScreen, help: string): ReactNode {
  if (state === 'login') {
    return <>登录只用来确认「是你本人」。不想登录也可以反馈：<b>打印完成页有免登录的问题反馈入口</b>，那条只提交、不建档，也看不到状态。</>
  }
  if (state === 'service-unavailable') {
    return <>这五类反馈都需要会员服务在线才能建档。<b>现在仍然可以走的路</b>：在打印完成页用免登录的问题反馈。{help}</>
  }
  if (state === 'loading') return '这次读取失败不会丢失草稿，也不会重复创建工单。'
  if (state === 'detail-loading') return '读取失败不会改动这条工单的状态，也不会丢失已提交的内容。'
  return <>重试不会重复创建工单。多次重试仍失败时，{help}</>
}

function Guide({ state, help }: { state: FeedbackUiState; help: string }) {
  const rows = state === 'login'
    ? [
      ['隐私', '只对本人可见', '工单与账号绑定，退出后本机不留明细'],
      ['联系方式', '选填手机号', '只在需要确认设备或文件问题时使用'],
      ['另一条路', '不想登录也能反馈', '打印完成页有免登录的问题反馈入口'],
    ]
    : state === 'service-unavailable'
      ? [
        ['当前状态', '未连接会员服务', '没有会员令牌时不做本地假提交'],
        ['能做什么', '先完成登录', '登录后即可提交并查看本人工单'],
        ['另一条路', '免登录反馈', '打印完成页的问题反馈只提交、不建档'],
      ]
      : state === 'error'
        ? [
          ['数据', '已提交工单不受影响', '这次加载失败不会删除任何工单'],
          ['先试这个', '检查网络后重试', '重试不会重复创建工单'],
          ['仍不行', '帮助中心', help],
        ]
        : [
          ['读取范围', '只读当前账号', '不会展示其他账号的工单'],
          ['显示规则', '不闪回旧工单', '上一位用户的内容不会残留在屏幕上'],
          ['失败怎么办', '保留重试入口', '读取失败不会丢失草稿'],
        ]
  return (
    <section className="qx-me-guide" aria-label="说明">
      {rows.map((item) => (
        <div key={item[0]} className="qx-me-guide-item">
          <div className="qx-me-guide-k">{item[0]}</div>
          <div className="qx-me-guide-t">{item[1]}</div>
          <div className="qx-me-guide-p">{item[2]}</div>
        </div>
      ))}
    </section>
  )
}

export function FeedbackDetailGuide() {
  const rows = [
    ['沟通记录', '由本人与运营组成', '服务回复只代表运营处理意见，不代表最终结论'],
    ['追加描述', '至少 2 个字', '追加不会改变工单分类'],
    ['关闭反馈', '关闭后不能再追加', '如仍有问题，请新建一条反馈'],
  ]
  return (
    <section className="qx-me-guide" aria-label="说明">
      {rows.map((item) => (
        <div key={item[0]} className="qx-me-guide-item">
          <div className="qx-me-guide-k">{item[0]}</div>
          <div className="qx-me-guide-t">{item[1]}</div>
          <div className="qx-me-guide-p">{item[2]}</div>
        </div>
      ))}
    </section>
  )
}
