import { FsRow } from '../FsRow'
import type { PickedFile, StatusCopy } from './signStampModel'
import { SignStampStatus } from './SignStampStatus'
import { Fact, Sample } from './SignStampBits'

/**
 * 选 PDF / 传签名图两步（稿 20）。只有出了状况（读好了、没收下、正在传……）才画状态卡；
 * 默认态靠意图带和步骤条说话，不再把同一句话说三遍。
 */
export function SignStampPickView({
  phase,
  status,
  showCard,
  localDisabled,
  localDisabledReason,
  document,
  pages,
  onLocal,
  onPhone,
  onDocs,
}: {
  phase: 'doc' | 'stamp'
  status: StatusCopy
  showCard: boolean
  localDisabled: boolean
  localDisabledReason: string
  document: PickedFile | null
  pages: number | null
  onLocal: () => void
  onPhone: () => void
  onDocs?: () => void
}) {
  const doc = phase === 'doc'
  return (
    <>
      {showCard ? <SignStampStatus copy={status} /> : null}
      <p role="note" className="fs-p">只接受本人手写签名，不接受单位公章或圆形章；这不是可靠电子签名。</p>
      <p className="fs-h">
        {doc ? '选要签名的 PDF' : '传这次的本人手写签名图'}
        <small>{doc ? '≤ 15MB · 1–30 页' : '≤ 10MB · ≤ 2500 万像素'}</small>
      </p>

      {doc ? (
        <>
          {localDisabled ? null : (
            <FsRow
              title="本机上传 PDF"
              desc="这趟刚传进本机的文件。PDF · ≤ 15MB"
              testId="sign-stamp-pick-doc-local"
              onClick={onLocal}
            />
          )}
          <FsRow
            title="手机扫码上传 PDF"
            desc="手机扫屏幕上的码，把 PDF 传进这台机器。不超过 15MB，1 到 30 页"
            testId="sign-stamp-pick-doc-phone"
            onClick={onPhone}
          />
          <FsRow
            title="从我的文档选"
            desc="你账号里已有的 PDF，选中一份再带回签名页（仅本人名下文件）"
            testId="sign-stamp-pick-doc-docs"
            onClick={onDocs ?? (() => undefined)}
          />
          <FsRow
            title="从 U 盘选 PDF"
            desc="U 盘导入能用来打印，但还没通到签名这一步，先用上面三种方式选这份 PDF"
            testId="sign-stamp-pick-doc-usb"
            disabled
            onClick={() => undefined}
          />
          {localDisabled ? <p className="fs-help" id="sign-stamp-doc-local-note">{localDisabledReason}</p> : null}
          <div className="fs-facts">
            <Fact wide title="选好之后当场检查">
              是不是真的 PDF、有没有加密损坏或数字签名域、页数是不是 1 到 30。原文件全程不改写。
            </Fact>
            <div className="fs-pairgrid">
              <Fact title="原 PDF：永不改写。">合成的是新文件，原件不动。</Fact>
              <Fact title="还没选中">不放示例文件。系统收下之后才进入传签名图。</Fact>
            </div>
          </div>
        </>
      ) : (
        <>
          {localDisabled ? null : (
            <FsRow
              title="本机上传图片"
              desc="在白纸上签好本人姓名后拍一张。背景干净、边缘清楚更好。JPG / PNG · ≤ 10MB"
              testId="sign-stamp-pick-stamp-local"
              onClick={onLocal}
            />
          )}
          <FsRow
            title="手机扫码上传图片"
            desc="手机拍摄本人手写签名或选择本人的手写签名图片。JPG 或 PNG，不超过 10MB，不超过 2500 万像素"
            testId="sign-stamp-pick-stamp-phone"
            onClick={onPhone}
          />
          <FsRow
            title="从 U 盘选图片"
            desc="U 盘那条路还没通到这一步"
            testId="sign-stamp-pick-stamp-usb"
            disabled
            onClick={() => undefined}
          />
          <FsRow
            title="在屏幕上手写签名"
            desc="触屏手写要先做压感校准。未开放 · 需校准后开放"
            testId="sign-stamp-pick-stamp-handwrite"
            disabled
            onClick={() => undefined}
          />
          <div className="fs-facts">
            <Fact wide title="签名图留多久">
              按高敏材料短期保留，大约 1 小时后清除，不进「我的文档」，也不能复用历史。只能这次新传，U 盘和手写暂时用不了。
            </Fact>
            <Fact wide title="这份 PDF">
              {document ? `${document.name}${pages !== null ? ` · ${pages} 页` : ''}。` : ''}原 PDF：永不改写。
            </Fact>
          </div>
        </>
      )}
      <Sample art={doc ? 'doc' : 'sign'} />
    </>
  )
}
