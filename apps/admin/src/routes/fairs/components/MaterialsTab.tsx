import { useState } from 'react'
import { Card, Drawer, StatusBadge } from '@ai-job-print/ui'
import { FileTextIcon, PencilIcon, PrinterIcon, UploadIcon } from 'lucide-react'
import { DangerDeleteButton, Field, GhostButton, InlineError, PrimaryButton } from '../../../components/form'
import { MATERIAL_TYPE_LABELS, PUBLISH_BADGE, errMsg, formatSize, inputCls, resolvePreviewUrl } from './shared'
import { fairsAdminService, type FairMaterialView } from '../../../services/api/fairsAdmin'

export function MaterialsTab({
  fairId,
  materials,
  onChanged,
}: {
  fairId: string
  materials: FairMaterialView[]
  onChanged: () => void
}) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadMeta, setUploadMeta] = useState({ name: '', type: 'other', description: '', pageCount: '' })
  const [editing, setEditing] = useState<FairMaterialView | null>(null)
  const [editMeta, setEditMeta] = useState({ name: '', type: 'other', description: '', pageCount: '', allowPrint: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openUpload = () => {
    setUploadFile(null)
    setUploadMeta({ name: '', type: 'other', description: '', pageCount: '' })
    setError(null)
    setUploadOpen(true)
  }

  const pickFile = (file: File | null) => {
    setUploadFile(file)
    if (file && !uploadMeta.name.trim()) {
      setUploadMeta((m) => ({ ...m, name: file.name.replace(/\.[^.]+$/, '') }))
    }
  }

  const doUpload = async () => {
    if (!uploadFile) return
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.uploadMaterial(fairId, uploadFile, {
        name: uploadMeta.name.trim(),
        type: uploadMeta.type,
        description: uploadMeta.description.trim() || undefined,
        pageCount: uploadMeta.pageCount ? Math.max(0, Math.floor(Number(uploadMeta.pageCount) || 0)) : undefined,
      })
      setUploadOpen(false)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (m: FairMaterialView) => {
    setEditMeta({
      name: m.name,
      type: m.type,
      description: m.description ?? '',
      pageCount: m.pageCount ? String(m.pageCount) : '',
      allowPrint: m.allowPrint,
    })
    setError(null)
    setEditing(m)
  }

  const doEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.updateMaterial(fairId, editing.id, {
        name: editMeta.name.trim(),
        type: editMeta.type,
        description: editMeta.description.trim() || undefined,
        pageCount: editMeta.pageCount ? Math.max(0, Math.floor(Number(editMeta.pageCount) || 0)) : 0,
        allowPrint: editMeta.allowPrint,
      })
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (m: FairMaterialView) => {
    setBusyId(m.id)
    try {
      await fairsAdminService.publishMaterial(fairId, m.id, m.publishStatus === 'published' ? 'unpublish' : 'publish')
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (materialId: string) => {
    setBusyId(materialId)
    try {
      await fairsAdminService.deleteMaterial(fairId, materialId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{materials.length} 份资料(发布后在一体机"活动资料"页可见)</p>
        <button onClick={openUpload} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <UploadIcon className="h-3.5 w-3.5" />
          上传资料
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['资料名称', '类型', '页数', '大小', '打印次数', '状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {materials.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-xs text-neutral-400">暂无活动资料,点击右上角"上传资料"(支持 PDF / PNG / JPEG)</td></tr>
              ) : (
                materials.map((m) => (
                  <tr key={m.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileTextIcon className="h-4 w-4 shrink-0 text-neutral-400" />
                        <span className="font-medium text-neutral-800">{m.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{MATERIAL_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{m.pageCount > 0 ? `${m.pageCount} 页` : '未填写'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{formatSize(m.fileSizeKB)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-neutral-600">
                        <PrinterIcon className="h-3.5 w-3.5 text-neutral-400" />
                        {m.printCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        dot
                        status={PUBLISH_BADGE[m.publishStatus]?.status ?? 'default'}
                        label={PUBLISH_BADGE[m.publishStatus]?.label ?? m.publishStatus}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        {m.previewUrl ? (
                          <a
                            href={resolvePreviewUrl(m.previewUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            预览
                          </a>
                        ) : (
                          <span className="rounded px-2 py-1 text-xs text-neutral-300" title="mock 模式无真实文件">预览</span>
                        )}
                        <button
                          disabled={busyId === m.id}
                          onClick={() => void togglePublish(m)}
                          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                            m.publishStatus === 'published' ? 'text-warning-fg hover:bg-warning-bg' : 'text-success-fg hover:bg-success-bg'
                          }`}
                        >
                          {m.publishStatus === 'published' ? '下架' : '发布'}
                        </button>
                        <button onClick={() => openEdit(m)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <DangerDeleteButton onConfirm={() => void remove(m.id)} busy={busyId === m.id} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-neutral-400">
        资料文件经服务端校验(PDF / PNG / JPEG,≤20MB),一体机经签名短时链接访问,不暴露存储地址。删除会移除文件并保留删除日志。
      </p>

      {/* 上传抽屉 */}
      <Drawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="上传活动资料"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setUploadOpen(false)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={doUpload} disabled={saving || !uploadFile || !uploadMeta.name.trim()}>
              {saving ? '上传中…' : '上传'}
            </PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="文件(PDF / PNG / JPEG,≤20MB)" required>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary-600 hover:file:bg-primary-100"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          {uploadFile && (
            <p className="text-xs text-neutral-500">已选择:{uploadFile.name}({formatSize(Math.round(uploadFile.size / 1024))})</p>
          )}
          <Field label="资料名称" required>
            <input className={inputCls} value={uploadMeta.name} onChange={(e) => setUploadMeta((m) => ({ ...m, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类型">
              <select className={inputCls} value={uploadMeta.type} onChange={(e) => setUploadMeta((m) => ({ ...m, type: e.target.value }))}>
                {Object.entries(MATERIAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="页数(选填)">
              <input
                type="number" min={0} className={inputCls} placeholder="打印参考"
                value={uploadMeta.pageCount}
                onChange={(e) => setUploadMeta((m) => ({ ...m, pageCount: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="说明(选填)">
            <textarea className={`${inputCls} h-20 resize-none`} value={uploadMeta.description} onChange={(e) => setUploadMeta((m) => ({ ...m, description: e.target.value }))} />
          </Field>
          <p className="text-xs text-neutral-400">上传后默认为草稿,需点击"发布"后一体机才可见。Word 文档请先转为 PDF 再上传。</p>
        </div>
      </Drawer>

      {/* 编辑抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="编辑资料信息"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={doEdit} disabled={saving || !editMeta.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="资料名称" required>
            <input className={inputCls} value={editMeta.name} onChange={(e) => setEditMeta((m) => ({ ...m, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类型">
              <select className={inputCls} value={editMeta.type} onChange={(e) => setEditMeta((m) => ({ ...m, type: e.target.value }))}>
                {Object.entries(MATERIAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="页数">
              <input
                type="number" min={0} className={inputCls}
                value={editMeta.pageCount}
                onChange={(e) => setEditMeta((m) => ({ ...m, pageCount: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="说明">
            <textarea className={`${inputCls} h-20 resize-none`} value={editMeta.description} onChange={(e) => setEditMeta((m) => ({ ...m, description: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={editMeta.allowPrint}
              onChange={(e) => setEditMeta((m) => ({ ...m, allowPrint: e.target.checked }))}
              className="h-4 w-4 rounded border-neutral-300"
            />
            允许在一体机打印
          </label>
          <p className="text-xs text-neutral-400">文件本体不可替换;如需换文件,请删除后重新上传。</p>
        </div>
      </Drawer>
    </div>
  )
}
