import { useState } from 'react'
import { Card, Drawer } from '@ai-job-print/ui'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { DangerDeleteButton, Field, GhostButton, InlineError, PrimaryButton } from '../../../components/form'
import { ZONE_CATEGORY_LABELS, errMsg, inputCls } from './shared'
import { fairsAdminService, type FairZoneView, type SaveFairZoneInput } from '../../../services/api/fairsAdmin'

const EMPTY_ZONE: SaveFairZoneInput = { name: '', category: '', city: '', description: '', sortOrder: 0 }

export function ZonesTab({
  fairId,
  zones,
  onChanged,
}: {
  fairId: string
  zones: FairZoneView[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<FairZoneView | 'new' | null>(null)
  const [form, setForm] = useState<SaveFairZoneInput>(EMPTY_ZONE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openNew = () => {
    setForm({ ...EMPTY_ZONE, sortOrder: zones.length })
    setError(null)
    setEditing('new')
  }
  const openEdit = (z: FairZoneView) => {
    setForm({ name: z.name, category: z.category ?? '', city: z.city ?? '', description: z.description ?? '', sortOrder: z.sortOrder })
    setError(null)
    setEditing(z)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: SaveFairZoneInput = { ...form, category: form.category || undefined }
      if (editing === 'new') await fairsAdminService.createZone(fairId, payload)
      else if (editing) await fairsAdminService.updateZone(fairId, editing.id, payload)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (zoneId: string) => {
    setBusyId(zoneId)
    try {
      await fairsAdminService.deleteZone(fairId, zoneId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{zones.length} 个展区(按排序值升序展示)</p>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <PlusIcon className="h-3.5 w-3.5" />
          新增展区
        </button>
      </div>

      {zones.length === 0 ? (
        <Card className="p-10 text-center text-xs text-neutral-400">暂无展区,点击右上角"新增展区"录入(如 A区 数字经济 / 现场服务区)</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {zones.map((z) => (
            <Card key={z.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500">#{z.sortOrder}</span>
                    <p className="truncate font-medium text-neutral-800">{z.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    {z.category ? ZONE_CATEGORY_LABELS[z.category] ?? z.category : '未分类'}
                    {z.city ? ` · ${z.city}` : ''}
                  </p>
                  {z.description && <p className="mt-1.5 line-clamp-2 text-xs text-neutral-500">{z.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => openEdit(z)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <DangerDeleteButton onConfirm={() => void remove(z.id)} busy={busyId === z.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-neutral-400">
        展区信息用于一体机"展位导览"页展示。当前未建展位(booth)级数据模型,导览图展示展区列表与底图,不含展位坐标。
      </p>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增展区' : '编辑展区'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="展区名称" required>
            <input className={inputCls} placeholder="如 A区 数字经济" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="类别">
            <select className={inputCls} value={form.category ?? ''} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              <option value="">未分类</option>
              {Object.entries(ZONE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="城市/区">
              <input className={inputCls} value={form.city ?? ''} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
            <Field label="排序值">
              <input
                type="number" min={0} className={inputCls} value={form.sortOrder ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </Field>
          </div>
          <Field label="说明">
            <textarea className={`${inputCls} h-20 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
