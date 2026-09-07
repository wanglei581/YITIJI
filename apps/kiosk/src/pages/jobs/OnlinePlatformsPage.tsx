import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ExternalLinkIcon, QrCodeIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  DirAiAssist,
  DirExitList,
  DirKv,
  DirNote,
  DirQrHero,
  DirSec,
  DirState,
  DirStripItem,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { getTerminalCode } from '../../services/api/terminalConfig'

interface Platform {
  id: string
  name: string
  category: string
  url: string
}

const PLATFORMS: readonly Platform[] = [
  { id: 'boss', name: 'Boss直聘', category: '直聘平台', url: 'https://www.zhipin.com' },
  { id: '51job', name: '前程无忧', category: '综合平台', url: 'https://www.51job.com' },
  { id: 'zhilian', name: '智联招聘', category: '综合平台', url: 'https://www.zhaopin.com' },
  { id: 'liepin', name: '猎聘', category: '中高端平台', url: 'https://www.liepin.com' },
] as const

const BOUNDARY = '浏览、登录和投递都在来源平台完成，本机不接收简历，也不记录你在平台上的操作。'
const FIELDS = ['互联网与产品', '运营与市场', '销售与客户服务', '制造与工程', '行政与人事', '财务与商务'] as const

export function OnlinePlatformsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [screen, setScreen] = useState<'ready' | 'qr' | 'navigator' | 'invalid-platform'>('ready')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [field, setField] = useState('')
  const [fieldText, setFieldText] = useState('')
  const [cityText, setCityText] = useState('')
  const [stageText, setStageText] = useState('')
  const [note, setNote] = useState('')

  const active = useMemo(() => PLATFORMS.find((item) => item.id === activeId) ?? null, [activeId])
  const host = active ? new URL(active.url).host : ''

  useEffect(() => {
    const requested = searchParams.get('p')
    if (!requested) return
    const found = PLATFORMS.find((item) => item.id === requested)
    if (!found) {
      setScreen('invalid-platform')
      setActiveId(null)
      return
    }
    setActiveId(found.id)
    setScreen('qr')
  }, [searchParams])

  function openPlatform(platform: Platform) {
    setActiveId(platform.id)
    setScreen('qr')
  }

  const pill = screen === 'qr'
    ? { tone: 'ok' as const, label: '扫码后在来源平台自行浏览' }
    : screen === 'navigator'
      ? { tone: 'unknown' as const, label: '本人填写后再确认进入 AI 对话' }
      : screen === 'invalid-platform'
        ? { tone: 'warn' as const, label: '平台参数无效 · 不生成二维码' }
        : { tone: 'ok' as const, label: '4 个固定官网入口' }

  return (
    <QxPageFrame
      title="线上招聘平台"
      subtitle={
        screen === 'qr' ? '扫码打开官网，浏览、登录和投递都在该平台完成。'
          : screen === 'navigator' ? '快捷选项不是完整字典，可用自由文本补充任意方向。'
            : screen === 'invalid-platform' ? '平台标识不在固定清单中，返回列表重新选择。'
              : '选一个固定官网入口，扫码后在手机上打开。'
      }
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        screen === 'qr' || screen === 'invalid-platform' ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => { setScreen('ready'); setActiveId(null) }}>
            {screen === 'qr' ? '关闭二维码' : '返回平台列表'}
          </button>
        ) : screen === 'navigator' ? (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => setScreen('ready')}>返回平台列表</button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              onClick={() => navigate('/assistant?intent=career_explore')}
            >
              确认并开始 AI 方向探索
            </button>
          </>
        ) : (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/jobs')}>去看岗位信息</button>
          </>
        )
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-screen="online-platform" data-state={screen} data-testid={`online-platform-state-${screen}`}>
        {screen === 'invalid-platform' ? (
          <>
            <DirState tone="empty" testId="online-platform-invalid-platform" title="平台参数无效">
              平台标识不在当前固定清单中，因此不会生成二维码。返回列表重新选择四个已列出的官网入口。
            </DirState>
            <DirExitList>
              <DirStripItem icon={QrCodeIcon} tone="slate" title="返回平台列表" desc="重新选择固定官网入口" onClick={() => setScreen('ready')} />
              <DirStripItem icon={QrCodeIcon} title="AI 找岗方向" desc="先整理岗位方向和检索词" onClick={() => setScreen('navigator')} />
              <DirStripItem icon={ExternalLinkIcon} tone="wheat" title="岗位信息" desc="查看已审核发布岗位" onClick={() => navigate('/jobs')} />
            </DirExitList>
          </>
        ) : screen === 'qr' && active ? (
          <DirQrHero
            title={`用手机扫码打开 ${active.name} 官网`}
            address={<b>{host}</b>}
            url={active.url}
            steps={[
              '手机扫码，在浏览器里打开平台官网。',
              '浏览岗位、登录、投递都在该平台完成。',
              '本机不接收简历，也不记录你在平台上的操作。',
            ]}
            reason="二维码按内置官网地址生成。本机与这些平台没有数据对接，也不是合作关系；离开前请关掉二维码，不把账号留在公共终端。"
          />
        ) : screen === 'navigator' ? (
          <>
            <DirSec no="01" title="AI 找岗方向" hint="快捷选项只是起点，自由文本负责补齐" grow>
              <DirState tone="info" testId="online-platform-navigator-boundary" title="只整理方向和检索词">
                不展示虚构岗位，不给匹配分数，不读取浏览记录或历史画像。确认后才进入 AI 求职方向探索。
              </DirState>
              <div className="dw-fgrp">
                <span className="fl">关注领域</span>
                <span className="fc">
                  {FIELDS.map((item) => (
                    <button key={item} type="button" className={`dw-chip${field === item ? ' on' : ''}`} onClick={() => setField(item)}>{item}</button>
                  ))}
                </span>
              </div>
              <div className="dw-filter">
                <div className="dw-filter-fields">
                  <label className="dw-filter-input"><span>关注领域</span><input value={fieldText} onChange={(e) => setFieldText(e.target.value)} placeholder="可填写任意岗位或行业方向" /></label>
                  <label className="dw-filter-input"><span>工作地点</span><input value={cityText} onChange={(e) => setCityText(e.target.value)} placeholder="可填写任意城市、区域或远程倾向" /></label>
                  <label className="dw-filter-input"><span>当前阶段</span><input value={stageText} onChange={(e) => setStageText(e.target.value)} placeholder="可填写应届、经验年限或转行背景" /></label>
                  <label className="dw-filter-input"><span>补充说明</span><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="课程、项目、技能或希望避开的工作方式" /></label>
                </div>
              </div>
            </DirSec>
            <DirSec no="02" title="当前填写内容" hint="未填写的项目明确保留为空">
              <div className="dw-blk">
                <DirKv rows={[
                  ['关注领域', fieldText || field || '暂未指定'],
                  ['工作地点', cityText || '暂未指定'],
                  ['当前阶段', stageText || '暂未指定'],
                  ['补充说明', note.slice(0, 300) || '暂未填写'],
                ]} />
                <div className="dw-reason">确认前不会发起 AI 调用，也不会把这些文本交给来源平台。</div>
              </div>
            </DirSec>
          </>
        ) : (
          <DirSec no="01" title="选择来源平台" hint="当前固定展示 4 个官网入口" grow>
            <div className="dw-platform-grid" data-testid="online-platform-list">
              {PLATFORMS.map((platform) => (
                <button key={platform.id} type="button" className="dw-plat" onClick={() => openPlatform(platform)} data-testid={`online-platform-platform-${platform.id}`}>
                  <span className="dw-plat-ic">{platform.name.slice(0, 1)}</span>
                  <span className="dw-plat-main">
                    <span className="dw-plat-kicker">第三方官网入口</span>
                    <span className="dw-plat-n">{platform.name}<span className="dw-tag slate">{platform.category}</span></span>
                    <span className="dw-plat-d">{new URL(platform.url).host}</span>
                  </span>
                  <span className="dw-plat-flow">
                    <span><QrCodeIcon size={22} aria-hidden />手机扫码打开</span>
                    <span><ExternalLinkIcon size={22} aria-hidden />在官网继续浏览</span>
                  </span>
                  <span className="dw-plat-go"><QrCodeIcon size={24} aria-hidden />扫码打开来源平台</span>
                </button>
              ))}
            </div>
            <DirNote><b>{BOUNDARY}</b></DirNote>
            <DirStripItem icon={QrCodeIcon} title="AI 找岗方向" desc="快捷选项加自由填写，确认后再进入 AI 对话" onClick={() => setScreen('navigator')} />
            <DirAiAssist screen="online-platform" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
          </DirSec>
        )}
      </div>
    </QxPageFrame>
  )
}
