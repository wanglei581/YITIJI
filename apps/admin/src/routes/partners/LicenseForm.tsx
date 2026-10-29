import { useState, type FormEvent } from 'react'
import type { CreateLicenseInput, LicenseView, RenewLicenseInput, UpdateLicenseInput } from '@ai-job-print/shared'
import { reasonLength, validGraceDays, validQuota, validReason } from './licenseValidation'
import { validCreditChecksum } from './licensePresentation'
import { LICENSE_PERIOD_TOO_LONG_MESSAGE, maxEndsOn, nextDay } from '../../lib/licensePeriod'

type FormValues = { licenseeName: string; creditCode: string; contractNo: string; startsOn: string; endsOn: string; terminalQuota: string; graceDays: string; note: string; reason: string }
type Props = { kind: 'create' | 'edit' | 'renew'; item?: LicenseView; saving: boolean; error: string; onCancel: () => void; onSubmit: (input: CreateLicenseInput | UpdateLicenseInput | RenewLicenseInput) => void }
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day && Number(day.slice(0, 4)) >= 2000 && Number(day.slice(0, 4)) <= 2100
const inputClass = 'w-full rounded border border-neutral-300 px-2 py-1.5 text-sm'
export function LicenseForm({ kind, item, saving, error, onCancel, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>({ licenseeName: item?.licenseeName ?? '', creditCode: item?.creditCode ?? '', contractNo: kind === 'edit' ? item?.contractNo ?? '' : '', startsOn: kind === 'edit' ? item?.startsOn ?? '' : '', endsOn: kind === 'edit' ? item?.endsOn ?? '' : '', terminalQuota: String(item?.terminalQuota ?? 1), graceDays: String(item?.graceDays ?? 7), note: kind === 'edit' ? item?.note ?? '' : '', reason: '' })
  const [specified, setSpecified] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const set = (key: keyof FormValues, value: string) => setValues(v => ({ ...v, [key]: value }))
  function submit(event: FormEvent) {
    if (saving) return
    event.preventDefault()
    const e: typeof errors = {}
    if ([...values.licenseeName.trim()].length < 2 || [...values.licenseeName.trim()].length > 100) e.licenseeName = '被授权企业名称须为 2 至 100 字'
    if (!validCreditChecksum(values.creditCode)) e.creditCode = '请填写校验位正确的统一社会信用代码'
    if (!values.contractNo.trim() || values.contractNo.trim().length > 64) e.contractNo = '请填写合同编号，最多 64 字'
    const start = kind === 'renew' && !specified ? item?.endsOn ?? '' : values.startsOn
    const latestEnd = latestEndsOn
    if (!(kind === 'renew' && !specified)) {
      if (!values.startsOn) e.startsOn = '请选择生效日'
      else if (!validDay(values.startsOn)) e.startsOn = '请填写有效的生效日'
    }
    if (!values.endsOn) e.endsOn = '请选择最后有效日'
    else if (!validDay(values.endsOn)) e.endsOn = '请填写有效的最后有效日'
    else if (kind === 'renew' && !specified && values.endsOn <= start) e.endsOn = `最后有效日要晚于原授权的最后有效日（${start}）`
    else if (validDay(start) && values.endsOn < start) e.endsOn = '最后有效日不能早于生效日'
    else if (latestEnd && values.endsOn > latestEnd) e.endsOn = LICENSE_PERIOD_TOO_LONG_MESSAGE
    if (!validQuota(Number(values.terminalQuota)) || !values.terminalQuota.trim()) e.terminalQuota = '台数须为 1 至 10000 的整数'
    if (!validGraceDays(Number(values.graceDays)) || !values.graceDays.trim()) e.graceDays = '宽限天数须为 0 至 30 的整数'
    if (kind === 'edit' && !validReason(values.reason)) e.reason = '理由须为 2 至 200 字'
    setErrors(e)
    if (Object.keys(e).length) return
    const body = { licenseeName: values.licenseeName.trim(), creditCode: values.creditCode.trim().toUpperCase(), contractNo: values.contractNo.trim(), endsOn: values.endsOn, terminalQuota: Number(values.terminalQuota), graceDays: Number(values.graceDays), note: values.note.trim() || null }
    if (kind === 'edit' && item) onSubmit({ ...body, startsOn: values.startsOn, version: item.version, reason: values.reason.trim() })
    else if (kind === 'renew') onSubmit({ ...body, ...(specified ? { startsOn: values.startsOn } : {}) })
    else onSubmit({ ...body, startsOn: values.startsOn })
  }
  // 期限最长 10 个日历年：续期不填生效日时从原到期日的次日起算，上限按那天算
  const latestEndsOn = maxEndsOn(kind === 'renew' && !specified ? nextDay(item?.endsOn ?? '') ?? '' : values.startsOn)
  const field = (key: keyof FormValues, label: string, type = 'text', max?: string) => <label className="block text-sm">{label}<input className={inputClass} type={type} max={max} value={values[key]} onChange={e => set(key, e.target.value)} />{errors[key] && <span role="alert" className="block text-red-700">{errors[key]}</span>}</label>
  return <form onSubmit={submit} noValidate className="space-y-3 rounded border p-3" aria-label={kind === 'create' ? '新建授权' : kind === 'edit' ? '更正信息' : '续期'}>
    <h4 className="font-semibold">{kind === 'create' ? '新建授权' : kind === 'edit' ? '更正信息' : '续期'}</h4>
    {field('licenseeName', '被授权企业名称')}{field('creditCode', '统一社会信用代码')}{field('contractNo', '合同编号')}
    {kind === 'renew' && <label className="block text-sm"><input type="checkbox" checked={specified} onChange={e => setSpecified(e.target.checked)} /> 指定生效日</label>}
    {kind === 'renew' && !specified ? <p className="text-sm">从原最后有效日的次日起接续</p> : field('startsOn', '生效日', 'date')}
    {field('endsOn', '最后有效日（含当天）', 'date', latestEndsOn ?? undefined)}{field('terminalQuota', '终端台数', 'number')}{field('graceDays', '宽限天数', 'number')}{field('note', '备注')}
    {kind === 'edit' && <>{field('reason', '更正理由')}<p className="text-xs">{reasonLength(values.reason)} / 200 字</p></>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-2"><button className="min-h-11 rounded bg-primary-600 px-3 py-2 text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? '提交中…' : '提交'}</button><button type="button" className="min-h-11 rounded border px-3 py-2" disabled={saving} onClick={onCancel}>取消</button></div>
  </form>
}
