import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BuildingIcon, ClockIcon, FileTextIcon, MapPinIcon, SearchIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import {
  DirAiAssist,
  DirNote,
  DirSec,
  DirState,
  DirStrip,
  DirStripItem,
  OFFLINE_PREP_ITEMS,
} from '../../components/qingxu/directory/DirectoryBits'
import '../../components/qingxu/directory/directory-qx.css'
import { getTerminalCode } from '../../services/api/terminalConfig'
import {
  getOfflineAgencies,
  type OfflineAgencyDTO,
  type OfflineAgencyListResult,
} from '../../services/api/offlineAgencies'
const PAGE_SIZE = 10
const DISTRICT_SAMPLE_SIZE = 100

function agencyStatusBadge(status: string): { label: string; className: 'open' | 'rest' } {
  if (status === 'open') return { label: '已发布', className: 'open' }
  if (status === 'rest') return { label: '暂停收录', className: 'rest' }
  return { label: '收录状态未知', className: 'rest' }
}
const ORG_TYPE_OPTIONS = [
  { value: '', text: '全部类型' },
  { value: 'recruitment', text: '招聘服务机构' },
  { value: 'public_employment_service', text: '公共就业服务机构' },
  { value: 'licensed_hr_agency', text: '持证人力资源机构' },
] as const

const BOUNDARY = '本机只做机构信息展示、门店指引和材料打印：不代收简历、不代投递，也不记录你到店后的结果。'

function AgencyRow({ agency, onClick }: { agency: OfflineAgencyDTO; onClick: () => void }) {
  const services = Array.isArray(agency.services) ? agency.services : []
  const badge = agencyStatusBadge(agency.status)
  return (
    <article className="dw-row" aria-label={agency.name} data-agency-status={badge.className} onClick={onClick} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <span className="dw-row-ic" aria-hidden="true"><BuildingIcon size={32} /></span>
      <div className="dw-row-main">
        <div className="dw-row-t">{agency.name}</div>
        <div className="dw-row-sub">
          <span><MapPinIcon size={20} aria-hidden="true" />{agency.address}</span>
          <span><ClockIcon size={20} aria-hidden="true" />{agency.hours || '服务时间以机构公示为准'}</span>
        </div>
        <div className="dw-row-chips">
          {services.map((svc) => <span key={svc} className="dw-chip">{svc}</span>)}
          {agency.district ? <span className="dw-chip">{agency.district}</span> : null}
          {agency.orgCode ? <span className="dw-chip">来源编号 {agency.orgCode}</span> : null}
        </div>
      </div>
      <span className="dw-row-go" aria-hidden="true">›</span>
    </article>
  )
}

export function OfflineAgenciesPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OfflineAgencyListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [district, setDistrict] = useState<string | undefined>(undefined)
  const [districts, setDistricts] = useState<string[]>([])
  const [service, setService] = useState('')
  const [orgType, setOrgType] = useState('')
  const [page, setPage] = useState(1)
  const [retryKey, setRetryKey] = useState(0)
  const skipFilterEcho = useRef(true)
  const filtered = Boolean(keyword || district || service || orgType)
  const uiState = loading ? 'list-loading' : error ? 'list-error' : data && data.items.length === 0 ? 'list-empty' : filtered ? 'list-filtered' : 'list-ready'
  const pill = loading
    ? { tone: 'unknown' as const, label: '正在读取机构名单' }
    : error
      ? { tone: 'bad' as const, label: '机构名单读取失败' }
      : data && data.items.length === 0
        ? { tone: 'warn' as const, label: '当前条件没有匹配机构' }
        : { tone: 'ok' as const, label: filtered ? '已按检索方式重新取名单' : '已发布机构名单' }

  useEffect(() => {
    let cancelled = false
    getOfflineAgencies({ keyword: keyword || undefined, page: 1, pageSize: DISTRICT_SAMPLE_SIZE })
      .then((res) => {
        if (cancelled) return
        const unique = [...new Set(res.items.map((item) => item.district?.trim()).filter((value): value is string => Boolean(value)))]
          .sort((a, b) => a.localeCompare(b, 'zh-CN'))
        setDistricts(unique)
      })
      .catch(() => { if (!cancelled) setDistricts([]) })
    return () => { cancelled = true }
  }, [keyword, retryKey])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getOfflineAgencies({
      keyword: keyword || undefined,
      district: district || undefined,
      service: service || undefined,
      orgType: orgType || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return
        setData(res)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('机构列表暂时无法加载，请稍后重试')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [keyword, district, page, retryKey])

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextKeyword = searchInput.trim()
    setPage(1)
    if (nextKeyword === keyword) {
      setRetryKey((value) => value + 1)
      return
    }
    setKeyword(nextKeyword)
  }

  const clearSearch = () => {
    setSearchInput('')
    setKeyword('')
    setDistrict(undefined)
    setService('')
    setOrgType('')
    setPage(1)
  }

  const selectDistrict = (next: string | undefined) => {
    setPage(1)
    setDistrict(next)
  }

  useEffect(() => {
    if (skipFilterEcho.current) {
      skipFilterEcho.current = false
      return
    }
    setPage(1)
    setRetryKey((value) => value + 1)
  }, [service, orgType])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 0
  const exception = uiState === 'list-loading' || uiState === 'list-empty' || uiState === 'list-error'

  return (
    <QxPageFrame
      title="线下招聘机构"
      subtitle={
        uiState === 'list-loading' ? '正在读取名单，取到之前不显示机构名称或数量。'
          : uiState === 'list-empty' ? '这些条件没有匹配的门店，换个条件再试。'
            : uiState === 'list-error' ? '名单没取到，不会拿示例机构顶替真实结果。'
              : '先缩小范围，再看已发布的机构名单。'
      }
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      ctabar={
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/jobs-service')}>返回岗位服务</button>
          <button type="submit" form="offline-agency-search" className="qx-btn" data-variant="primary">查询机构目录</button>
        </>
      }
      navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
    >
      <div className="dw-page qx-grow" data-screen="offline-agency" data-state={uiState} data-testid={`offline-agency-state-${uiState}`}>
        <DirSec no="01" title="先缩小范围" hint="四项均为真实接口参数，可单选也可组合">
          <form id="offline-agency-search" className="dw-qbar" role="search" onSubmit={handleSearch}>
            <span className="qi"><SearchIcon size={26} aria-hidden /></span>
            <input
              className="dw-qinput"
              type="search"
              aria-label="搜索机构名称"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="输入机构名称、地址或说明关键词"
            />
            {keyword ? <button type="button" className="dw-chip" onClick={clearSearch}>清除搜索</button> : null}
            <button type="submit" className="dw-qbtn">搜索</button>
          </form>
          <div className="dw-filter">
            {districts.length > 0 ? (
              <div className="dw-fgrp">
                <span className="fl">区域</span>
                <span className="fc">
                  <button type="button" className={`dw-chip min-h-12 ${district ? '' : 'on'}`} aria-pressed={!district} onClick={() => selectDistrict(undefined)}>全部</button>
                  {districts.map((name) => (
                    <button type="button" key={name} className={`dw-chip min-h-12 ${district === name ? 'on' : ''}`} aria-pressed={district === name} onClick={() => selectDistrict(name)}>{name}</button>
                  ))}
                </span>
              </div>
            ) : null}
            <div className="dw-filter-fields dw-filter-fields-follow">
              <label className="dw-filter-input">
                <span>服务项目</span>
                <input value={service} onChange={(event) => { setService(event.target.value); setPage(1) }} placeholder="输入来源机构发布的服务项目" />
              </label>
              <label className="dw-filter-input">
                <span>机构类型</span>
                <select value={orgType} onChange={(event) => { setOrgType(event.target.value); setPage(1) }} aria-label="机构类型">
                  {ORG_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.text}</option>)}
                </select>
              </label>
            </div>
            <div className="dw-filter-actions">
              <span className="dw-filter-note">区县、服务项目和机构类型是接口支持的精确条件；输入不存在的值时显示真实空态。</span>
              <button type="button" className="dw-chip" onClick={clearSearch}>清除全部</button>
            </div>
          </div>
        </DirSec>

        <DirSec no="02" title="机构名单" hint="每页 10 条" grow>
          <div className="dw-rbox">
            {loading ? (
              <>
                <DirState tone="info" testId="offline-agency-result-loading" title="正在读取已发布机构名单">
                  取到名单之前，这里不显示任何机构名称、数量或收录状态。名单来自来源机构同步并经管理员审核发布。
                </DirState>
              </>
            ) : error ? (
              <>
                <DirState tone="error" testId="offline-agency-result-error" title="机构名单没取到">
                  这次请求失败了。本机不会用示例机构顶替真实结果，所以目录先空着。可以重试；重试仍失败时，请到前台找工作人员。
                </DirState>
                <div className="dw-filter-actions">
                  <button type="button" className="dw-chip" onClick={() => setRetryKey((k) => k + 1)}>重试</button>
                  <button type="button" className="dw-chip" onClick={() => navigate('/help')}>联系工作人员</button>
                </div>
              </>
            ) : !data ? null : data.items.length === 0 ? (
              <>
                <DirState tone="empty" testId="offline-agency-result-empty" title="当前条件没有匹配的机构">
                  换个关键词或检索方式再试一次。机构信息需要管理员审核发布后才会出现在目录里。也可以到前台，让工作人员按纸质名单帮你找。
                </DirState>
                <div className="dw-filter-actions">
                  <button type="button" className="dw-chip" onClick={clearSearch}>清除条件重新查询</button>
                  <button type="button" className="dw-chip" onClick={() => navigate('/help')}>联系工作人员</button>
                </div>
              </>
            ) : (
              <>
                <div className="dw-rhead">
                  <span className="rn">已发布机构</span>
                  <span>共 {data.total} 条 · 每页 10 条</span>
                  <span className="rsp">{filtered ? '已应用检索条件' : '本机只做门店指引，不代收简历'}</span>
                </div>
                <div className="dw-rlist">
                  {data.items.map((agency) => (
                    <AgencyRow key={agency.id} agency={agency} onClick={() => navigate(`/offline-agencies/${agency.id}`)} />
                  ))}
                </div>
              </>
            )}
            {!loading && !error && data && totalPages > 1 ? (
              <div className="dw-pager">
                <button type="button" className="dw-pbtn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
                <button type="button" className="dw-pbtn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
                <span className="pinfo">第 {page} 页 / 共 {totalPages} 页</span>
              </div>
            ) : null}
          </div>
        </DirSec>

        <DirSec no="03" title="到店前，可以先在本机做">
          <DirStrip>
            {OFFLINE_PREP_ITEMS.map((item) => (
              <DirStripItem key={item.to} icon={item.icon} title={item.title} desc={item.desc} onClick={() => navigate(item.to)} />
            ))}
            <DirStripItem icon={FileTextIcon} tone="wheat" title="简历先过一遍" desc="上传或扫描后做一次诊断" onClick={() => navigate('/resume/source')} />
          </DirStrip>
          {exception ? <DirNote>{BOUNDARY}</DirNote> : (
            <DirAiAssist screen="offline-agency" onProfile={() => navigate('/profile')} onAssistant={() => navigate('/assistant')} />
          )}
        </DirSec>
      </div>
    </QxPageFrame>
  )
}

export default OfflineAgenciesPage
