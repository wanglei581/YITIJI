import type { ReactNode } from 'react'
import { QrCodeIcon } from 'lucide-react'
import {
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
} from '@ai-job-print/shared'

/**
 * 到机码页的 hid 扫码指引（原型 11-arrival-code.html `rHid()`）。
 *
 * 这一屏教的是「去哪儿扫、怎么扫」，不是扫码器状态。
 * 2026-09-07 Windows 真机实测（PR #913）：模组靠接近感应触发、不常亮；
 * 能读手机屏幕上的码，但需要把亮度调高。亮度这一句稿里没有，照实写。
 */
export function PickupHidGuide({
  echo,
  errorMsg,
}: {
  echo: ReactNode
  errorMsg: string
}) {
  return (
    <>
      <div className="qx-card pcp-hid-card">
        <div className="pcp-hid-stage" aria-hidden="true">
          <span className="pcp-hid-corner pcp-hid-corner--tl" />
          <span className="pcp-hid-corner pcp-hid-corner--tr" />
          <span className="pcp-hid-corner pcp-hid-corner--bl" />
          <span className="pcp-hid-corner pcp-hid-corner--br" />
          <div className="pcp-hid-phone">
            <QrCodeIcon size={38} />
          </div>
        </div>
        <div className="pcp-hid-main">
          <p className="pcp-hid-t">请出示手机上的码</p>
          <p className="pcp-hid-s" id="pcp-hid-hint">
            打开小程序里的到机码页面，把手机屏幕对准<strong>机身侧面的扫码区</strong>。
            扫码模组靠接近感应触发，不会一直亮着。
            <strong>把手机屏幕亮度调高</strong>，再把屏幕凑近扫码区。
            扫到的内容以 USB 键盘方式输入，和手输走同一套校验规则。
          </p>
          {echo}
          {errorMsg ? (
            <div id="pcp-error-msg" className="pcp-error" role="alert">
              ⚠ {errorMsg}
            </div>
          ) : null}
        </div>
      </div>

      <section className="qx-card pcp-hid-ab" aria-label="两种扫码的区别">
        <h2 className="pcp-hid-ab-t">两种「扫码」不是一回事</h2>
        <div className="pcp-hid-ab-cols">
          <div className="pcp-hid-ab-col is-current">
            <b>本页：机器读你的手机</b>
            <span>机身扫码区读取你手机上的到机码，扫到自动校验。</span>
          </div>
          <div className="pcp-hid-ab-col">
            <b>另一处：你用手机扫屏幕</b>
            <span>手机传文件、扫码登录是扫这台机器的屏幕，去「文件来源」页。</span>
          </div>
        </div>
      </section>
    </>
  )
}

export function PickupThreeCodeCard() {
  return (
    <section className="qx-card pcp-ab" aria-label="三种码的区别">
      <h2 className="pcp-ab-t">三种码，别搞混</h2>
      <div className="pcp-ab-cols">
        <div className="pcp-ab-col is-current">
          <b>到机码 · 本页用</b>
          <span>{PICKUP_CODE_LENGTH} 位纯数字（旧码 {PICKUP_CODE_MAX_INPUT_LENGTH} 位），对应一笔打印订单。</span>
        </div>
        <div className="pcp-ab-col">
          <b>上传码 · 手机传文件用</b>
          <span>在手机上传页出示，有效期以服务端返回为准。</span>
        </div>
        <div className="pcp-ab-col">
          <b>取件凭证码 · 取纸/补打用</b>
          <span>打印完成后才有，给工作人员核验或代取——本页不输它。</span>
        </div>
      </div>
    </section>
  )
}
