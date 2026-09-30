import { useEffect, useState } from 'react'
import { ComplianceBanner } from '@ai-job-print/ui'
import { SparklesIcon } from 'lucide-react'
import { Page } from '../Page'
import { screensaverService, type AiPosterStatusView } from '../../services/api/screensaver'
import { AssetsTab } from './AssetsTab'
import { PlaylistsTab } from './PlaylistsTab'
import { TerminalsTab } from './TerminalsTab'

type Tab = 'assets' | 'playlists' | 'terminals'
const TABS: { key: Tab; label: string }[] = [
  { key: 'assets', label: '素材库' },
  { key: 'playlists', label: '播放方案' },
  { key: 'terminals', label: '终端配置' },
]

export default function ScreensaverPage() {
  const [tab, setTab] = useState<Tab>('assets')
  const [aiStatus, setAiStatus] = useState<AiPosterStatusView | null>(null)
  const [aiStatusState, setAiStatusState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    screensaverService.aiPosterStatus().then((next) => { setAiStatus(next); setAiStatusState('ok') }).catch(() => { setAiStatus(null); setAiStatusState('error') })
  }, [])

  return (
    <Page title="宣传屏" subtitle="一体机待机时轮播宣传海报 / 视频；无操作进入，触摸唤醒">
      <ComplianceBanner tone="info" title="合规提示">待机宣传屏属线下一体机运营广告位，非招聘闭环。素材文案禁止出现「一键投递 / 立即投递 / 平台投递」等违规用语。</ComplianceBanner>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-600"><SparklesIcon className="h-4 w-4 text-neutral-400" aria-hidden="true" /><span>AI 文生图海报：{aiStatusState === 'error' ? '状态获取失败' : aiStatusState === 'loading' ? '正在获取状态…' : aiStatus?.enabled ? `已启用（${aiStatus.provider}）` : '二期能力，暂未启用'}{aiStatusState === 'ok' && !aiStatus?.enabled ? '（一期请上传自制海报 / 视频）' : ''}</span></div>
      <div className="mt-6 flex gap-1 border-b border-neutral-200">{TABS.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-neutral-500 hover:text-neutral-700'}`}>{item.label}</button>)}</div>
      <div className="mt-6">{tab === 'assets' && <AssetsTab />}{tab === 'playlists' && <PlaylistsTab />}{tab === 'terminals' && <TerminalsTab />}</div>
    </Page>
  )
}
