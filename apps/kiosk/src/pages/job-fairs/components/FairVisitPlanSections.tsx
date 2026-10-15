// /job-fairs/:id/visit-plan 的正文分区（稿 28-jobfair-enhanced.html，screen=visit-plan / 092）。
//
// 从 FairVisitPlanPage 抽出来的原因只有一个：那一页的状态机在 2026-09-20 补回了
// `idle`（简历已确认、还没生成过）与 `load-failed`（上次结果没取到）两个真实状态，
// 页面随之越过 500 行。抽的是**渲染**，状态机与副作用一律留在页面里 ——
// 分区只接收已经算好的数据，自己不发请求、不判定能不能生成。
//
// 「本机记录」区是非 LLM 事实区：只列本机真实记录过的动作，绝不推断现场发生了什么。
// REVIEW_DISCLOSURE 由页面导出（verify:fair-visit-review-ui 钉在那里），这里只渲染。

import type { FairVisitPlanResponse } from '@ai-job-print/shared'
import { BuildingIcon, HelpCircleIcon } from 'lucide-react'
import { DirKv, DirNote } from '../../../components/qingxu/directory/DirectoryBits'

export interface FairVisitPlanBodyProps {
  plan: FairVisitPlanResponse
  /** 服务端按 endAt 判定的形态；前端只读，不自己猜。 */
  isReview: boolean
  /** 优先企业分区的标题与副标题（准备单 / 回顾两套措辞）。 */
  companiesCopy: { title: string; subtitle: string }
  /** 回顾态必显的诚实声明，逐字来自页面导出的 REVIEW_DISCLOSURE。 */
  reviewDisclosure: string
}

export function FairVisitPlanBody({
  plan,
  isReview,
  companiesCopy,
  reviewDisclosure,
}: FairVisitPlanBodyProps) {
  return (
    <>
      <DirNote>
        {isReview
          ? '本回顾仅供本人后续跟进参考；岗位办理和结果均以来源平台为准，本系统不接收简历。'
          : '本准备单仅供本人参会准备参考；活动预约、岗位办理和结果均以来源平台为准，本系统不接收简历。'}
      </DirNote>

      <section className="dw-blk">
        <div className="dw-sec-h"><span className="t">总览</span><span className="hint">结合你的简历方向与本场公开信息</span></div>
        <p className="dw-ai-d">{plan.summary}</p>
      </section>

      <section className="dw-blk">
        <div className="dw-sec-h">
          <span className="t">{companiesCopy.title}</span>
          <span className="hint">{companiesCopy.subtitle}</span>
        </div>
        {(plan.priorityCompanies ?? []).length === 0 ? (
          <p className="dw-why">
            {isReview
              ? '本场企业信息有限，可前往来源平台查看该主办方发布的企业与在招岗位。'
              : '本场企业信息有限，建议先打印活动资料并按现场展位逐一了解。'}
          </p>
        ) : (
          <div className="dw-rlist">
            {(plan.priorityCompanies ?? []).map((company) => (
              <div key={company.companyName} className="dw-row solid">
                <span className="dw-row-ic slate"><BuildingIcon size={24} aria-hidden /></span>
                <span className="dw-row-main">
                  <span className="dw-row-t">{company.companyName}</span>
                  <span className="dw-row-sub"><span>{company.reason}</span></span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dw-blk">
        <div className="dw-sec-h">
          <span className="t">{isReview ? '后续可做的跟进动作' : '参会前准备清单'}</span>
          <span className="hint">{isReview ? '活动已结束，这些是现在就能做的' : '出发前逐项核对'}</span>
        </div>
        <ul className="qxfw-checklist">
          {((isReview ? plan.followUpActions : plan.preparationChecklist) ?? []).map((item) => (
            <li key={item}><span className="box" aria-hidden />{item}</li>
          ))}
        </ul>
      </section>

      <section className="dw-blk">
        <div className="dw-sec-h"><span className="t">{isReview ? '本场概况' : '本场看点'}</span></div>
        <ul className="qxfw-bullets">
          {(plan.fairHighlights ?? []).map((item) => <li key={item}><i aria-hidden />{item}</li>)}
        </ul>
      </section>

      <section className="dw-blk">
        <div className="dw-sec-h">
          <span className="t">{isReview ? '下次同类活动可提前准备的问题' : '现场可咨询问题'}</span>
          <span className="hint"><HelpCircleIcon size={18} aria-hidden /> AI 生成，仅供参考</span>
        </div>
        <ul className="qxfw-bullets">
          {((isReview ? plan.nextTimeQuestions : plan.questionsToAsk) ?? []).map((item) => (
            <li key={item}><i aria-hidden />{item}</li>
          ))}
        </ul>
      </section>

      {/* 现场提醒只在未结束场次出现：活动结束后「现场提醒」没有存在意义。 */}
      {!isReview && (plan.onsiteTips ?? []).length > 0 && (
        <section className="dw-blk">
          <div className="dw-sec-h"><span className="t">现场提醒</span><span className="hint">AI 生成，仅供参考</span></div>
          <ul className="qxfw-bullets">
            {(plan.onsiteTips ?? []).map((item) => <li key={item}><i aria-hidden />{item}</li>)}
          </ul>
        </section>
      )}

      {/* 本机记录：非 AI 事实区。只列本机真实记录的动作，绝不推断现场发生了什么。 */}
      {isReview && (
        <section className="dw-blk" data-review-records>
          <div className="dw-sec-h">
            <span className="t">你在本机留下的记录</span>
            <span className="hint">非 AI 生成，来自本机真实记录</span>
          </div>
          {plan.localRecords?.requiresLogin ? (
            <p className="dw-ai-d">未登录会员，无法关联你在本机的浏览与跳转记录。</p>
          ) : (plan.localRecords?.openedCompanySourceEntries ?? []).length > 0 ? (
            <>
              <p className="dw-ai-d">你在本机打开过这些参展企业的来源投递入口：</p>
              <ul className="qxfw-bullets">
                {(plan.localRecords?.openedCompanySourceEntries ?? []).map((name) => (
                  <li key={name}><i aria-hidden />{name}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="dw-ai-d">本机没有你在这场招聘会打开来源投递入口的记录。</p>
          )}
          <p className="dw-why">{reviewDisclosure}</p>
        </section>
      )}

      <section className="dw-blk">
        <div className="dw-sec-h"><span className="t">这份清单基于什么</span><span className="hint">可追溯，可核对</span></div>
        <DirKv rows={[
          // basedOn.resume 是 `true` 字面量，服务端不回传简历文件名。
          // 不编一个「本次会话确认的简历」当名字——那是在纸面上冒充可追溯。
          ['使用的简历', plan.basedOn?.resume ? '本人在本机确认的简历（服务端不回传文件名）' : '服务端未回传依据'],
          ['参展名单版本', `${plan.basedOn?.companyCount ?? 0} 家企业 / ${plan.basedOn?.positionCount ?? 0} 个岗位`],
          ['是否已入库', '以服务端返回为准，本页不代为确认'],
        ]} />
      </section>
    </>
  )
}
