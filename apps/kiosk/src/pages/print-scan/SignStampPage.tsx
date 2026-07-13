// ============================================================
// SignStampPage — 签名盖章（/print-scan/sign）
//
// v1 范围（详见 docs/progress 收口记录）：
//   - 目标文件仅支持单张 JPG / PNG（不支持多页 PDF、不做页码选择）。
//   - 签名 / 印章素材获取仅支持「手写」与「本机上传图片」两种方式；
//     不接入手机扫码上传（upload-sessions 模块的 purpose 白名单是独立的
//     安全评审范围，本任务不顺手扩大改动）。
//   - 叠加位置仅 5 预设锚点 × 3 档大小，不做自由拖拽/缩放。
//   - 签名素材短 TTL 即焚，不做"我的签名"跨会话保存复用。
//
// 提交后调用后端 /print/convert/sign-overlay 合成单页 PDF，返回内部 HMAC
// printFileUrl，与 ConvertImagesPage 完全同款收尾：直接 navigate 到
// /print/confirm（不经过独立预览页，PrintConfirmPage 自带预览）。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import type { OverlayPosition, OverlaySize } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowDownLeftIcon,
  ArrowDownRightIcon,
  ArrowUpLeftIcon,
  ArrowUpRightIcon,
  CheckCircle2Icon,
  FileType2Icon,
  LoaderIcon,
  ShieldCheckIcon,
  SquareIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/api/files'
import { composeSignatureOverlay } from '../../services/api/printConversion'
import { SignatureCanvasPad } from './components/SignatureCanvasPad'

const MAX_TARGET_BYTES = 10 * 1024 * 1024
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024

interface AcquiredFile {
  fileId: string
  fileAccessUrl: string
  name: string
  previewUrl: string
}

const POSITION_OPTIONS: Array<{ key: OverlayPosition; label: string; icon: typeof ArrowUpLeftIcon }> = [
  { key: 'top-left', label: '左上', icon: ArrowUpLeftIcon },
  { key: 'top-right', label: '右上', icon: ArrowUpRightIcon },
  { key: 'bottom-left', label: '左下', icon: ArrowDownLeftIcon },
  { key: 'bottom-right', label: '右下', icon: ArrowDownRightIcon },
  { key: 'center', label: '居中', icon: SquareIcon },
]

const SIZE_OPTIONS: Array<{ key: OverlaySize; label: string }> = [
  { key: 'small', label: '小' },
  { key: 'medium', label: '中' },
  { key: 'large', label: '大' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SignStampPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const targetInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)

  const [target, setTarget] = useState<AcquiredFile | null>(null)
  const [signature, setSignature] = useState<AcquiredFile | null>(null)
  const [signatureTab, setSignatureTab] = useState<'draw' | 'upload'>('draw')
  const [position, setPosition] = useState<OverlayPosition>('bottom-right')
  const [size, setSize] = useState<OverlaySize>('medium')

  const [uploadingTarget, setUploadingTarget] = useState(false)
  const [uploadingSignature, setUploadingSignature] = useState(false)
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(uploadingTarget || uploadingSignature || composing)

  // 当前预览 Blob URL 被替换（重新选择/重新获取）或本页卸载时统一释放，避免
  // 一体机长时间运行反复进出本页累积内存；deps 带上具体值以拿到当次真正持有
  // 的 URL（若用空 deps 数组，闭包会一直捕获挂载时的初始 null，卸载时清不到
  // 最新值）。
  useEffect(() => {
    return () => {
      if (target) URL.revokeObjectURL(target.previewUrl)
    }
  }, [target])
  useEffect(() => {
    return () => {
      if (signature) URL.revokeObjectURL(signature.previewUrl)
    }
  }, [signature])

  const handleTargetFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('目标文件仅支持 JPG / PNG 图片')
      return
    }
    if (selected.size > MAX_TARGET_BYTES) {
      setError(`目标文件大小不能超过 ${formatBytes(MAX_TARGET_BYTES)}，请压缩后重试`)
      return
    }
    setUploadingTarget(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, 'print_doc', getToken())
      setTarget({
        fileId: res.fileId,
        fileAccessUrl: res.signedUrl,
        name: res.filename,
        previewUrl: URL.createObjectURL(selected),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '目标文件上传失败，请重试')
    } finally {
      setUploadingTarget(false)
    }
  }

  const uploadSignatureBlob = async (blob: Blob, name: string) => {
    if (blob.size > MAX_SIGNATURE_BYTES) {
      setError(`签名 / 印章素材大小不能超过 ${formatBytes(MAX_SIGNATURE_BYTES)}`)
      return
    }
    setUploadingSignature(true)
    setError(null)
    try {
      // 保留 blob 真实 mime（画布导出固定是 image/png；本机上传的 JPEG 必须原样保留，
      // 否则文件名扩展名与强制 image/png 不一致会被服务端扩展名/魔数双重校验拒绝）。
      const file = new File([blob], name, { type: blob.type || 'image/png' })
      const res = await kioskUploadFile(file, 'signature_source', getToken())
      setSignature({
        fileId: res.fileId,
        fileAccessUrl: res.signedUrl,
        name: res.filename,
        previewUrl: URL.createObjectURL(blob),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '签名 / 印章素材上传失败，请重试')
    } finally {
      setUploadingSignature(false)
    }
  }

  const handleSignatureLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('签名 / 印章素材仅支持 JPG / PNG 图片')
      return
    }
    await uploadSignatureBlob(selected, selected.name)
  }

  const handleSubmit = async () => {
    if (!target || !signature) return
    setComposing(true)
    setError(null)
    try {
      const result = await composeSignatureOverlay(
        {
          target: { fileId: target.fileId, fileAccessUrl: target.fileAccessUrl },
          signature: { fileId: signature.fileId, fileAccessUrl: signature.fileAccessUrl },
          position,
          size,
        },
        { token: getToken() },
      )
      navigate('/print/confirm', {
        state: {
          file: {
            name: '签名盖章.pdf',
            size: formatBytes(result.sizeBytes),
            pages: result.pages,
            fileId: result.fileId,
            fileUrl: result.printFileUrl,
            fileMd5: result.fileMd5,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'color' }),
          source: 'document',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '签名合成失败，请稍后重试')
    } finally {
      setComposing(false)
    }
  }

  const canSubmit = Boolean(target && signature) && !composing

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="签名盖章"
        subtitle="选择文件 · 手写或上传签名 · 选位置 · 生成后打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-32">
        <div className="flex items-start gap-2 rounded-lg border border-info-bg bg-info-bg/70 px-4 py-3">
          <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-neutral-600">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}</p>
        </div>

        {/* 第一步：选择要签的文件 */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">第一步：选择要签的文件（JPG / PNG）</p>
          <input
            ref={targetInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={handleTargetFile}
          />
          {target ? (
            <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
              <img src={target.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{target.name}</p>
                <p className="flex items-center gap-1 text-xs text-success-fg">
                  <CheckCircle2Icon className="h-3.5 w-3.5" /> 已选择
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={uploadingTarget} onClick={() => targetInputRef.current?.click()}>
                重新选择
              </Button>
            </div>
          ) : (
            <Button size="lg" variant="secondary" disabled={uploadingTarget} onClick={() => targetInputRef.current?.click()}>
              {uploadingTarget ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <FileType2Icon className="mr-1.5 h-5 w-5" />}
              本机上传一张
            </Button>
          )}
        </Card>

        {/* 第二步：获取签名 / 印章素材 */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">第二步：手写或上传签名 / 印章</p>
          {signature ? (
            <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
              <img src={signature.previewUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-neutral-200 object-contain" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">签名 / 印章已就绪</p>
                <p className="flex items-center gap-1 text-xs text-success-fg">
                  <CheckCircle2Icon className="h-3.5 w-3.5" /> 已获取
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={uploadingSignature} onClick={() => setSignature(null)}>
                重新获取
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex gap-2">
                <Button
                  size="sm"
                  variant={signatureTab === 'draw' ? 'primary' : 'secondary'}
                  onClick={() => setSignatureTab('draw')}
                >
                  手写
                </Button>
                <Button
                  size="sm"
                  variant={signatureTab === 'upload' ? 'primary' : 'secondary'}
                  onClick={() => setSignatureTab('upload')}
                >
                  上传图片
                </Button>
              </div>
              {signatureTab === 'draw' ? (
                <SignatureCanvasPad
                  disabled={uploadingSignature}
                  onConfirm={(blob) => void uploadSignatureBlob(blob, 'signature.png')}
                />
              ) : (
                <>
                  <input
                    ref={signatureInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={handleSignatureLocalFile}
                  />
                  <Button
                    size="lg"
                    variant="secondary"
                    disabled={uploadingSignature}
                    onClick={() => signatureInputRef.current?.click()}
                  >
                    {uploadingSignature ? (
                      <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" />
                    ) : (
                      <UploadIcon className="mr-1.5 h-5 w-5" />
                    )}
                    上传一张印章 / 签名图片
                  </Button>
                </>
              )}
            </>
          )}
        </Card>

        {/* 第三步：叠加位置与大小 */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">第三步：叠加位置与大小</p>
          <div className="grid grid-cols-5 gap-2">
            {POSITION_OPTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPosition(key)}
                className={[
                  'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs',
                  position === key ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-500',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            {SIZE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSize(key)}
                className={[
                  'flex-1 rounded-lg border px-2 py-2.5 text-sm',
                  size === key ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-500',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 bg-white py-4">
        <Button size="lg" className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
          {composing ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : null}
          生成签名文件并去打印
        </Button>
      </div>
    </div>
  )
}
