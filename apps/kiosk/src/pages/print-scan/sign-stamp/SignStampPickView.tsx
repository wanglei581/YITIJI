import type { ReactNode } from 'react'
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

function Note({
  id,
  title,
  items,
  span,
}: {
  id?: string
  title: string
  items: ReactNode[]
  span?: boolean
}) {
  return (
    <div className={span ? 'ss-note ss-note-span' : 'ss-note'} id={id} data-testid={id}>
      <h3>{title}</h3>
      <ul className="ss-plan">
        {items.map((item, index) => (
          <li key={index}>
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
  ask: [ReactNode, ReactNode]
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
            <div className="ss-xq-eyebrow">签名</div>
            <div className="ss-xq-ask">{ask[0]}</div>
            <div className="ss-xq-doing">{ask[1]}</div>
          </div>
        </div>
      </section>

      <section className="ss-sec" aria-label={phase === 'doc' ? '选要放入签名的 PDF' : '传这次的本人手写签名'}>
        {phase === 'doc' ? (
          <>
            <div className="ss-sec-label">
              <span className="no">01</span>
              <span className="t">选要放入签名的 PDF</span>
              <span className="hint">≤ 15MB · 1–30 页</span>
            </div>
            <div className="ss-pickrow">
              {!localDisabled && (<PickCard
                title="本机上传 PDF"
                d="这趟刚传进本机的文件。"
                f={localDisabled ? localDisabledReason : 'PDF · ≤ 15MB'}
                tid="sign-stamp-pick-doc-local"
                tone="clay"
                icon={FileTextIcon}
                disabled={localDisabled}
                describedBy={localDisabled ? 'sign-stamp-doc-local-note' : undefined}
                onClick={onLocal}
              />)}
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
                  <b>原文件全程不改写。</b>,
                ]}
              />
              <Note
                id="sign-stamp-doc-note"
                title="U 盘为什么用不了"
                items={[
                  'U 盘导入能用来打印，但还没通到签名这一步。',
                  '先用上面三种方式选这份 PDF。',
                ]}
              />
            </div>
          </>
        ) : (
          <>
            <div className="ss-sec-label">
              <span className="no">02</span>
              <span className="t">传这次的本人手写签名</span>
              <span className="hint">白纸签字后拍照 · ≤ 10MB</span>
            </div>
            <div className="ss-pickrow">
              {!localDisabled && (<PickCard
                title="本机上传签名照片"
                d="请本人在白纸上签字，再把这张纸拍清楚。不要拍单位公章或圆形章。"
                f={localDisabled ? localDisabledReason : 'JPG / PNG · ≤ 10MB'}
                tid="sign-stamp-pick-stamp-local"
                tone="clay"
                icon={ImageIcon}
                disabled={localDisabled}
                describedBy={localDisabled ? 'sign-stamp-stamp-note' : undefined}
                onClick={onLocal}
              />)}
              <PickCard
                title="手机扫码上传图片"
                d="签名图片暂不支持手机上传，请在本机上传。"
                f="暂时用不了"
                tid="sign-stamp-pick-stamp-phone"
                tone="muted"
                icon={SmartphoneIcon}
                disabled
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
                d="直接在屏幕上写，要先校准触屏。现在请用白纸签字后拍照。"
                f="本机暂未开通"
                tid="sign-stamp-pick-stamp-handwrite"
                tone="muted"
                icon={PenToolIcon}
                disabled
                describedBy="sign-stamp-stamp-note"
              />
              <Note
                id="sign-stamp-stamp-note"
                span
                title="这张签名会怎么保存"
                items={[
                  '只收本人这一次新拍的手写签名。',
                  '大约保留 1 小时，用完即清。',
                  <b>不进「我的文档」，也不能下次再用。</b>,
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
              {['选文档', '传签名图', '选位置', '合成结果'].map((label, i) => (
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

export function pickAsk(phase: 'doc' | 'stamp', state: string, derived: boolean): [ReactNode, ReactNode] {
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
      return [<>这一份<em>没收下</em>。</>, <>原因在右边。<b>它没有进入流程</b>，换一份就行。</>]
    }
    if (state === 'document-local-uploading') {
      return [<>正在<em>传这份 PDF</em>。</>, <>单次上传，<b>没有进度回传</b>，传完立刻读页数。</>]
    }
    if (state === 'document-phone-entry') {
      return [<>用<em>手机</em>把 PDF 传进来。</>, <>扫屏幕上的码；<b>手机上确认之后</b>才进下一步。</>]
    }
    if (state === 'document-inspecting') {
      return [<>正在<em>读这份 PDF 的页数</em>。</>, <>加密、损坏、含数字签名域的，<b>这一步就会被拒</b>。</>]
    }
    return [<>先选一份<em>要签名的 PDF</em>。</>, <>把签名图叠上去，生成<b>一份新的 PDF</b>，原件不动。</>]
  }
  if (state.startsWith('stamp-') && (state.includes('rejected') || state.includes('too-') || state.includes('corrupt') || state.includes('encoding') || state.includes('source-'))) {
    return [<>这张图<em>没收下</em>。</>, <>原因在右边，<b>换一张就行</b>。</>]
  }
  if (state === 'stamp-local-uploading') {
    return [<>正在<em>传这张签名图</em>。</>, <>按高敏材料短期保留，<b>不进「我的文档」</b>。</>]
  }
  if (state === 'stamp-phone-entry') {
    return [<>签名图<em>暂不支持</em>手机上传。</>, <>请在这台机器上选一张本人手写签名的图片，<b>这一页不替你确认</b>。</>]
  }
  if (derived || state === 'add-another-ready') {
    return [<>接着叠<em>第二处</em>。</>, <>刚才那份签好的 PDF 成了新原文档，<b>签名图要重传</b>。</>]
  }
  if (state === 'document-ready') {
    return [<>这份 PDF <em>读好了</em>。</>, <>接下来传<b>这次要用的</b>签名图片。</>]
  }
  return [<>传一张<em>这次要用的</em>签名图。</>, <>只能这次新传，<b>不进「我的文档」，也不能复用历史</b>。</>]
}
