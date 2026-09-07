import { useEffect, useMemo, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import type { FairCompanyDTO } from '@ai-job-print/shared'
import { BuildingIcon, ExternalLinkIcon, MapPinIcon, PrinterIcon, QrCodeIcon } from 'lucide-react'
import { getFairCompanyById, prepareFairCompanyPrint } from '../../services/api'
import { API_MODE } from '../../services/api/client'
import { recordExternalJump } from '../../services/api/activity'
import { SOURCE_APPLY_UNAVAILABLE_REASON } from '../../lib/capabilityReasons'
import { isValidSourceUrl } from '../../lib/url'
import { useAuth } from '../../auth/useAuth'
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
  DirSteps,
  DirStrip,
  DirStripItem,
  DirTiles,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import {
  ActionBar,
  FilterBar,
  PositionListView,
  PositionPosterView,
  type Filters,
  type ViewMode,
} from './components/FairCompanyDetailSections'
import { getTerminalCode } from '../../services/api/terminalConfig'

const BOUNDARY = '本机不接收简历、不代投递：投递扫码去来源平台，或现场到展位当面咨询。'
const PRINT_NOTE = '打印企业资料与岗位清单需要后台支持；演示模式未接入后端时入口会置灰并写明原因。'

function formatSize(bytes: number): string {
  const kb = Math.max(1, Math.round(bytes / 1024))
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

export function FairCompanyDetailPage() {
  const navigate = useNavigate()
  const { id, companyId } = useParams<{ id: string; companyId: string }>()
  const location = useLocation()
  const { getToken } = useAuth()
  const fairId = id ?? ''
  const stateCompany = (location.state as { company?: FairCompanyDTO } | null)?.company
  const hasStateMatch = stateCompany?.id === companyId

  const [company, setCompany] = useState<FairCompanyDTO | null>(hasStateMatch ? stateCompany! : null)
  const [loading, setLoading] = useState(!hasStateMatch)
  const [error, setError] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [printing, setPrinting] = useState<'profile' | 'positions' | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({
    location: '不限', education: '不限', experience: '不限', positionType: '不限',
  })

  useEffect(() => {
    if (hasStateMatch) return
    let cancelled = false
    getFairCompanyById(fairId, companyId!)
      .then((res) => {
        if (cancelled) return
        if (res.data) setCompany(res.data)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId, companyId, hasStateMatch])

  const filteredPositions = useMemo(() => {
    if (!company) return []
    return company.positions.filter((pos) => {
      const okLocation = filters.location === '不限' || pos.location === filters.location
      const okEducation = filters.education === '不限' || !pos.education || pos.education === filters.education
      const okExperience = filters.experience === '不限' || !pos.experience || pos.experience === filters.experience
      const okType = filters.positionType === '不限' || pos.positionType === filters.positionType
      return okLocation && okEducation && okExperience && okType
    })
  }, [company, filters])

  const handleFilter = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }))
  const printBackendReady = API_MODE === 'http'
  const sourceOk = Boolean(company && isValidSourceUrl(company.sourceUrl))
  const positionsEmpty = Boolean(company && company.positions.length === 0)
  const uiState = loading ? 'loading' : error || !company ? 'error' : showQr ? 'qr' : !sourceOk ? 'source-incomplete' : positionsEmpty ? 'positions-empty' : 'ready'
  const notFound = !loading && (error || !company)

  const runPrint = async (variant: 'profile' | 'positions') => {
    if (!company || printing) return
    setPrinting(variant)
    setPrintError(null)
    try {
      const printable = await prepareFairCompanyPrint(fairId, company.id, variant)
      if (!printable.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/preview', {
        state: {
          file: {
            name: printable.filename,
            size: formatSize(printable.sizeBytes),
            pages: printable.pageCount > 0 ? printable.pageCount : null,
            fileId: printable.fileId,
            fileUrl: printable.printFileUrl,
            mimeType: printable.mimeType,
          },
        },
      })
    } catch (err) {
      setPrintError(userMessageOf(err, '打印文件准备失败，请稍后重试'))
    } finally {
      setPrinting(null)
    }
  }

  const openApplyQr = () => {
    if (!company || !isValidSourceUrl(company.sourceUrl)) return
    recordExternalJump(getToken(), 'fair_company', company.id, 'external_apply')
    setShowQr(true)
  }

  const listPath = `/job-fairs/${fairId}/companies`
  const pill = uiState === 'loading' ? { tone: 'unknown' as const, label: '正在读取参展企业资料' }
    : uiState === 'error' ? { tone: 'bad' as const, label: '参展企业资料读取失败' }
      : uiState === 'qr' ? { tone: 'ok' as const, label: '扫码后在来源平台完成投递' }
        : uiState === 'source-incomplete' ? { tone: 'bad' as const, label: '来源投递链接不可用 · 已置灰' }
          : uiState === 'positions-empty' ? { tone: 'warn' as const, label: '该企业未返回岗位清单' }
            : { tone: 'ok' as const, label: '展位与岗位以主办方名单为准' }

  return (
    <QxPageFrame
      title="招聘会参展企业"
      subtitle={
        uiState === 'loading' ? '正在读取展位与岗位，取到之前不显示数字。'
          : uiState === 'qr' ? '扫码去来源平台投递，简历不经过这台机器。'
            : uiState === 'source-incomplete' ? '来源投递链接不可用，两个投递按钮都已置灰。'
              : uiState === 'positions-empty' ? '名单里有这家企业，但岗位清单是空的。'
                : notFound ? '本场名单里没有这家企业，回列表重新选。'
                  : '先看展位和现场岗位，再安排逛展路线。'
      }
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        uiState === 'loading' || notFound ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate(listPath)}>返回参展企业列表</button>
        ) : uiState === 'qr' ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => setShowQr(false)}>关闭二维码</button>
        ) : uiState === 'source-incomplete' ? (
          <>
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              aria-disabled={!sourceOk || undefined}
              aria-describedby="fair-company-bar-blocked"
              onClick={() => { if (!sourceOk) return }}
            >
              <QrCodeIcon aria-hidden size={22} />扫码投递
            </button>
            <span id="fair-company-bar-blocked" className="why">{SOURCE_APPLY_UNAVAILABLE_REASON}</span>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              aria-disabled={!sourceOk || undefined}
              aria-describedby="fair-company-bar-blocked"
              onClick={() => { if (!sourceOk) return }}
            >
              <ExternalLinkIcon aria-hidden size={22} />去来源平台投递
            </button>
          </>
        ) : (
          <>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(listPath)}>返回列表</button>
            <button type="button" className="qx-btn" data-variant="primary" onClick={openApplyQr}>
              <ExternalLinkIcon aria-hidden size={22} />去来源平台投递
            </button>
          </>
        )
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-state={uiState} data-testid={`fair-company-state-${uiState}`}>
        {loading ? (
          <>
            <DirState tone="info" testId="fair-company-loading" title="正在读取该企业的展位与岗位">
              展位号、行业、岗位数量都等主办方名单返回；取到之前不显示任何数字。
            </DirState>
            <DirStrip>
              <DirStripItem icon={BuildingIcon} tone="wheat" title="回参展企业列表" desc="换一家企业或按展区找" onClick={() => navigate(listPath)} />
              <DirStripItem icon={PrinterIcon} title="先打好自备简历" desc="现场投纸质简历常用" onClick={() => navigate('/print/upload')} />
            </DirStrip>
            <DirNote>{BOUNDARY}</DirNote>
          </>
        ) : notFound ? (
          <>
            <DirState tone="error" testId="fair-company-company-error" title="参展企业资料没读到">
              本场名单还在，但这家企业的资料这次没取回来。不会用上一次的缓存冒充当前结果。现场以主办方公布的展位图和名单为准。
            </DirState>
            <DirExitList>
              <DirStripItem icon={BuildingIcon} tone="wheat" title="参展企业列表" desc="回本场名单重新选一家" onClick={() => navigate(listPath)} />
              <DirStripItem icon={MapPinIcon} title="展位图" desc="主办方给了真实图才展示" onClick={() => navigate(`/job-fairs/${fairId}/map`)} />
              <DirStripItem icon={PrinterIcon} title="先打好纸质简历" desc="展位现场收纸质简历很常见" onClick={() => navigate('/print/upload')} />
              <DirStripItem icon={BuildingIcon} tone="slate" title="现场工作人员" desc="手上有主办方纸质名单" onClick={() => navigate('/help')} />
            </DirExitList>
            <DirNote>{BOUNDARY}</DirNote>
          </>
        ) : showQr && company && company.sourceUrl ? (
          <>
            <DirQrHero
              title="用手机扫码，在来源平台完成投递"
              address={<b>{company.sourceUrl}</b>}
              url={company.sourceUrl}
              steps={[
                '手机扫码打开来源平台的岗位页。',
                '在来源平台登录并投递，简历不经过这台机器。',
                '面试与结果由来源平台和企业通知你。',
              ]}
              reason="二维码按服务端返回的来源链接生成。本机不接收简历、不代投递，也拿不到你的投递结果；离开前请关掉二维码，不把账号留在公共终端。"
            />
            <DirStrip>
              <DirStripItem icon={BuildingIcon} tone="wheat" title="回企业详情看展位" desc="展位号与岗位清单都在详情页" onClick={() => setShowQr(false)} />
              <DirStripItem icon={PrinterIcon} title="打一份纸质简历带过去" desc="展位现场收纸质简历很常见" onClick={() => navigate('/print/upload')} />
            </DirStrip>
          </>
        ) : company ? (
          <>
            <DirSec no="01" title="参展企业" hint="展位与岗位以主办方名单为准">
              <div className="dw-blk">
                <div className="dw-row-t">
                  {company.companyName}
                  {sourceOk ? null : <span className="dw-tag wheat">来源要素不足</span>}
                </div>
                <DirTiles items={[
                  { label: '展位号', value: company.boothNumber || '来源未提供', accent: true },
                  { label: '现场岗位', value: company.positions.length },
                  { label: '所属行业', value: company.industry || '来源未提供' },
                  { label: '来源链接', value: sourceOk ? '已提供' : '未返回' },
                ]} />
                <DirKv rows={[
                  ['来源机构', '主办方名单'],
                  ['外部投递链接', sourceOk ? company.sourceUrl : '来源平台未提供'],
                  ['数据来源说明', company.applyNote],
                ]} />
                {company.zoneName ? <p className="dw-row-sub"><MapPinIcon size={18} aria-hidden />{company.zoneName}</p> : null}
              </div>
            </DirSec>

            <DirSec no="02" title="现场岗位" hint={positionsEmpty ? '名单里有企业，岗位清单为空' : '真实清单由主办方提供'} grow>
              {positionsEmpty ? (
                <div className="dw-rbox">
                  <DirState tone="empty" testId="fair-company-positions-empty" title="这家企业没有返回岗位清单">
                    名单里有这家企业，但岗位清单是空的。本机不替它编现场岗位。到展位当面问，是这种情况下最靠谱的一条路。
                  </DirState>
                  <DirSteps items={['到展位看现场岗位牌。', '询问岗位要求、到岗时间和联系方式。', '不把现场口头信息写成平台已发布岗位。']} />
                </div>
              ) : (
                <div className="dw-rbox">
                  <div className="dw-rhead">
                    <span className="rn">现场岗位</span>
                    <span>共 {filteredPositions.length} / {company.positions.length} 条</span>
                    <span className="rsp">{BOUNDARY}</span>
                  </div>
                  <FilterBar positions={company.positions} filters={filters} viewMode={viewMode} onFilter={handleFilter} onViewMode={setViewMode} />
                  {viewMode === 'list'
                    ? <PositionListView positions={filteredPositions} companyName={company.companyName} />
                    : <PositionPosterView positions={filteredPositions} companyName={company.companyName} industry={company.industry} />}
                </div>
              )}
            </DirSec>

            {printError ? <DirState tone="error" testId="fair-company-print-error" title={printError}>打印文件必须由后端返回真实链接，本机不伪造页数。</DirState> : null}

            <ActionBar
              sourceCanApply={sourceOk}
              onScanQr={openApplyQr}
              onOpenSource={openApplyQr}
              onPrintProfile={() => { void runPrint('profile') }}
              onPrintPositions={() => { void runPrint('positions') }}
              printing={printing}
              canPrintProfile={printBackendReady}
              canPrintPositions={printBackendReady && company.positions.length > 0}
              printDisabledHint={
                !printBackendReady
                  ? '演示模式未接入后端，无法生成真实企业资料文件'
                  : '该企业暂无可打印的岗位信息'
              }
            />

            {positionsEmpty ? <DirNote>{BOUNDARY}</DirNote> : (
              <DirAiAssist screen="fair-company" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
            )}
            <DirNote warn>
              {PRINT_NOTE}
              <button type="button" className="dw-chip" onClick={() => navigate('/help')}>联系工作人员</button>
            </DirNote>
          </>
        ) : null}
      </div>
    </QxPageFrame>
  )
}
