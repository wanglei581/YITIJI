// 招聘内容托管关闭时的诚实说明页（next-tasks 3.13）。
//
// 这台终端没有开通岗位、招聘会、企业、校园招聘或线下机构信息时，直达这些地址
// （旧二维码、收藏夹、小青给过的链接）落到这里：说清楚没开通，给出本机照常能办的事，
// 不留报错页，也不跳回首页让人以为点错了。结构取稿 09 system-state 的「状态说明 →
// 可以直接去的地方 → 屏幕不会替你猜的事」，壳用青序流光 QxPageFrame。
// 配置还没读到时只说「正在确认」，不下结论，也不先摆出一排去处再收回。

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRightIcon,
  FileTextIcon,
  InfoIcon,
  LandmarkIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  LockIcon,
  MicIcon,
  PrinterIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import './recruitment-hosting-qx.css'

type Topic = 'jobs' | 'fairs' | 'companies' | 'campus' | 'agencies'

const TOPIC_LABEL: Record<Topic, string> = {
  jobs: '岗位信息',
  fairs: '招聘会信息',
  companies: '企业信息',
  campus: '校园招聘信息',
  agencies: '线下招聘机构信息',
}

function topicOf(pathname: string): Topic {
  if (pathname.startsWith('/job-fairs') || pathname === '/fairs-service') return 'fairs'
  if (pathname.startsWith('/companies')) return 'companies'
  if (pathname === '/campus' || pathname.startsWith('/campus/')) return 'campus'
  if (pathname.startsWith('/offline-agencies')) return 'agencies'
  return 'jobs'
}

/** 本机照常能办、不依赖招聘内容的既有入口。 */
const ALTERNATIVES: { key: string; icon: ReactNode; title: string; desc: string; to: string }[] = [
  { key: 'resume', icon: <FileTextIcon size={28} />, title: 'AI 简历', desc: '诊断、逐条优化、生成新版本', to: '/resume-service' },
  { key: 'job-fit', icon: <ListChecksIcon size={28} />, title: '简历对照', desc: '填一份岗位要求，AI 对照你的简历', to: '/resume/job-fit' },
  { key: 'interview', icon: <MicIcon size={28} />, title: '模拟面试', desc: '问答对练，不做录用判断', to: '/interview-service' },
  { key: 'print', icon: <PrinterIcon size={28} />, title: '打印 · 扫描', desc: '简历、证明材料与照片', to: '/print-scan' },
  { key: 'policy', icon: <LandmarkIcon size={28} />, title: '就业政策', desc: '政策、社保与登记指引，以官方核验为准', to: '/policy-service' },
]

/** 这一页不替用户猜的三件事：都是本机的真实边界，不是安慰话。 */
const FACTS: { key: string; icon: ReactNode; title: string; desc: string }[] = [
  { key: 'operator', icon: <UsersIcon size={24} />, title: '由运营方决定', desc: '这台终端提不提供岗位、招聘会与企业信息，由它的运营方决定。' },
  { key: 'resume', icon: <ShieldCheckIcon size={24} />, title: '不代收简历', desc: '本机不收简历，也不把你的资料转交给任何企业。' },
  { key: 'privacy', icon: <LockIcon size={24} />, title: '资料只给本人', desc: '登录后的记录只你本人可见；结束使用会清除本机会话。' },
]

export function RecruitmentHostingOffPage({ pathname, checking }: { pathname: string; checking: boolean }) {
  const navigate = useNavigate()
  const topic = topicOf(pathname)
  const label = TOPIC_LABEL[topic]
  const home = () => navigate('/')

  return (
    <QxPageFrame
      title={checking ? '正在确认本机开通的服务' : `本终端未开放${label}`}
      subtitle={checking ? '确认之前不显示招聘类内容。' : '简历、面试、打印与政策服务照常可用。'}
      status={checking ? { tone: 'unknown', label: '正在确认本机配置' } : { tone: 'warn', label: '本终端未开放此项服务' }}
      back={{ label: '返回首页', onBack: home }}
      navbar={<QxAppNavbar onHome={home} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
      ctabar={(
        <>
          <p className="why">{checking ? '确认完成前这里不下结论。' : '想办别的事，回首页或点上面任一项就行。'}</p>
          <button type="button" className="qx-btn" data-variant={checking ? 'ghost' : 'primary'} onClick={home}>
            返回首页
          </button>
        </>
      )}
    >
      <div
        className="qx-scroll rh-off"
        data-kiosk-screen="recruitment-hosting"
        data-state={checking ? 'checking' : 'off'}
        data-recruitment-topic={topic}
      >
        <section className="rh-off-hero" role="status">
          <span className="rh-off-glyph" aria-hidden="true">
            {checking ? <LoaderCircleIcon size={56} /> : <InfoIcon size={56} />}
          </span>
          <div className="rh-off-hero-main">
            <p className="rh-off-eyebrow">本机服务说明</p>
            <h2>{checking ? '正在读取这台终端的配置' : '换一项服务，照样能办'}</h2>
            <p>
              {checking
                ? '读取失败或没有开通时会直接说明，不会先显示内容再收回。'
                : '这里不显示任何岗位、招聘会或企业内容，也没有相关的办理入口。按旧二维码或旧链接来的，可以从下面换一项服务。'}
            </p>
          </div>
        </section>
        {checking ? null : (
          <>
            <section className="rh-off-actions" aria-labelledby="rh-off-actions-title">
              <div className="qx-sec-h">
                <span className="t" id="rh-off-actions-title">现在可以办的事</span>
                <span className="hint">都在这台终端上</span>
              </div>
              <div className="qx-rows">
                {ALTERNATIVES.map((item) => (
                  <button key={item.key} type="button" className="qx-row" data-route={item.to} onClick={() => navigate(item.to)}>
                    <span className="qx-row-ic" aria-hidden="true">{item.icon}</span>
                    <span className="qx-row-tx">
                      <span className="qx-row-t">{item.title}</span>
                      <span className="qx-row-d">{item.desc}</span>
                    </span>
                    <ChevronRightIcon className="qx-row-go" size={26} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
            <section className="rh-off-facts" aria-label="这一页不替你猜的事">
              {FACTS.map((fact) => (
                <div key={fact.key} className="rh-off-fact">
                  <span className="rh-off-fact-ic" aria-hidden="true">{fact.icon}</span>
                  <b>{fact.title}</b>
                  <p>{fact.desc}</p>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </QxPageFrame>
  )
}
