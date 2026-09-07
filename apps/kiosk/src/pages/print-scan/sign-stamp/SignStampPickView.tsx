import {
  FolderIcon,
  ImageIcon,
  PenToolIcon,
  SmartphoneIcon,
  UsbIcon,
  FileTextIcon,
} from 'lucide-react'
import type { PickedFile, StatusCopy } from './signStampModel'
import { SignStampPreview } from './SignStampPreview'
import { SignStampStatus } from './SignStampStatus'

interface PickCardProps {
  title: string
  d: string
  f: string
  tid: string
  tone: 'clay' | 'slate' | 'teal' | 'muted'
  icon: typeof FileTextIcon
  disabled?: boolean
  disabledReason?: string
  describedBy?: string
  onClick?: () => void
}

function PickCard({
  title,
  d,
  f,
  tid,
  tone,
  icon: Icon,
  disabled,
  describedBy,
  onClick,
}: PickCardProps) {
  if (disabled) {
    return (
      <div
        className="ss-pick"
        role="group"
        aria-disabled="true"
        data-testid={tid}
        aria-label={`${title}（${f}）`}
        aria-describedby={describedBy}
      >
        <span className="pi" data-tone={tone}>
          <Icon size={30} />
        </span>
        <b>{title}</b>
        <span className="d">{d}</span>
        <span className="f">{f}</span>
      </div>
    )
  }
  return (
    <button type="button" className="ss-pick" data-testid={tid} onClick={onClick}>
      <span className="pi" data-tone={tone}>
        <Icon size={30} />
      </span>
      <b>{title}</b>
      <span className="d">{d}</span>
      <span className="f">{f}</span>
    </button>
  )
}

function Note({ id, title, items }: { id?: string; title: string; items: string[] }) {
  return (
    <div className="ss-note" id={id} data-testid={id}>
      <h3>{title}</h3>
      <ul className="ss-plan">
        {items.map((item) => (
          <li key={item}>
            <span className="sq" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SignStampPickView({
  phase,
  ask,
  status,
  localDisabled,
  localDisabledReason,
  document,
  pages,
  onLocal,
  onPhone,
  onDocs,
}: {
  phase: 'doc' | 'stamp'
  ask: [string, string]
  status: StatusCopy
  localDisabled: boolean
  localDisabledReason: string
  document: PickedFile | null
  pages: number | null
  onLocal: () => void
  onPhone: () => void
  onDocs?: () => void
}) {
  const step = phase === 'doc' ? 0 : 1
  return (
    <>
      <section className="ss-xq">
        <div className="ss-xq-row">
          <div className="ss-xq-face" aria-hidden>
            青
          </div>
          <div>
            <div className="ss-xq-eyebrow">SIGN &amp; STAMP</div>
            <div className="ss-xq-ask">{ask[0]}</div>
            <div className="ss-xq-doing">{ask[1]}</div>
          </div>
        </div>
      </section>

      <section className="ss-sec" aria-label={phase === 'doc' ? '选要盖章的 PDF' : '传这次的签名 / 印章图'}>
        {phase === 'doc' ? (
          <>
            <div className="ss-sec-label">
              <span className="no">01</span>
              <span className="t">选要盖章的 PDF</span>
              <span className="hint">≤ 15MB · 1–30 页</span>
            </div>
            <div className="ss-pickrow">
              <PickCard
                title="本机上传 PDF"
                d="这趟刚传进本机的文件。"
                f={localDisabled ? localDisabledReason : 'PDF · ≤ 15MB'}
                tid="sign-stamp-pick-doc-local"
                tone="clay"
                icon={FileTextIcon}
                disabled={localDisabled}
                describedBy={localDisabled ? 'sign-stamp-doc-local-note' : undefined}
                onClick={onLocal}
              />
              <PickCard
                title="手机扫码上传 PDF"
                d="手机扫屏幕上的码，把 PDF 传进这台机器。"
                f="PDF · ≤ 15MB"
                tid="sign-stamp-pick-doc-phone"
                tone="slate"
                icon={SmartphoneIcon}
                onClick={onPhone}
              />
              <PickCard
                title="从我的文档选"
                d="你账号里已有的 PDF。"
                f="仅本人名下文件"
                tid="sign-stamp-pick-doc-docs"
                tone="teal"
                icon={FolderIcon}
                onClick={onDocs}
              />
              <PickCard
                title="从 U 盘选 PDF"
                d="U 盘那条路还没通到这一步。"
                f="暂时用不了 · 原因见下方"
                tid="sign-stamp-pick-doc-usb"
                tone="muted"
                icon={UsbIcon}
                disabled
                describedBy="sign-stamp-doc-note"
              />
              <Note
                title="选好之后当场检查"
                items={[
                  '是不是真的 PDF。',
                  '有没有加密、损坏或数字签名域。',
                  '页数在不在 1–30 之间。',
                  '原文件全程不改写。',
                ]}
              />
              <Note
                id="sign-stamp-doc-note"
                title="U 盘为什么用不了"
                items={[
                  'U 盘导入能用来打印，但还没通到签名盖章这一步。',
                  '先用上面三种方式选这份 PDF。',
                ]}
              />
            </div>
          </>
        ) : (
          <>
            <div className="ss-sec-label">
              <span className="no">02</span>
              <span className="t">传这次的签名 / 印章图</span>
              <span className="hint">≤ 10MB · ≤ 2500 万像素</span>
            </div>
            <div className="ss-pickrow">
              <PickCard
                title="本机上传图片"
                d="白纸上签好名拍一张，或用已有的印章图片。背景干净、边缘清楚更好。"
                f={localDisabled ? localDisabledReason : 'JPG / PNG · ≤ 10MB'}
                tid="sign-stamp-pick-stamp-local"
                tone="clay"
                icon={ImageIcon}
                disabled={localDisabled}
                describedBy={localDisabled ? 'sign-stamp-stamp-note' : undefined}
                onClick={onLocal}
              />
              <PickCard
                title="手机扫码上传图片"
                d="手机拍签名或选印章图片，确认后自动进入下一步。"
                f="JPG / PNG · ≤ 10MB"
                tid="sign-stamp-pick-stamp-phone"
                tone="slate"
                icon={SmartphoneIcon}
                onClick={onPhone}
              />
              <PickCard
                title="从 U 盘选图片"
                d="U 盘那条路还没通到这一步。"
                f="暂时用不了 · 原因见下方"
                tid="sign-stamp-pick-stamp-usb"
                tone="muted"
                icon={UsbIcon}
                disabled
                describedBy="sign-stamp-stamp-note"
              />
              <PickCard
                title="在屏幕上手写签名"
                d="触屏手写要先做压感校准。"
                f="未开放 · 需校准后开放"
                tid="sign-stamp-pick-stamp-handwrite"
                tone="muted"
                icon={PenToolIcon}
                disabled
                describedBy="sign-stamp-stamp-note"
              />
              <Note
                id="sign-stamp-stamp-note"
                title="这张图会被怎么对待"
                items={[
                  '只能这次新传，U 盘和手写暂时用不了。',
                  '按高敏材料短期保留，约 1 小时。',
                  '不进「我的文档」，也不能复用历史。',
                ]}
              />
            </div>
          </>
        )}
      </section>

      <div className="ss-work">
        <SignStampPreview
          compact
          document={document}
          pages={pages}
          stamp={null}
          result={null}
          viewPage={pages ?? 1}
          viewMode="page"
          zoom={0}
          pan={null}
          position="bottom-right"
          size="medium"
          burned={false}
          outErr={null}
          onViewPage={() => undefined}
          onViewMode={() => undefined}
          onZoom={() => undefined}
          onPreviewError={() => undefined}
        />
        <section className="ss-ctrlcol" aria-label="这一步的状态与说明">
          <SignStampStatus copy={status} />
          <div className="ss-grp">
            <h3>这一趟四步</h3>
            <div className="ss-steps" data-testid="sign-stamp-steps">
              {['选文档', '传签名 / 印章图', '选位置', '合成结果'].map((label, i) => (
                <div key={label} className={`ss-step${i < step ? ' done' : i === step ? ' on' : ''}`}>
                  <i aria-hidden />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      {localDisabled && phase === 'doc' ? (
        <p id="sign-stamp-doc-local-note" className="ss-reason ss-local-note">
          {localDisabledReason}
        </p>
      ) : null}
    </>
  )
}

export function pickAsk(phase: 'doc' | 'stamp', state: string, derived: boolean): [string, string] {
  if (phase === 'doc') {
    if (
      state.startsWith('document-') &&
      (state.includes('rejected') ||
        state.includes('too-') ||
        state.includes('encrypted') ||
        state.includes('corrupt') ||
        state.includes('digital') ||
        state.includes('source-'))
    ) {
      return ['这一份没收下。', '原因在右边。它没有进入流程，换一份就行。']
    }
    if (state === 'document-local-uploading') return ['正在传这份 PDF。', '单次上传，没有进度回传，传完立刻读页数。']
    if (state === 'document-phone-entry') return ['用手机把 PDF 传进来。', '扫屏幕上的码；手机上确认之后才进下一步。']
    if (state === 'document-inspecting') return ['正在读这份 PDF 的页数。', '加密、损坏、含数字签名域的，这一步就会被拒。']
    return ['先选一份要盖章的 PDF。', '把签名图叠上去，生成一份新的 PDF，原件不动。']
  }
  if (state.startsWith('stamp-') && (state.includes('rejected') || state.includes('too-') || state.includes('corrupt') || state.includes('encoding') || state.includes('source-'))) {
    return ['这张图没收下。', '原因在右边，换一张就行。']
  }
  if (state === 'stamp-local-uploading') return ['正在传这张签名图。', '按高敏材料短期保留，不进「我的文档」。']
  if (state === 'stamp-phone-entry') return ['用手机传签名 / 印章图。', '手机上确认之后才进下一步，这一页不替你确认。']
  if (derived || state === 'add-another-ready') return ['接着叠第二处。', '刚才那份派生 PDF 成了新原文档，签名图要重传。']
  if (state === 'document-ready') return ['这份 PDF 读好了。', '接下来传这次要用的签名或印章图片。']
  return ['传一张这次要用的签名图。', '只能这次新传，不进「我的文档」，也不能复用历史。']
}
