import { useEffect, useState } from 'react'
import { Drawer } from '@ai-job-print/ui'
import { Field, GhostButton, InlineError, PrimaryButton } from '../../../components/form'
import { THEME_LABELS, errMsg, inputCls, isoToLocalInput, localInputToIso } from './shared'
import { fairsAdminService, type AdminFairView, type UpdateFairInfoInput } from '../../../services/api/fairsAdmin'

export function EditFairDrawer({
  fair,
  open,
  onClose,
  onSaved,
}: {
  fair: AdminFairView
  open: boolean
  onClose: () => void
  onSaved: (updated: AdminFairView) => void
}) {
  const [form, setForm] = useState<UpdateFairInfoInput>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({
        title: fair.title,
        theme: fair.theme,
        startAt: fair.startAt,
        endAt: fair.endAt,
        venue: fair.venue,
        city: fair.city,
        address: fair.address ?? '',
        description: fair.description ?? '',
        mapImageUrl: fair.mapImageUrl ?? '',
        coverImageUrl: fair.coverImageUrl ?? '',
        latitude: fair.latitude,
        longitude: fair.longitude,
        trafficInfo: fair.trafficInfo ?? '',
        expectedAttendance: fair.expectedAttendance,
        seekerIntent: fair.seekerIntent.map((s) => ({ ...s })),
      })
      setError(null)
    }
  }, [open, fair])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // seekerIntent 空标签行在前端先过滤(后端 DTO 对每行 label 有非空校验,空行会 400)。
      const payload: UpdateFairInfoInput = {
        ...form,
        seekerIntent: (form.seekerIntent ?? [])
          .filter((s) => s.label.trim().length > 0)
          .map((s) => ({ label: s.label.trim(), percent: s.percent })),
      }
      const updated = await fairsAdminService.updateFairInfo(fair.id, payload)
      onSaved(updated)
      onClose()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const intentRows = form.seekerIntent ?? []
  const intentSum = intentRows
    .filter((s) => s.label.trim().length > 0)
    .reduce((acc, s) => acc + (Number(s.percent) || 0), 0)
  const setNum = (key: 'latitude' | 'longitude' | 'expectedAttendance', raw: string) => {
    if (raw === '') {
      setForm((f) => ({ ...f, [key]: null }))
      return
    }
    const n = Number(raw)
    if (!Number.isNaN(n)) setForm((f) => ({ ...f, [key]: n }))
  }

  return (
    <Drawer open={open} onClose={onClose} title="编辑招聘会基本信息" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={save} disabled={saving || !form.title?.trim() || !form.venue?.trim() || !form.city?.trim()}>
            {saving ? '保存中…' : '保存'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <Field label="名称" required>
          <input className={inputCls} value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="主题类型">
          <select className={inputCls} value={form.theme ?? 'general'} onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}>
            {Object.entries(THEME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始时间" required>
            <input
              type="datetime-local"
              className={inputCls}
              value={form.startAt ? isoToLocalInput(form.startAt) : ''}
              onChange={(e) => e.target.value && setForm((f) => ({ ...f, startAt: localInputToIso(e.target.value) }))}
            />
          </Field>
          <Field label="结束时间" required>
            <input
              type="datetime-local"
              className={inputCls}
              value={form.endAt ? isoToLocalInput(form.endAt) : ''}
              onChange={(e) => e.target.value && setForm((f) => ({ ...f, endAt: localInputToIso(e.target.value) }))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="举办场馆" required>
            <input className={inputCls} value={form.venue ?? ''} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
          </Field>
          <Field label="城市" required>
            <input className={inputCls} value={form.city ?? ''} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </Field>
        </div>
        <Field label="详细地址">
          <input className={inputCls} value={form.address ?? ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="简介">
          <textarea className={`${inputCls} h-24 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>

        {/* ── P1-A① 大屏 / 地图字段(Kiosk 招聘会详情 / 现场大屏展示用,均为展示参考值)── */}
        <div className="border-t border-neutral-100 pt-4">
          <p className="text-sm font-medium text-neutral-700">大屏 / 地图字段</p>
          <p className="mt-0.5 text-xs text-neutral-400">用于 Kiosk 招聘会详情与现场大屏;均为展示参考值,留空即清空。此处仅填 URL,不上传文件。</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="导览图 URL">
            <input className={inputCls} placeholder="https://…" value={form.mapImageUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, mapImageUrl: e.target.value }))} />
          </Field>
          <Field label="封面图 URL">
            <input className={inputCls} placeholder="https://…" value={form.coverImageUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, coverImageUrl: e.target.value }))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="纬度 latitude(-90 ~ 90)">
            <input type="number" step="any" min={-90} max={90} className={inputCls} placeholder="留空清空" value={form.latitude ?? ''} onChange={(e) => setNum('latitude', e.target.value)} />
          </Field>
          <Field label="经度 longitude(-180 ~ 180)">
            <input type="number" step="any" min={-180} max={180} className={inputCls} placeholder="留空清空" value={form.longitude ?? ''} onChange={(e) => setNum('longitude', e.target.value)} />
          </Field>
        </div>
        <Field label="交通信息">
          <textarea className={`${inputCls} h-20 resize-none`} placeholder="地铁 / 公交 / 停车等(留空清空)" value={form.trafficInfo ?? ''} onChange={(e) => setForm((f) => ({ ...f, trafficInfo: e.target.value }))} />
        </Field>
        <Field label="预计参会人数">
          <input type="number" step={1} min={0} className={inputCls} placeholder="非负整数,留空清空" value={form.expectedAttendance ?? ''} onChange={(e) => setNum('expectedAttendance', e.target.value)} />
        </Field>
        <Field label="求职意向分布">
          <div className="space-y-2">
            {intentRows.length === 0 && (
              <p className="text-xs text-neutral-400">暂无;点击下方「添加一项」录入(标签 + 百分比)。</p>
            )}
            {intentRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  placeholder="意向标签(如:研发技术类)"
                  value={row.label}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      seekerIntent: (f.seekerIntent ?? []).map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                    }))
                  }
                />
                <input
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  className={`${inputCls} w-24`}
                  placeholder="0-100"
                  value={Number.isFinite(row.percent) ? row.percent : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    const n = v === '' ? 0 : Number(v)
                    setForm((f) => ({
                      ...f,
                      seekerIntent: (f.seekerIntent ?? []).map((s, j) =>
                        j === i ? { ...s, percent: Number.isNaN(n) ? s.percent : n } : s,
                      ),
                    }))
                  }}
                />
                <span className="text-sm text-neutral-400">%</span>
                <button
                  type="button"
                  className="shrink-0 rounded-md px-2 py-1 text-sm text-red-500 hover:bg-red-50"
                  onClick={() => setForm((f) => ({ ...f, seekerIntent: (f.seekerIntent ?? []).filter((_, j) => j !== i) }))}
                >
                  删除
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <GhostButton onClick={() => setForm((f) => ({ ...f, seekerIntent: [...(f.seekerIntent ?? []), { label: '', percent: 0 }] }))}>
                添加一项
              </GhostButton>
              {intentRows.some((s) => s.label.trim().length > 0) && intentSum !== 100 && (
                <span className="text-xs text-amber-500">当前合计 {intentSum}%(通常为 100%,不强制)</span>
              )}
            </div>
          </div>
        </Field>

        <p className="text-xs text-neutral-400">
          来源字段(来源机构 / 外部编号 / 来源链接)不可修改,保持数据可溯源。来源机构再次同步时,以来源数据为准,可能覆盖此处人工修订。
        </p>
      </div>
    </Drawer>
  )
}
