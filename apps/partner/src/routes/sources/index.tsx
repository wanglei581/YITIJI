import { useEffect, useState } from 'react'
import type { FieldMappingRule, ImportBatch, ImportRecord, SourceKind } from '@ai-job-print/shared'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import type { AccessMode, PartnerDataSource, ConnStatus, SyncFreq } from '../../services/api'
import { getDataSources, toggleDataSource, createDataSource } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

// 接入方式(AccessMode):描述"用什么方式拉取数据"。
// sourceKind(数据由谁提供)留待 B1 阶段加入列与筛选。
const ACCESS_MODE_STYLE: Record<AccessMode, { label: string; style: string }> = {
  api:     { label: 'API',     style: 'bg-blue-50 text-blue-600'     },
  excel:   { label: 'Excel',   style: 'bg-green-50 text-green-600'   },
  csv:     { label: 'CSV',     style: 'bg-green-50 text-green-600'   },
  json:    { label: 'JSON',    style: 'bg-green-50 text-green-600'   },
  webhook: { label: 'Webhook', style: 'bg-purple-50 text-purple-600' },
  manual:  { label: '手动',    style: 'bg-gray-100 text-gray-600'    },
}
const CONN_MAP: Record<ConnStatus, { badge: 'success' | 'error' | 'default'; label: string }> = {
  connected: { badge: 'success', label: '已连接'  },
  error:     { badge: 'error',   label: '连接异常' },
  disabled:  { badge: 'default', label: '已停用'  },
}
const FREQ_LABELS: Record<SyncFreq, string> = { manual: '手动', hourly: '每小时', daily: '每天', weekly: '每周' }

// ─── Wizard constants ─────────────────────────────────────────────────────────

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'hr_company',     label: '人力资源公司'       },
  { value: 'school',         label: '高校就业中心'       },
  { value: 'fair_organizer', label: '招聘会主办方'       },
  { value: 'aggregator',     label: '第三方数据聚合平台' },
  { value: 'manual',         label: '手动录入'          },
]

const STANDARD_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'title',        label: '岗位标题',       required: true  },
  { key: 'company',      label: '公司名称',       required: true  },
  { key: 'city',         label: '工作城市',       required: true  },
  { key: 'externalId',   label: '外部唯一 ID',    required: true  },
  { key: 'sourceUrl',    label: '来源链接',       required: true  },
  { key: 'salary',       label: '薪资范围',       required: false },
  { key: 'description',  label: '岗位描述',       required: false },
  { key: 'requirements', label: '任职要求',       required: false },
  { key: 'tags',         label: '标签（逗号分隔）', required: false },
]

const MOCK_DETECTED_FIELDS = [
  '职位名称', '公司名称', '工作城市', '薪资范围', '岗位描述',
  '任职要求', '来源链接', '岗位编号', '技能标签', '发布日期',
]

const AUTO_SUGGEST: Record<string, string> = {
  '职位名称': 'title',
  '公司名称': 'company',
  '工作城市': 'city',
  '薪资范围': 'salary',
  '岗位描述': 'description',
  '任职要求': 'requirements',
  '来源链接': 'sourceUrl',
  '岗位编号': 'externalId',
  '技能标签': 'tags',
  '发布日期': '',
}

const MOCK_RECORDS: Omit<ImportRecord, 'batchId'>[] = [
  { id: 'r1', rowIndex: 2, rawData: { '职位名称': '前端开发工程师', '公司名称': '某科技有限公司', '工作城市': '上海', '薪资范围': '15-25K', '来源链接': 'https://ex.com/j/1', '岗位编号': 'EXT-001' }, mappedData: { title: '前端开发工程师', company: '某科技有限公司', city: '上海', salary: '15-25K', sourceUrl: 'https://ex.com/j/1', externalId: 'EXT-001' }, status: 'ok',      errors: [] },
  { id: 'r2', rowIndex: 3, rawData: { '职位名称': 'Java 后端工程师',  '公司名称': '某互联网公司',   '工作城市': '北京', '薪资范围': '20-30K', '来源链接': 'https://ex.com/j/2', '岗位编号': 'EXT-002' }, mappedData: { title: 'Java 后端工程师',  company: '某互联网公司',   city: '北京', salary: '20-30K', sourceUrl: 'https://ex.com/j/2', externalId: 'EXT-002' }, status: 'ok',      errors: [] },
  { id: 'r3', rowIndex: 4, rawData: { '职位名称': '产品经理',        '公司名称': '某电商平台',     '工作城市': '杭州', '薪资范围': '25-40K', '来源链接': 'https://ex.com/j/3', '岗位编号': 'EXT-003' }, mappedData: { title: '产品经理',        company: '某电商平台',     city: '杭州', salary: '25-40K', sourceUrl: 'https://ex.com/j/3', externalId: 'EXT-003' }, status: 'ok',      errors: [] },
  { id: 'r4', rowIndex: 5, rawData: { '职位名称': '数据分析师',       '公司名称': '某金融科技公司', '工作城市': '深圳', '薪资范围': '18-28K', '来源链接': 'https://ex.com/j/4', '岗位编号': 'EXT-004' }, mappedData: { title: '数据分析师',       company: '某金融科技公司', city: '深圳', salary: '18-28K', sourceUrl: 'https://ex.com/j/4', externalId: 'EXT-004' }, status: 'ok',      errors: [] },
  { id: 'r5', rowIndex: 6, rawData: { '职位名称': 'UI 设计师',        '公司名称': '某设计公司',     '工作城市': '广州', '薪资范围': '12-18K', '来源链接': 'https://ex.com/j/5', '岗位编号': 'EXT-005' }, mappedData: { title: 'UI 设计师',        company: '某设计公司',     city: '广州', salary: '12-18K', sourceUrl: 'https://ex.com/j/5', externalId: 'EXT-005' }, status: 'ok',      errors: [] },
  { id: 'r6', rowIndex: 7, rawData: { '职位名称': '运营专员',         '公司名称': '某营销公司',     '工作城市': '',     '薪资范围': '8-12K',  '来源链接': 'https://ex.com/j/6', '岗位编号': 'EXT-006' }, mappedData: { title: '运营专员',         company: '某营销公司',                   salary: '8-12K',  sourceUrl: 'https://ex.com/j/6', externalId: 'EXT-006' }, status: 'invalid', errors: [{ externalField: '工作城市', standardField: 'city',       value: '',       reason: '必填字段为空'         }] },
  { id: 'r7', rowIndex: 8, rawData: { '职位名称': '前端开发工程师',   '公司名称': '某已录入公司',   '工作城市': '成都', '薪资范围': '12-20K', '来源链接': 'https://ex.com/j/7', '岗位编号': 'EXT-001' }, mappedData: { title: '前端开发工程师',   company: '某已录入公司',   city: '成都', salary: '12-20K', sourceUrl: 'https://ex.com/j/7', externalId: 'EXT-001' }, status: 'dup',     errors: [{ externalField: '岗位编号',   standardField: 'externalId', value: 'EXT-001', reason: '外部 ID 已存在，将跳过' }] },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInitialMappings(): FieldMappingRule[] {
  return MOCK_DETECTED_FIELDS.map((externalField) => {
    const key = AUTO_SUGGEST[externalField] ?? ''
    const std = STANDARD_FIELDS.find((f) => f.key === key)
    return { externalField, standardField: key, required: std?.required ?? false, defaultValue: '', transform: 'trim' as const }
  })
}

function buildMockBatch(id: string, name: string): ImportBatch {
  return {
    id,
    sourceId: 'new-source',
    fileName: `${name.replace(/\s/g, '_')}_岗位数据.xlsx`,
    fileSize: 48320,
    totalRows: 7,
    validRows: 5,
    invalidRows: 1,
    dupRows: 1,
    status: 'pending',
    validationErrors: [
      { externalField: '工作城市', standardField: 'city',       rowIndex: 7, value: '',       reason: '必填字段为空'   },
      { externalField: '岗位编号', standardField: 'externalId', rowIndex: 8, value: 'EXT-001', reason: '外部 ID 已存在' },
    ],
    createdAt: '2026-05-25 10:00',
  }
}

function validateMappings(mappings: FieldMappingRule[]): string[] {
  const mappedStdFields = mappings.map((m) => m.standardField).filter(Boolean)
  const requiredKeys    = STANDARD_FIELDS.filter((f) => f.required).map((f) => f.key)
  return requiredKeys
    .filter((k) => !mappedStdFields.includes(k))
    .map((k) => {
      const f = STANDARD_FIELDS.find((s) => s.key === k)
      return `必填字段"${f?.label ?? k}"尚未映射`
    })
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ['基本信息', '上传文件', '字段映射', '导入预览']

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-6 flex items-center gap-0">
      {STEPS.map((label, i) => {
        const idx    = i + 1
        const done   = idx < current
        const active = idx === current
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                done || active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'
              }`}>
                {done ? <CheckCircleIcon className="h-4 w-4" /> : idx}
              </div>
              <span className={`text-sm ${active ? 'font-medium text-gray-900' : done ? 'text-gray-500' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-3 h-px w-10 ${i + 1 < current ? 'bg-primary-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Wizard component ─────────────────────────────────────────────────────────

interface WizardProps {
  onComplete: (sourceName: string) => void
  onCancel: () => void
}

function ExcelImportWizard({ onComplete, onCancel }: WizardProps) {
  const [step,      setStep]      = useState<1 | 2 | 3 | 4 | 5>(1)
  const [name,      setName]      = useState('')
  const [kind,      setKind]      = useState<SourceKind | ''>('')
  const [fileName,  setFileName]  = useState('')
  const [uploading, setUploading] = useState(false)
  const [mappings,  setMappings]  = useState<FieldMappingRule[]>([])
  const [mapErrors, setMapErrors] = useState<string[]>([])
  const [batch,     setBatch]     = useState<ImportBatch | null>(null)
  const [records]                  = useState<ImportRecord[]>(
    MOCK_RECORDS.map((r) => ({ ...r, batchId: 'batch-new' }))
  )

  const step1Valid = name.trim().length > 0 && kind !== ''

  const handleMockUpload = () => {
    if (uploading) return
    setUploading(true)
    setTimeout(() => {
      setFileName(`${name.replace(/\s/g, '_')}_岗位数据.xlsx`)
      setMappings(buildInitialMappings())
      setUploading(false)
      setStep(3)
    }, 900)
  }

  const updateMapping = (idx: number, field: keyof FieldMappingRule, value: string | boolean) => {
    setMappings((prev) => {
      const next = [...prev]
      const cur  = { ...next[idx] }
      if (field === 'standardField' && typeof value === 'string') {
        const std = STANDARD_FIELDS.find((f) => f.key === value)
        cur.standardField = value
        cur.required      = std?.required ?? false
      } else if (field === 'defaultValue' && typeof value === 'string') {
        cur.defaultValue = value
      } else if (field === 'transform' && typeof value === 'string') {
        cur.transform = value as FieldMappingRule['transform']
      }
      next[idx] = cur
      return next
    })
    setMapErrors([])
  }

  const handleConfirmMapping = () => {
    const errors = validateMappings(mappings)
    if (errors.length > 0) { setMapErrors(errors); return }
    setBatch(buildMockBatch('batch-new', name))
    setStep(4)
  }

  const handleSubmit = () => {
    onComplete(name)
    setStep(5)
  }

  if (step === 5) {
    return (
      <Card className="mt-6 p-8 text-center">
        <CheckCircleIcon className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">导入批次已提交</h2>
        <p className="mt-2 text-sm text-gray-500">
          数据源「{name}」已创建，导入的 {batch?.validRows ?? 5} 条岗位数据状态为
          <span className="mx-1 font-medium text-orange-500">待审核</span>，
          请等待管理员审核后发布。
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => { setStep(1); setName(''); setKind(''); setFileName(''); setMappings([]); setBatch(null) }}>
            继续导入
          </Button>
          <Button variant="primary" size="sm" onClick={onCancel}>完成</Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="mt-6 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">新增 Excel 数据源</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Basic Info ── */}
      {step === 1 && (
        <div className="max-w-lg space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">数据源名称 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：某大学 2026 届岗位数据"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">来源种类 <span className="text-red-500">*</span></label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SourceKind)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none"
            >
              <option value="">请选择来源种类</option>
              {SOURCE_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <div><span className="font-medium text-gray-700">接入方式：</span>Excel 文件导入（本阶段唯一支持方式）</div>
            <div><span className="font-medium text-gray-700">同步方式：</span>手动上传（不支持定时自动同步）</div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="primary" disabled={!step1Valid} onClick={() => setStep(2)}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Mock Upload ── */}
      {step === 2 && (
        <div className="max-w-lg space-y-5">
          <p className="text-sm text-gray-600">请上传包含岗位数据的 Excel 文件（.xlsx / .xls）。系统将自动识别列标题并建议字段映射。</p>
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-10 text-center">
            <FileSpreadsheetIcon className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {fileName
                ? <span className="font-medium text-green-600">{fileName}</span>
                : '点击下方按钮模拟上传'}
            </p>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-700">
            <span className="font-medium">当前为演示模式：</span>点击"模拟上传"后系统将自动识别 {MOCK_DETECTED_FIELDS.length} 个示例列标题并进入字段映射步骤。
          </div>
          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => setStep(1)}>上一步</Button>
            <Button size="sm" variant="primary" onClick={handleMockUpload} disabled={uploading}>
              {uploading ? '识别中…' : '模拟上传'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Field Mapping ── */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            系统从「{fileName}」识别到 <span className="font-medium text-gray-900">{mappings.length} 个列标题</span>，
            已根据名称自动建议映射关系，请确认或调整。
          </p>

          {mapErrors.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="list-inside list-disc space-y-0.5">
                {mapErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['外部字段（Excel 列名）', '映射到标准字段', '必填', '默认值', '转换规则'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mappings.map((m, i) => {
                  const isMapped   = m.standardField !== ''
                  const isRequired = STANDARD_FIELDS.find((f) => f.key === m.standardField)?.required ?? false
                  return (
                    <tr key={m.externalField} className={!isMapped ? 'bg-gray-50' : ''}>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{m.externalField}</td>
                      <td className="px-4 py-2">
                        <select
                          value={m.standardField}
                          onChange={(e) => updateMapping(i, 'standardField', e.target.value)}
                          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">— 不映射 —</option>
                          {STANDARD_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-center text-xs">
                        {isRequired
                          ? <span className="font-medium text-red-500">必填</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={m.defaultValue ?? ''}
                          onChange={(e) => updateMapping(i, 'defaultValue', e.target.value)}
                          placeholder="可选"
                          className="w-24 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={m.transform ?? 'trim'}
                          onChange={(e) => updateMapping(i, 'transform', e.target.value)}
                          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:border-primary-500 focus:outline-none"
                        >
                          <option value="trim">trim</option>
                          <option value="none">none</option>
                          <option value="lowercase">lowercase</option>
                          <option value="uppercase">uppercase</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-gray-50 px-4 py-2 text-xs text-gray-500">
            带 <span className="font-medium text-red-500">*</span> 的标准字段为必填，必须映射到某个外部字段后才能继续。
          </div>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => setStep(2)}>上一步</Button>
            <Button size="sm" variant="primary" onClick={handleConfirmMapping}>确认映射，生成预览</Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Import Preview ── */}
      {step === 4 && batch && (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '总行数',   value: batch.totalRows,   color: 'text-gray-900'   },
              { label: '有效行数', value: batch.validRows,   color: 'text-green-600'  },
              { label: '无效行数', value: batch.invalidRows, color: 'text-red-500'    },
              { label: '重复行数', value: batch.dupRows,     color: 'text-orange-500' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-gray-50 px-4 py-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="mt-0.5 text-xs text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['行号', '岗位标题', '公司', '城市', '外部 ID', '状态', '异常原因'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => {
                  const d = r.mappedData as Record<string, string>
                  const statusMap = {
                    ok:      <StatusBadge status="success" label="有效" />,
                    invalid: <StatusBadge status="error"   label="无效" />,
                    dup:     <StatusBadge status="warning" label="重复" />,
                  }
                  return (
                    <tr key={r.id} className={r.status !== 'ok' ? 'bg-red-50/30' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-2 text-xs text-gray-400">{r.rowIndex}</td>
                      <td className="px-4 py-2 text-xs text-gray-800">{d.title ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{d.company ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{d.city ?? <span className="text-red-400">（空）</span>}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-400">{d.externalId ?? '—'}</td>
                      <td className="px-4 py-2">{statusMap[r.status]}</td>
                      <td className="px-4 py-2 text-xs text-red-500">
                        {r.errors.length > 0 ? r.errors.map((e) => e.reason).join('；') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-700">
            提交后，<span className="font-medium">{batch.validRows} 条有效数据</span>将进入审核队列，状态为
            <span className="mx-1 font-medium">待审核（pending）</span>，管理员审核通过后才会对外展示。
            无效和重复数据将被跳过。
          </div>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" onClick={() => setStep(3)}>返回修改映射</Button>
            <Button size="sm" variant="primary" onClick={handleSubmit}>确认提交</Button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-0.5 border-t border-gray-100 pt-4 text-xs text-gray-400">
        <p>· 本后台仅导入岗位/招聘会的公开或授权展示信息，不接收求职者简历</p>
        <p>· 不同步候选人状态，不提供企业筛选、面试邀约、Offer 管理功能</p>
        <p>· 所有导入数据默认待审核（pending），管理员审核通过后才对外展示</p>
      </div>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const [sources,    setSources]    = useState<PartnerDataSource[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(false)
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDataSources()
      .then((data) => { if (!cancelled) setSources(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggle = (id: string) => {
    toggleDataSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handleWizardComplete = (sourceName: string) => {
    createDataSource(sourceName).then((newSource) => {
      setSources((prev) => [...prev, newSource])
      setShowWizard(false)
    })
  }

  if (loading) {
    return (
      <Page title="数据源管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="数据源管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <DatabaseIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="数据源管理"
      subtitle={`共 ${sources.length} 个数据源`}
      actions={
        !showWizard && (
          <Button
            size="sm"
            variant="primary"
            className="flex items-center gap-1.5"
            onClick={() => setShowWizard(true)}
          >
            <PlusIcon className="h-4 w-4" />
            新增 Excel 数据源
          </Button>
        )
      }
    >
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['数据源名称', '接入方式', '说明', '同步频率', '最近同步', '连接状态', '成功数', '失败数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sources.map((s) => {
                const st   = ACCESS_MODE_STYLE[s.accessMode]
                const conn = CONN_MAP[s.connStatus]
                return (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.connStatus === 'disabled' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 text-gray-400" />
                        {s.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.style}`}>{st.label}</span>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-gray-500">
                      <span className={s.connStatus === 'error' ? 'text-red-500' : ''}>{s.description}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{FREQ_LABELS[s.syncFreq]}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{s.lastSyncTime}</td>
                    <td className="px-4 py-3"><StatusBadge status={conn.badge} label={conn.label} /></td>
                    <td className="px-4 py-3 text-center font-medium text-green-600">{s.successCount}</td>
                    <td className="px-4 py-3 text-center font-medium text-red-500">{s.failCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        {s.connStatus !== 'disabled' && (
                          <button className="rounded px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50">测试连接</button>
                        )}
                        <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">字段映射</button>
                        <button
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            s.connStatus === 'disabled'
                              ? 'text-green-600 hover:bg-green-50'
                              : 'text-orange-500 hover:bg-orange-50'
                          }`}
                          onClick={() => handleToggle(s.id)}
                        >
                          {s.connStatus === 'disabled' ? '启用' : '停用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {showWizard && (
        <ExcelImportWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <p className="mt-3 text-xs text-gray-400">接入后端后实时展示数据源状态</p>
    </Page>
  )
}
