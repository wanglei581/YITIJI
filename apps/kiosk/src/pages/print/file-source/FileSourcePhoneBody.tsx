// 选择文件来源 · 手机扫码通道的正文（稿 12-file-source 的 phone-* 各态）
//
// 码只画系统给的一次性链接；文件名、大小来自上传结果。稿里「示例码」「示例」角标、
// 「示例：没能作废 / 确认已作废」两颗演示按钮都不照搬。
import type { ReactNode } from 'react'
import { AlertTriangleIcon, CheckIcon, ClockIcon } from 'lucide-react'
import { ChannelGrid, FileRow, FileSourceNote, FileSourceStatus, FileSourceSteps, HelpMini } from './FileSourceBits'
import { EmptyBox, GrowCard, ListCard, NotesCard, PhoneQrCard, StatusP, SwitchRow, TailCard } from './FileSourceParts'
import type { FileSourceBodyProps } from './FileSourceView'

function PendingRow({ props, tag, tone, bad }: { props: FileSourceBodyProps; tag: string; tone: 'doing' | 'bad'; bad?: boolean }) {
  const { phone } = props
  if (!phone.pendingName) return null
  return (
    <FileRow
      name={phone.pendingName}
      meta={`${phone.pendingSize ?? ''} · 手机扫码上传`}
      tag={tag}
      tagTone={tone}
      bad={bad}
      testId="file-source-phone-file"
    />
  )
}

export function PhoneBody(props: FileSourceBodyProps): ReactNode {
  const { screen, phone, qrUrl, expiresLabel, onHelp, channelKeys, usbMode, onSelectChannel, showFileChannel } = props
  const hasFile = Boolean(phone.pendingName)
  const qrLive = qrUrl && !phone.loading ? 'live' : 'blank'
  switch (screen) {
    case 'phone-generating':
      return (
        <>
          <FileSourceStatus kind="plain" title="正在向系统要一张上传码" pulsing chips={[{ label: '正在向系统要码' }, { label: '单份 ≤ 10MB' }]}>
            <StatusP>还没拿到码，所以<b>这里不先放一张假的图</b>。</StatusP>
            <StatusP>拿到之后用手机相机或微信扫一扫对准屏幕就行，不用登录，也不用装软件。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind="blank" qrUrl={null} title="码还没出来">
            <FileSourceSteps items={['系统准备好这次上传，给出一次性上传链接。', '本机把链接画成二维码。', '你扫码、选文件、点上传。']} />
          </PhoneQrCard>
          <SwitchRow keys={channelKeys} active="qr" usbMode={usbMode} onSelect={onSelectChannel} />
        </>
      )
    case 'phone-gen-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="二维码没生成出来" chips={[{ tone: 'bad', label: '这次没准备好' }, { label: '没有文件被接收' }]}>
            <StatusP>向系统申请上传码失败了，所以<b>这里没有码</b>。本机<b>不会先出一张假码</b>再补 —— 那会让你白扫一次。</StatusP>
            <StatusP><b>没有任何文件被接收</b>。重试一次，或者改用{showFileChannel ? '本机 / U 盘那两条通道' : ' U 盘那条通道'}。</StatusP>
          </FileSourceStatus>
          <NotesCard
            title="可能是什么原因"
            twoCol
            notes={['这台机器到系统的网络断了。', '系统的手机上传服务暂时不可用。', '登录状态过期了，需要回一体机重新登录再试。']}
            after={<FileSourceNote>重试是安全的：<b>这一步不会产生重复文件</b>，因为还没有任何文件进来。</FileSourceNote>}
          />
          <SwitchRow keys={channelKeys} active="qr" usbMode={usbMode} onSelect={onSelectChannel} />
        </>
      )
    case 'phone-ready':
      return (
        <>
          <FileSourceStatus kind="plain" title="用手机对准左边这张码" chips={[{ label: '上传状态：等待上传' }]}>
            <StatusP>本机<b>看不到你扫没扫</b> —— 系统根本不给这种信号。只有它真收到文件，下面才会变。</StatusP>
            <StatusP>有效期按<b>系统给出的到期时间</b>计算，到期后这张码不再收文件。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind={qrLive} qrUrl={qrUrl} expiresLabel={expiresLabel} title="扫码 → 选文件 → 上传">
            <FileSourceSteps
              items={['手机打开相机或微信扫一扫，对准屏幕。', '在手机上选好文件，点「上传」。', <>系统收到后，<b>回到这台机器点确认</b>才算数。</>]}
            />
          </PhoneQrCard>
          <HelpMini onHelp={onHelp} text="手机扫不出来、或者扫开之后打不开页面，找工作人员帮忙。" />
        </>
      )
    case 'phone-waiting':
      return (
        <>
          <FileSourceStatus kind="plain" title="码已经出来了，在等系统的消息" pulsing chips={[{ label: '上传状态：等待上传' }, { label: '扫没扫这件事本机不知道' }]}>
            <StatusP>本机在反复查这次上传的状态。<b>看不到你扫没扫</b>，也<b>不模拟手机端的动作</b>——手机那边点了什么，这台机器一概不知道。</StatusP>
            <StatusP>手机上传完，下面会出现文件名，那时候才需要你回来点确认。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind={qrLive} qrUrl={qrUrl} expiresLabel={expiresLabel} title="等手机把文件送上来">
            <div className="fs-notes">
              <FileSourceNote>手机端选文件、上传，都发生在<b>你的手机上</b>，本机只等系统结果。</FileSourceNote>
              <FileSourceNote>刷新会<b>先撤销旧的那次上传</b>再出新码，旧码立刻作废，不会同时有两张有效码。</FileSourceNote>
            </div>
          </PhoneQrCard>
          <HelpMini onHelp={onHelp} text="等太久没反应，或者手机那边报错，找工作人员帮忙。" />
        </>
      )
    case 'phone-uploading':
      return (
        <>
          <FileSourceStatus kind="info" title="手机正在上传" pulsing chips={[{ label: '上传状态：上传中' }, { label: '没有进度百分比' }]}>
            <StatusP>系统把这次上传标成了「上传中」。文件还在路上，<b>没有可确认的百分比</b>，所以不画进度条，也不说还剩几秒。</StatusP>
            <StatusP>这时候<b>别关手机上那个页面</b>。传完之后，你还要在这台机器上点一次确认。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind={qrLive} qrUrl={qrUrl} expiresLabel={expiresLabel} title="传完之后要回这台机器确认">
            <FileSourceSteps items={['手机把文件送到系统。', '系统确认保存，状态变为已上传。', <><b>你在这台机器上点确认</b>，才成为当前文件。</>]} />
            <div className="fs-qr-foot"><FileSourceNote>传到了也不等于可以继续 —— <b>没确认就不放行</b>。</FileSourceNote></div>
          </PhoneQrCard>
          <HelpMini onHelp={onHelp} text="手机上传卡住不动，可以取消重来，也可以叫工作人员。" />
        </>
      )
    case 'phone-status-unknown':
      return (
        <>
          <FileSourceStatus kind="warn" title="这次上传的状态取不到了" chips={[{ tone: 'warn', label: '状态未知 ≠ 已过期' }, { label: '连续 3 次失败按过期处理' }]}>
            <StatusP>本机刚才没问到这次上传的状态。<b>这不代表码已经失效</b>，也<b>不等于已过期</b>——只是本机现在不知道。</StatusP>
            <StatusP>可以再问一次；连着 3 次问不到，本机就按已过期处理，重新出一张码更省事。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind={qrLive} qrUrl={qrUrl} expiresLabel={expiresLabel} title="这张码可能还活着，也可能没了">
            <div className="fs-notes">
              <FileSourceNote>本机<b>不猜</b>。屏幕上不会因为问不到就写「已失效」。</FileSourceNote>
              <FileSourceNote>本机<b>没有因此取消或作废任何东西</b>；这一屏也<b>不替结果显示</b>文件现在是什么状态。</FileSourceNote>
              <FileSourceNote>重新出码会<b>先撤销这一张</b>，不会留两张有效码。</FileSourceNote>
            </div>
          </PhoneQrCard>
          <HelpMini onHelp={onHelp} text="二维码扫不出来、或者一直问不到状态，找工作人员帮忙。" />
        </>
      )
    case 'phone-expired':
      return (
        <>
          <FileSourceStatus kind="warn" title="这张上传码过期了" chips={[{ tone: 'warn', label: '上传状态：已过期' }]}>
            <StatusP>这次上传已到期，<b>旧二维码不再接收文件</b>。到期时间由系统给出。</StatusP>
            <StatusP>重新出一张就行。过期前<b>还没确认</b>的那份临时上传，<b>按系统的清理规则处理</b>；<b>此前已确认、已归档的文件不受影响</b>。</StatusP>
          </FileSourceStatus>
          <PhoneQrCard kind={qrUrl ? 'dim' : 'blank'} qrUrl={qrUrl} title="这张已经不能用了">
            <div className="fs-notes">
              <FileSourceNote>本次办理里<b>还没有当前文件</b>，所以下一步仍然按住不放。</FileSourceNote>
              <FileSourceNote>重新出码会先把这一张<b>作废掉</b>，避免两张码同时有效。</FileSourceNote>
              <FileSourceNote>手机上那个旧页面刷新后会提示回一体机重新扫码。</FileSourceNote>
            </div>
          </PhoneQrCard>
          <HelpMini onHelp={onHelp} text="重新出码还是不行，或者手机上打不开上传页，找工作人员帮忙。" />
        </>
      )
    case 'phone-uploaded':
      return (
        <>
          <FileSourceStatus kind="info" title="手机传上来一份，等你确认" chips={[{ tone: 'ok', label: '上传状态：已上传，待确认' }, { tone: 'warn', label: '未确认 · 不能继续' }]}>
            <StatusP>文件名和大小是<b>系统回给本机的结果</b>。<b>传到了还不算数</b>——必须你在这台机器上确认，它才成为本次办理的当前文件。</StatusP>
            <StatusP>不是你要的那一份？点取消，回手机重新传。</StatusP>
          </FileSourceStatus>
          <GrowCard>
            <PendingRow props={props} tag="待确认" tone="doing" />
            <div className="fs-notes">
              <FileSourceNote>确认这一下<b>要你在这台机器上点</b>；确认之前它<b>不进这次办理</b>。</FileSourceNote>
              <FileSourceNote>本次办理只带一份。确认后想换，得先在当前文件卡上删掉。</FileSourceNote>
              <FileSourceNote>页数和敏感信息检查在<b>下一步</b>做，这里不预告结论。</FileSourceNote>
            </div>
            <FileSourceSteps
              title="点「确认使用这份文件」之后"
              items={['本机请系统把它收进本次办理。', '它成为唯一当前文件，手机端那页可以关了。', '下一步「材料检查」才会亮起来。']}
              row
            />
          </GrowCard>
        </>
      )
    case 'phone-confirming':
      return (
        <>
          <FileSourceStatus kind="info" title="正在确认这份文件" pulsing chips={[{ label: '正在向系统确认' }]}>
            <StatusP>本机正在请系统把这份文件收进本次办理。<b>结果没回来之前，它还不是当前文件。</b></StatusP>
            <StatusP>这一步<b>没有百分比</b>可显示，成功或失败都会明确告诉你。</StatusP>
          </FileSourceStatus>
          <ListCard title="等待确认结果" hint="确认中">
            <PendingRow props={props} tag="确认中" tone="doing" />
            <EmptyBox icon={<CheckIcon size={38} aria-hidden="true" />}>确认成功后它才成为<b>唯一当前文件</b>，<br />那时下一步才会亮起来。</EmptyBox>
            <FileSourceSteps title="确认成功之后" items={['这份文件进入本次办理。', '手机上那个上传页就可以关了。', '下一步「材料检查」才会亮起来。']} row />
          </ListCard>
          <HelpMini onHelp={onHelp} text="确认一直转圈，多半是网络问题，可以叫工作人员。" />
        </>
      )
    case 'phone-confirm-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="确认失败" chips={[{ tone: 'bad', label: '确认未成功' }, { label: '当前文件仍为空' }]}>
            <StatusP>这份文件<b>没有进入本次办理</b>。多半是这次上传已经过期或被占用，也可能是本机到系统的网络断了。</StatusP>
            <StatusP>可以直接重试确认；还是不行就<b>重新出一张码</b>再传一次。</StatusP>
          </FileSourceStatus>
          <ListCard title="这一份" hint="确认失败">
            <PendingRow props={props} tag="确认失败" tone="bad" bad />
            <EmptyBox icon={<AlertTriangleIcon size={38} aria-hidden="true" />}>重试确认<b>不会产生第二份文件</b>。<br />这次上传若已失效，重新出码是更快的路。</EmptyBox>
            <FileSourceSteps title="两条路" items={['直接重试确认，不会多出一份文件。', '这次上传已经失效的话，重新出码再传一次。', '两条都不通就叫工作人员。']} row />
          </ListCard>
        </>
      )
    case 'phone-cancel-requesting':
      return (
        <>
          <FileSourceStatus kind="info" title="正在取消这次手机上传" pulsing chips={[{ label: '等系统答复' }, { tone: 'warn', label: hasFile ? '未作废 · 也未确认' : '未作废' }]}>
            <StatusP>
              本机已经把取消请求发给系统，<b>答复还没回来</b>。
              {hasFile ? <>这期间刚才那份文件<b>仍然留在这次上传里</b>，本机不替系统下结论。</> : '这期间旧码还收不收文件，本机不替系统下结论。'}
            </StatusP>
            <StatusP>成功或失败都会明确告诉你。<b>没成功，这一屏就不宣布作废</b>{hasFile ? '；这份文件也不会从屏幕上无声消失。' : '。'}</StatusP>
          </FileSourceStatus>
          <ListCard title={hasFile ? '这一份还挂着' : '这次上传还挂着'} hint="取消处理中">
            <PendingRow props={props} tag="等答复" tone="doing" />
            <EmptyBox icon={<ClockIcon size={38} aria-hidden="true" />}>
              答复回来之前，这一屏<b>既不说已经作废</b>，<br />也不说{hasFile ? '这份已经进了本次办理' : '这次上传还能用'}。
            </EmptyBox>
            <FileSourceSteps
              title="两种答复各自会怎样"
              items={[
                '系统确认作废：旧码不再收文件，这份不进本次办理。',
                '系统没能作废：这次上传仍旧留着，你可以重试，也可以回去把它确认掉。',
                '两种都不会让本次办理里凭空多出一份文件。',
              ]}
              row
            />
          </ListCard>
        </>
      )
    case 'phone-cancel-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="这次上传没能取消" chips={[{ tone: 'bad', label: '取消未成功' }, { tone: 'warn', label: hasFile ? '这份仍待确认' : '旧码可能仍有效' }]}>
            <StatusP>
              系统<b>没有确认作废</b>。所以本机<b>不说旧二维码已经失效</b>，也<b>不清掉这次上传</b>
              {hasFile ? <> —— 刚才传上来的那份<b>还留着，等你处理</b>。</> : '。'}
            </StatusP>
            <StatusP>这时候<b>先不要开新的码</b>。旧的那次上传到底作废没有还不知道，这会儿再建一个，容易出现两张码同时有效。</StatusP>
          </FileSourceStatus>
          <ListCard title={hasFile ? '这一份还留着' : '这次上传还留着'} hint="未作废">
            <PendingRow props={props} tag="仍待确认" tone="doing" />
            <EmptyBox icon={<AlertTriangleIcon size={38} aria-hidden="true" />}>重试取消<b>不会把这一份弄丢</b>。<br />还是失败的话，它照样留在这里等你决定。</EmptyBox>
            <FileSourceSteps
              title="你可以走两条路"
              items={['再试一次取消。还是不行，这一份也不会丢。', '或者不取消了，回去把这一份确认成本次办理要打的文件。', '两条都不通就叫工作人员，别在这里反复点。']}
              row
            />
          </ListCard>
          <HelpMini onHelp={onHelp} text="取消一直不成功，多半是本机到系统的网络断了，可以叫工作人员来看。" />
        </>
      )
    case 'phone-cancelled':
      return (
        <>
          <FileSourceStatus kind="plain" title="这次手机上传已作废" chips={[{ label: '上传状态：已取消' }]}>
            <StatusP>系统确认这次上传<b>已经作废</b>，<b>旧二维码不再接收文件</b>。本次办理里<b>还是没有文件</b>。</StatusP>
            <StatusP>这次<b>还没确认</b>的那份临时上传，<b>按系统的清理规则处理</b>。本机<b>不替系统下结论</b> —— 这一屏既不宣布它已经没了，也不保证它一定还留着。</StatusP>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="fs-sec-h">
              <span className="no">01</span>
              <span className="t">接着走哪条</span>
              <span className="hint">{channelKeys.length === 3 ? '三' : '两'}条都还在</span>
            </div>
            <ChannelGrid keys={channelKeys} active="qr" usbMode={usbMode} onSelect={onSelectChannel} />
          </section>
          <TailCard
            title="再来一次也行"
            body={<>重新出码会<b>重新开一次上传</b>，和刚才作废的那次没有关系，不会串文件。</>}
            stepsTitle="重新出码之后"
            steps={['系统重新开一次全新的上传。', '本机把新链接画成新的二维码。', '旧码就算还没到期也已经作废了。']}
            foot={<>这次没确认的临时上传<b>按系统清理规则处理</b>；<b>此前已确认、已归档的文件不受影响</b>。</>}
          />
        </>
      )
    default:
      return null
  }
}

