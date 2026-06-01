import { useRef, useState } from 'react'
import { Button } from '@ai-job-print/ui'
import {
  CheckCircleIcon,
  ChevronRightIcon,
  FileSpreadsheetIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { parseExcel, previewExcel, confirmExcelImport, cancelExcelImport } from '../../services/api'
import type { ExcelPreviewResult } from '../../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  sourceId: string
  sourceName: string
  onClose: () => void
  onImported: (count: number) => void
}

type Step = 'upload' | 'mapping' | 'preview' | 'done'

// Required fields for job and fair imports
const JOB_FIELDS = [
  { key: 'externalId', label: '外部ID',   required: true  },
  { key: 'title',      label: '职位名称', required: true  },
  { key: 'company',    label: '公司名称', required: true  },
  { key: 'city',       label: '工作城市', required: true  },
  { key: 'sourceUrl',  label: '来源链接', required: true  },
  { key: 'salary',     label: '薪资范围', required: false },
  { key: 'description', label: '职位描述', required: false },
  { key: 'requirements', label: '任职要求', required: false },
  { key: 'industry',   label: '行业',     required: false },
  { key: 'workType',   label: '工作类型', required: false },
] as const

const FAIR_FIELDS = [
  { key: 'externalId', label: '外部ID',   required: true  },
  { key: 'title',      label: '活动名称', required: true  },
  { key: 'startAt',    label: '开始时间', required: true  },
  { key: 'endAt',      label: '结束时间', required: true  },
  { key: 'venue',      label: '举办场馆', required: true  },
  { key: 'city',       label: '城市',     required: true  },
  { key: 'sourceUrl',  label: '来源链接', required: true  },
  { key: 'theme',      label: '主题',     required: false },
  { key: 'address',    label: '详细地址', required: false },
  { key: 'description', label: '活动介绍', required: false },
  { key: 'companyCount', label: '参展企业数', required: false },
  { key: 'jobCount',   label: '岗位数',   required: false },
] as const

type FieldDef = typeof JOB_FIELDS[number] | typeof FAIR_FIELDS[number]

// ─── Step indicators ─────────────────────────────────────────────────────────

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload',  label: '上传文件' },
  { id: 'mapping', label: '字段映射' },
  { id: 'preview', label: '预览确认' },
  { id: 'done',    label: '导入完成' },
]

function StepBar({ current }: { current: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current)
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const done    = i < currentIdx
        const active  = i === currentIdx
        return (
          <div key={s.id} className="flex items-center">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold
              ${done   ? 'bg-green-500 text-white' :
                active ? 'bg-primary-600 text-white' :
                         'bg-gray-200 text-gray-500'}`}>
              {done ? <CheckCircleIcon className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`ml-1.5 text-xs font-medium ${active ? 'text-gray-900' : 'text-gray-400'}`}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRightIcon className="mx-2 h-4 w-4 text-gray-300" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExcelImportModal({ sourceId, sourceName, onClose, onImported }: Props) {
  const [step, setStep]         = useState<Step>('upload')
  const [dataType, setDataType] = useState<'job' | 'fair'>('job')
  const [file, setFile]         = useState<File | null>(null)
  const [columns, setColumns]   = useState<string[]>([])
  const [mapping, setMapping]   = useState<Record<string, string>>({})
  const [preview, setPreview]   = useState<ExcelPreviewResult | null>(null)
  const [importedCount, setImportedCount] = useState(0)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const fields: readonly FieldDef[] = dataType === 'job' ? JOB_FIELDS : FAIR_FIELDS

  // Step 1 → 2: upload and parse columns
  const handleUpload = async () => {
    if (!file) { setError('请选择 Excel 文件'); return }
    setLoading(true); setError('')
    try {
      const result = await parseExcel(file)
      setColumns(result.columns)
      // Auto-detect mapping by fuzzy match
      const auto: Record<string, string> = {}
      for (const f of fields) {
        const matched = result.columns.find(
          (col) => col.includes(f.label) || f.label.includes(col) || col.toLowerCase().includes(f.key.toLowerCase()),
        )
        if (matched) auto[f.key] = matched
      }
      setMapping(auto)
      setStep('mapping')
    } catch {
      setError('文件解析失败，请确认是有效的 Excel (.xlsx) 文件')
    } finally {
      setLoading(false)
    }
  }

  // Step 2 → 3: send mapping, get preview
  const handlePreview = async () => {
    const missingRequired = fields.filter((f) => f.required && !mapping[f.key])
    if (missingRequired.length > 0) {
      setError(`以下必填字段尚未映射: ${missingRequired.map((f) => f.label).join('、')}`)
      return
    }
    setLoading(true); setError('')
    try {
      const result = await previewExcel(file!, sourceId, dataType, mapping)
      setPreview(result)
      setStep('preview')
    } catch (e) {
      setError((e as Error).message || '预览生成失败，请检查字段映射后重试')
    } finally {
      setLoading(false)
    }
  }

  // Step 3 → 4: confirm import
  const handleConfirm = async () => {
    if (!preview) return
    setLoading(true); setError('')
    try {
      const result = await confirmExcelImport(preview.batchId)
      setImportedCount(result.imported)
      onImported(result.imported)
      setStep('done')
    } catch (e) {
      setError((e as Error).message || '确认导入失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (preview?.batchId && step === 'preview') {
      await cancelExcelImport(preview.batchId).catch(() => null)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Excel 导入</h2>
            <p className="mt-0.5 text-xs text-gray-500">数据源：{sourceName}</p>
          </div>
          <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Step bar */}
        <div className="border-b border-gray-100 px-6 py-3">
          <StepBar current={step} />
        </div>

        {/* Content */}
        <div className="min-h-[280px] px-6 py-5">
          {/* ── Step 1: upload ── */}
          {step === 'upload' && (
            <div className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">数据类型</label>
                <div className="flex gap-3">
                  {(['job', 'fair'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDataType(t)}
                      className={`rounded-lg border px-5 py-2 text-sm font-medium transition ${
                        dataType === t ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {t === 'job' ? '岗位数据' : '招聘会数据'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">选择 Excel 文件</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) { setFile(f); setError('') }
                  }}
                />
                <div
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 hover:border-primary-300 hover:bg-primary-50/30"
                  onClick={() => fileRef.current?.click()}
                >
                  {file ? (
                    <>
                      <FileSpreadsheetIcon className="h-10 w-10 text-green-500" />
                      <p className="mt-2 font-medium text-gray-800">{file.name}</p>
                      <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB · 点击更换</p>
                    </>
                  ) : (
                    <>
                      <UploadIcon className="h-10 w-10 text-gray-300" />
                      <p className="mt-2 text-sm text-gray-500">点击选择或拖入 Excel 文件（.xlsx / .xls / .csv）</p>
                      <p className="mt-1 text-xs text-gray-400">第一行为表头，数据从第二行开始</p>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                只接受岗位/招聘会展示字段，导入后默认"待审核 + 草稿"，由管理员审核发布后才展示。
              </div>
            </div>
          )}

          {/* ── Step 2: mapping ── */}
          {step === 'mapping' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                检测到 {columns.length} 列。请将 Excel 列名映射到标准字段。
              </p>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">标准字段</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">对应 Excel 列</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {fields.map((f) => (
                      <tr key={f.key} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-800">{f.label}</span>
                          {f.required && <span className="ml-1 text-red-500">*</span>}
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={mapping[f.key] ?? ''}
                            onChange={(e) => setMapping((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs focus:border-primary-400 focus:outline-none"
                          >
                            <option value="">— 不映射 —</option>
                            {columns.map((col) => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Step 3: preview ── */}
          {step === 'preview' && preview && (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '有效行', count: preview.validRows,   color: 'text-green-600 bg-green-50 border-green-100' },
                  { label: '无效行', count: preview.invalidRows, color: 'text-red-600 bg-red-50 border-red-100' },
                  { label: '重复行', count: preview.dupRows,     color: 'text-amber-600 bg-amber-50 border-amber-100' },
                ].map((s) => (
                  <div key={s.label} className={`rounded-xl border p-4 text-center ${s.color}`}>
                    <div className="text-2xl font-bold">{s.count}</div>
                    <div className="mt-0.5 text-xs font-medium">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Sample invalid rows */}
              {preview.sampleInvalid.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <p className="mb-2 text-xs font-medium text-red-700">无效行示例（共 {preview.invalidRows} 行将被跳过）</p>
                  {preview.sampleInvalid.map((r) => (
                    <div key={r.rowIndex} className="mb-1 text-xs text-red-600">
                      第 {r.rowIndex} 行：{r.errors.join('；')}
                    </div>
                  ))}
                </div>
              )}

              {preview.dupRows > 0 && (
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {preview.dupRows} 行与已有数据重复，导入时将刷新展示字段，不覆盖审核/发布状态。
                </div>
              )}

              {preview.validRows === 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  没有可导入的有效行，请检查字段映射后重新预览。
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-8">
              <CheckCircleIcon className="h-14 w-14 text-green-500" />
              <h3 className="mt-4 text-lg font-semibold text-gray-900">导入成功</h3>
              <p className="mt-1 text-sm text-gray-500">
                已成功导入 <span className="font-bold text-green-600">{importedCount}</span> 条数据，
                默认待审核状态，请联系管理员审核发布。
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <p className="text-xs text-gray-400">
            {step === 'preview' && preview ? `共 ${preview.totalRows} 行 · 将导入 ${preview.validRows} 行` : ''}
          </p>
          <div className="flex gap-3">
            {step === 'done' ? (
              <Button variant="primary" size="md" onClick={onClose}>关闭</Button>
            ) : (
              <>
                <Button variant="outline" size="md" onClick={handleCancel} disabled={loading}>
                  取消
                </Button>
                {step === 'upload'  && <Button variant="primary" size="md" onClick={handleUpload}  disabled={!file || loading}>{loading ? '解析中...' : '下一步'}</Button>}
                {step === 'mapping' && (
                  <>
                    <Button variant="outline" size="md" onClick={() => setStep('upload')}>上一步</Button>
                    <Button variant="primary" size="md" onClick={handlePreview} disabled={loading}>{loading ? '生成预览...' : '生成预览'}</Button>
                  </>
                )}
                {step === 'preview' && (
                  <>
                    <Button variant="outline" size="md" onClick={() => setStep('mapping')}>上一步</Button>
                    <Button variant="primary" size="md" onClick={handleConfirm} disabled={loading || (preview?.validRows ?? 0) === 0}>
                      {loading ? '导入中...' : `确认导入 ${preview?.validRows ?? 0} 行`}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
