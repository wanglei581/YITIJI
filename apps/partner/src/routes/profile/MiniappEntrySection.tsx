import { useEffect, useState } from 'react'
import { Button, Card, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  DownloadIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SmartphoneIcon,
} from 'lucide-react'
import {
  miniappEntryErrorMessage,
  partnerMiniappEntryService,
  type MiniappEnvVersion,
  type PartnerMiniappEntryCodeResult,
  type PartnerMiniappEntryInfo,
} from '../../services/api/miniappEntry'

function envMeta(env: MiniappEnvVersion): { label: string; tone: 'success' | 'warning' | 'default'; hint: string } {
  if (env === 'release') {
    return {
      label: '正式版 · 对外可扫',
      tone: 'success',
      hint: '可直接用于就业大厅展板、学校官网、宣传册及微信公众号菜单对外发放。',
    }
  }
  if (env === 'trial') {
    return {
      label: '体验版 · 仅体验成员可扫',
      tone: 'warning',
      hint: '当前平台小程序码环境为体验版，仅微信体验成员可扫码进入，请勿直接印制对外展板。',
    }
  }
  return {
    label: '开发版 · 仅联调使用',
    tone: 'warning',
    hint: '当前平台小程序码环境为开发版，仅限内部联调验证，对外发放前请等待正式版切换。',
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallback below */
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

/**
 * 合作机构资料页：「数字就业服务站 · 本机构专属小程序推广凭证」（一机构一码）。
 * 机构经办人可直接复制公众号菜单路径，或一键生成并下载本机构专属无限制小程序码；
 * 严格如实标注 envVersion（正式版 / 体验版 / 开发版），不伪装对外可用能力。
 */
export function MiniappEntrySection() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [info, setInfo] = useState<PartnerMiniappEntryInfo | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [generating, setGenerating] = useState(false)
  const [codeResult, setCodeResult] = useState<PartnerMiniappEntryCodeResult | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    setState('loading')
    partnerMiniappEntryService
      .getInfo()
      .then((data) => {
        if (!alive) return
        setInfo(data)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (!alive) return
        setLoadError(miniappEntryErrorMessage(err, '未能读取本机构小程序入口配置，请稍后重试'))
        setState('error')
      })
    return () => { alive = false }
  }, [reloadKey])

  const handleCopyPath = async () => {
    if (!info) return
    const ok = await copyText(info.miniappPath)
    setActionNotice(
      ok
        ? { tone: 'success', text: '已复制公众号菜单路径，可直接粘贴至微信公众号自定义菜单或官网按钮。' }
        : { tone: 'error', text: '浏览器限制了自动复制，请手动选中上方路径复制。' },
    )
  }

  const handleGenerate = async () => {
    if (!info || generating) return
    setGenerating(true)
    setActionNotice(null)
    try {
      const res = await partnerMiniappEntryService.generateCode()
      setCodeResult(res)
      setActionNotice({ tone: 'success', text: '已生成本机构专属小程序码，可立即下载用于展板与宣传物料。' })
    } catch (err: unknown) {
      setActionNotice({
        tone: 'error',
        text: miniappEntryErrorMessage(err, '小程序码生成失败，请稍后重试'),
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!codeResult || !info) return
    const ext = codeResult.mimeType === 'image/png' ? 'png' : 'jpg'
    const safeName = (info.brandName || info.orgName || info.orgId).replace(/[\\/:*?"<>|]/g, '_')
    const link = document.createElement('a')
    link.href = codeResult.dataUri
    link.download = `${safeName}-专属小程序码.${ext}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const env = info ? envMeta(codeResult?.envVersion ?? info.envVersion) : null
  const canGenerate = Boolean(info && info.miniappCodeAvailable && info.sceneValid)

  return (
    <Card padding="none" className="mt-6 overflow-hidden border-[#c8a86c]/35">
      {/* 墨翠鎏金机构专享抬头条 */}
      <div className="bg-gradient-to-r from-[#0B2922] via-[#113B32] to-[#174E42] px-6 py-4 text-white">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#dfc693]/20 ring-1 ring-[#dfc693]/40">
            <SmartphoneIcon className="h-4 w-4 text-[#f0ddb4]" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold tracking-[0.01em] text-white [font-family:var(--font-heading,inherit)]">
              专属小程序入口与推广凭证（一机构一码）
            </h3>
            <p className="mt-0.5 text-[11px] tracking-[0.06em] text-[#dfc693]/85">
              OFFICIAL CO-BRANDED ENTRY · 联名数字就业服务站
            </p>
          </div>
          {env && (
            <div className="ml-auto">
              <StatusBadge dot status={env.tone} label={env.label} />
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        <p className="text-xs leading-relaxed text-neutral-500">
          求职者通过本机构专属小程序码或公众号菜单进入后，小程序首页自动展示本机构联名标识，并在打印选点时优先置顶本机构在线终端（仅含 AI 工具与终端打印履约，不涉及站内招聘发布）。
        </p>

        {state === 'loading' && (
          <div className="mt-4">
            <LoadingState text="正在读取本机构小程序入口配置…" size="md" className="py-8" />
          </div>
        )}

        {state === 'error' && (
          <div className="mt-4">
            <ErrorState
              className="py-8"
              title="暂时无法读取本机构小程序入口"
              message={loadError}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          </div>
        )}

        {state === 'ready' && info && env && (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* 左栏：鎏金白瓷专属小程序码展台 */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-[#c8a86c]/35 bg-gradient-to-b from-[#faf8f2] to-[#f4f7f5] p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] lg:col-span-4">
              {codeResult ? (
                <>
                  <div className="rounded-xl border border-[#c8a86c]/45 bg-white p-3 shadow-sm">
                    <img
                      src={codeResult.dataUri}
                      alt={`${info.orgName}专属小程序码`}
                      className="h-40 w-40 object-contain"
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-neutral-900">{info.brandName || info.orgName} × 职易达</p>
                  <p className="mt-1 font-mono text-[11px] text-neutral-400">scene: {codeResult.miniappScene}</p>
                </>
              ) : (
                <div className="flex flex-col items-center py-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-[#c8a86c]/55 bg-white text-primary-700 shadow-xs">
                    <QrCodeIcon className="h-9 w-9" aria-hidden="true" />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-neutral-800">点击右侧生成本机构专属小程序码</p>
                  <p className="mt-1 text-[11px] text-neutral-500">生成后可下载高清图片用于展板、官网及宣传册</p>
                </div>
              )}
            </div>

            {/* 右栏：公文式结构化配置表 + 操作区 */}
            <div className="flex flex-col justify-between lg:col-span-8">
              <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200/85 bg-white text-xs shadow-[0_1px_2px_rgba(12,38,32,0.03)]">
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="shrink-0 text-neutral-500">适用发放场景</span>
                  <span className="text-right font-medium text-neutral-800">就业大厅展板 · 官网入口 · 微信公众号菜单 · 宣讲材料</span>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="shrink-0 text-neutral-500">公众号菜单路径</span>
                  <code className="truncate rounded-md bg-primary-50 px-2.5 py-0.5 font-mono text-[11px] text-primary-800">
                    {info.miniappPath}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="shrink-0 text-neutral-500">扫码场景参数</span>
                  <code className="rounded-md bg-neutral-100 px-2.5 py-0.5 font-mono text-[11px] text-neutral-700">
                    {info.sceneValid ? info.miniappScene : '当前机构编号超长，请联系管理员'}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="shrink-0 text-neutral-500">本机构终端状态</span>
                  <span className="font-semibold text-primary-700">
                    在线 {info.onlineTerminalCount} 台 / 共 {info.totalTerminalCount} 台
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#c8a86c]/25 bg-[#faf7ef] px-3.5 py-2.5 text-xs text-neutral-700">
                <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9c7838]" aria-hidden="true" />
                <span>{env.hint}</span>
              </div>

              {!info.miniappCodeAvailable && (
                <div className="mt-2.5 rounded-lg border border-warning/30 bg-warning-bg px-3.5 py-2.5 text-xs text-warning-fg" role="status">
                  平台当前尚未配置微信小程序生成凭据，暂不可直接生成二维码图片；您仍可先复制上方「公众号菜单路径」用于菜单与网页配置。
                </div>
              )}

              {actionNotice && (
                <div
                  className={
                    actionNotice.tone === 'success'
                      ? 'mt-2.5 flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3.5 py-2.5 text-xs text-success-fg'
                      : 'mt-2.5 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3.5 py-2.5 text-xs text-error-fg'
                  }
                  role="status"
                >
                  {actionNotice.tone === 'success' ? (
                    <CheckCircle2Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>{actionNotice.text}</span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <Button
                  size="sm"
                  onClick={() => void handleGenerate()}
                  disabled={!canGenerate || generating}
                >
                  <RefreshCwIcon className={`mr-1.5 h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} aria-hidden="true" />
                  {generating ? '生成中…' : codeResult ? '重新生成小程序码' : '生成专属小程序码'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  disabled={!codeResult}
                >
                  <DownloadIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  下载高清码
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleCopyPath()}>
                  <CopyIcon className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  复制公众号路径
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
