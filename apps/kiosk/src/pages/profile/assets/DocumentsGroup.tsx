// 我的文档（C-2D）：预览 / 下载 / 再打印 / 删除。
// - 预览 / 下载：凭本人 token 换取 TTL 受控短期签名 URL（不在列表里直接持 URL）。
// - 再打印：仅 PDF；换取签名 URL 后进入既有 /print/confirm 真实打印链路。
//   页数后端未存，不编造 → pages: null（确认页如实显示「待识别，以实际打印为准」）。
// - 删除：两步确认 → /files/:id（服务端归属校验 + 对象存储物理删除 + 行软删 + 审计）。

import { useNavigate } from 'react-router-dom'
import type { MemberDocumentItem } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { DownloadIcon, EyeIcon, FilesIcon, PrinterIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { deleteMyDocument, fetchAccessUrl } from '../../../services/api/memberAssets'
import { formatSize, formatTime } from './format'
import { AssetGroupShell, AssetRow, RowIconButton, TwoStepDeleteButton } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function DocumentsGroup({
  group,
  onToast,
}: {
  group: AssetGroupHandle<MemberDocumentItem>
  onToast: (msg: string) => void
}) {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  // 打开文档：凭本人 token 换取短期签名 URL，再触发打开/下载。
  const open = async (doc: MemberDocumentItem, mode: 'preview' | 'download') => {
    const token = getToken()
    if (!token) return
    try {
      const { url } = await fetchAccessUrl(mode === 'preview' ? doc.previewUrlPath : doc.downloadUrlPath, token)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.click()
    } catch {
      onToast('文件访问失败，请稍后重试')
    }
  }

  // 再打印：换取签名 URL → 既有打印确认页（真实打印链路，不构造假文件）。
  const reprint = async (doc: MemberDocumentItem) => {
    const token = getToken()
    if (!token) return
    try {
      const { url } = await fetchAccessUrl(doc.previewUrlPath, token)
      navigate('/print/confirm', {
        state: {
          file: {
            name: doc.filename,
            size: formatSize(doc.sizeBytes),
            pages: null, // 后端未存页数，不编造；确认页显示「待识别，以实际打印为准」
            fileId: doc.id,
            fileUrl: url,
            mimeType: doc.mimeType,
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch {
      onToast('文件访问失败，请稍后重试')
    }
  }

  const remove = async (doc: MemberDocumentItem) => {
    const token = getToken()
    if (!token) return
    try {
      await deleteMyDocument(token, doc.id)
      group.removeLocal(doc.id)
      onToast('文档已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  return (
    <AssetGroupShell
      title="我的文档"
      group={group}
      empty="暂无文档，上传或打印的文件将在此查看"
      renderRow={(d) => (
        <AssetRow
          key={d.id}
          icon={FilesIcon}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          name={d.filename}
          meta={`${formatSize(d.sizeBytes)} · ${formatTime(d.createdAt)}`}
        >
          <RowIconButton icon={EyeIcon} title="预览" onClick={() => void open(d, 'preview')} />
          <RowIconButton icon={DownloadIcon} title="下载" onClick={() => void open(d, 'download')} />
          {d.mimeType === 'application/pdf' && (
            <RowIconButton icon={PrinterIcon} title="再打印" onClick={() => void reprint(d)} />
          )}
          <TwoStepDeleteButton title="删除文档" onConfirm={() => void remove(d)} />
        </AssetRow>
      )}
    />
  )
}
