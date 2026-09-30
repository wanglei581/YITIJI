// 选择文件来源 · 来源选择 / 兜底 / 本机通道 的正文（稿 12-file-source 的 V[...] 同名状态）
//
// 文案照稿；稿里写死的示例文件名、「示例」角标不照搬，文件名与大小一律来自真实上传结果。
import type { ReactNode } from 'react'
import { AlertTriangleIcon, ArrowLeftRightIcon, FileTextIcon, UploadIcon } from 'lucide-react'
import { ChannelGrid, ExistingSourceLinks, FileRow, FileSourceNote, FileSourceStatus, FileSourceSteps, HelpMini, InfoMini, NowFileCard } from './FileSourceBits'
import { EmptyBox, GrowCard, ListCard, StatusP, SwitchRow, TailCard } from './FileSourceParts'
import type { FileSourceBodyProps } from './FileSourceView'

const CN_COUNT = ['零', '一', '两', '三']

export function ChooserBody(props: FileSourceBodyProps): ReactNode {
  const { screen, channelKeys, usbMode, onSelectChannel, showScan, onScan, onDocuments, wordAccepted } = props
  const n = CN_COUNT[channelKeys.length] ?? String(channelKeys.length)
  if (screen === 'missing-file' || screen === 'unknown') {
    const missing = screen === 'missing-file'
    return (
      <>
        <FileSourceStatus
          kind={missing ? 'warn' : 'error'}
          title={missing ? '这一步还没有可用的文件' : '无法识别的页面状态'}
          chips={[{ tone: missing ? 'warn' : 'bad', label: missing ? '没有文件，先不往下走' : '判断不了就按不能办处理' }]}
        >
          {missing ? (
            <>
              <StatusP>这一步要先有<b>一份文件</b>，这次办理里还没有 —— 本机不会替你挑一份，也不会没传就说「已经传好了」。</StatusP>
              <StatusP>这<b>不代表系统删了什么</b>。重新从下面任一条通道搬一份进来就能接着走。</StatusP>
            </>
          ) : (
            <>
              <StatusP>这一页认不出你要打开哪一步。<b>我不猜你想去哪一步</b>，也<b>不把认不出的内容显示出来</b>。</StatusP>
              <StatusP>办理类型按「{props.isResumePrint ? '简历打印' : '文档打印'}」处理，其余认不出的内容一律不用。</StatusP>
            </>
          )}
        </FileSourceStatus>
        <section className="fs-sec">
          <div className="fs-sec-h">
            <span className="no">01</span>
            <span className="t">{missing ? '重新选一条通道' : '从头选一条通道'}</span>
            <span className="hint">{missing ? `${n}条都能走` : '这是本页唯一的正经入口'}</span>
          </div>
          <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
        </section>
        {missing ? (
          <TailCard
            title="为什么会看到这一屏"
            body={<><b>显示文件名、文件列表或办理结果</b>的那几步都得先有一份文件。<b>没有文件时</b>，要文件的那几步都会回到这一屏。</>}
            stepsTitle="重新搬一份进来要几步"
            steps={['上面挑一条通道。', '按那条通道的提示把文件送到系统。', '系统确认之后它成为当前文件。']}
            foot={<>这一屏<b>不代表出错</b>，只代表本次办理里现在是空的。</>}
          />
        ) : (
          <TailCard
            title="本页只做搬运"
            body={<>把要打印的文件搬进这次办理，确认成<b>唯一当前文件</b>，然后交给材料检查。<b>不做 AI 简历诊断</b>，也不在这里解析内容。</>}
            stepsTitle="本页在整条打印流程里的位置"
            steps={['第 1 步（就是这一页）：把文件搬进来。', '第 2 步：材料检查，看页数与敏感信息。', '第 3 步设打印参数，第 4 步确认出纸。']}
            foot={<>简历诊断、优化、生成是另一条业务线，<b>不从这一页进</b>。</>}
          />
        )}
      </>
    )
  }
  return (
    <>
      <section className="fs-sec">
        <div className="fs-sec-h">
          <span className="no">01</span>
          <span className="t">文件从哪来</span>
          <span className="hint">选一条，下面跟着换</span>
        </div>
        <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
      </section>
      <ExistingSourceLinks showScan={showScan} onScan={onScan} onDocuments={onDocuments} />
      <section className="fs-sec">
        <div className="fs-split">
          <div className="fs-mini" data-static="true">
            <h4>第三方网盘尚未接入</h4>
            <p>本机不接百度网盘 / 微信文件的授权登录 —— 在公共终端上登你的网盘账号不安全。<b>你自己存过的材料一直在</b>：登录后从「我的文档」直接选。没存过的，先存到手机里，再用手机扫码上传。</p>
          </div>
          <div className="fs-mini" data-static="true">
            <h4>两个上限不一样</h4>
            <p>
              手机上传单份 <b>≤ 10MB</b>；本机选和 U 盘导入单份 <b>≤ 15MB</b>。
              {wordAccepted
                ? 'Word 由本机转成 PDF 后再打印；U 盘只列 PDF / JPG / PNG，Excel / 压缩包不收。'
                : '都只收 PDF / JPG / PNG，Word / Excel / 压缩包不收。'}
            </p>
          </div>
        </div>
      </section>
      <section className="fs-sec qx-grow">
        <div className="qx-card fs-gcard fs-chooser-now">
          <div>
            <div className="fs-sec-h fs-gcard-h">
              <span className="t">当前文件</span>
              <span className="hint">0 份</span>
            </div>
            <FileSourceNote>还没有文件。上面{n}条通道任选一条，搬进来的文件名会显示在这里。</FileSourceNote>
          </div>
          <FileSourceSteps title="搬进来之后" items={['机器先看格式和大小对不对，确认收下。', '文件名和大小显示在这一栏。', '下一步「材料检查」才会亮起来。']} row />
        </div>
      </section>
    </>
  )
}

export function LocalBody(props: FileSourceBodyProps): ReactNode {
  const { screen, blockedName, blockedMeta, formats, wordHint, onHelp, channelKeys, usbMode, onSelectChannel } = props
  switch (screen) {
    case 'local-guide':
    case 'local-picking':
      return (
        <>
          <FileSourceStatus kind="plain" title="本机选文件：备用通道" chips={[{ label: formats }, { label: '单份 ≤ 15MB' }]}>
            <StatusP>这条会弹出<b>系统文件窗口</b>。一体机上不推荐先用它 —— 系统弹窗会盖住流程，公共屏也不该暴露本机目录。</StatusP>
            <StatusP>手机和 U 盘都不方便时再用这条。<b>单份 ≤ 15MB，只收 {formats}。</b></StatusP>
          </FileSourceStatus>
          <GrowCard spread>
            <FileSourceSteps
              title="点下面这一下会发生什么"
              items={[<>浏览器弹出系统文件窗口，你挑<b>一份</b>文件。</>, '选中即上传，系统校验格式和大小。', '系统确认后，文件名出现在「当前文件」里。']}
              row
            />
            <div className="fs-notes">
              <FileSourceNote>{wordHint}</FileSourceNote>
              <FileSourceNote><b>第三方网盘尚未接入</b>：公共终端不做网盘授权登录。你自己传过或生成过的材料在「我的文档」里，登录即可直接选用；其余先下到手机再扫码上传。</FileSourceNote>
              <FileSourceNote><b>关掉这个系统窗口</b>不会上传任何东西，也不会改变本次办理里已经有的当前文件。</FileSourceNote>
            </div>
          </GrowCard>
          <SwitchRow keys={channelKeys} active="file" usbMode={usbMode} onSelect={onSelectChannel} />
        </>
      )
    case 'local-cancelled':
      return (
        <>
          <FileSourceStatus kind="plain" title="你取消了文件窗口" chips={[{ label: '关掉窗口 · 未开始上传' }]}>
            <StatusP>这一屏只对应<b>一种情况</b>：系统文件窗口被关掉，<b>上传还没开始</b>。所以这一步<b>还是没有文件</b>，也<b>没有产生任何上传</b>，系统那边什么也没发生。</StatusP>
            <StatusP><b>上传一旦开始就到不了这一屏</b> —— 那一步本页没有取消动作，只能等系统给结果。现在可以再打开一次窗口，或者换一条通道，手机扫码通常比翻目录快。</StatusP>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="fs-sec-h">
              <span className="no">01</span>
              <span className="t">接着走哪条</span>
              <span className="hint">{CN_COUNT[channelKeys.length]}条都还在</span>
            </div>
            <ChannelGrid keys={channelKeys} active="file" usbMode={usbMode} onSelect={onSelectChannel} />
          </section>
          <TailCard
            title="本机通道的定位"
            body={<>在屏幕上弹文件窗口是<b>备用通道</b>，不是一体机的首选。现场优先用手机扫码。</>}
            stepsTitle="为什么一体机上更推荐手机扫码"
            steps={['不用在公共屏上翻本机目录。', '系统弹窗不会盖住流程。', '要打的文件本来就多半在你手机里。']}
            foot={<>手机和 U 盘都不方便时，<b>本机通道照样能走</b>。</>}
          />
        </>
      )
    case 'local-rejected':
    case 'local-oversize':
    case 'local-unreadable': {
      const ext = blockedName && blockedName.includes('.') ? blockedName.slice(blockedName.lastIndexOf('.') + 1).toUpperCase() : null
      const copy =
        screen === 'local-rejected'
          ? {
              kind: 'error' as const, title: '这份格式不收', tag: '格式不收',
              p1: <>系统只收 <b>{formats}</b>，其它格式一律不收，<b>这一份没有被上传</b>。</>,
              p2: props.wordAccepted ? 'Excel、PPT、压缩包先另存为 PDF 再传就行。' : 'Word 先另存为 PDF 再传就行。',
              chips: [{ tone: 'bad' as const, label: ext ? `${ext} 不在收件范围` : '格式不在收件范围' }],
            }
          : screen === 'local-oversize'
            ? {
                kind: 'warn' as const, title: '这份超过 15MB', tag: '超过 15MB',
                p1: <>本机与 U 盘通道单份上限 <b>15MB</b>，这一份{blockedMeta ? ` ${blockedMeta}` : ''}，<b>没有被上传</b>。</>,
                p2: '照片可以在手机相册里选「较小尺寸」再传；扫描件可以降一档分辨率。',
                chips: [{ tone: 'warn' as const, label: '本机 / U 盘 ≤ 15MB' }, { label: '手机上传 ≤ 10MB' }],
              }
            : {
                kind: 'error' as const, title: '这份读不出来', tag: '读不出来',
                p1: <>文件为空或者大小取不到，<b>不会硬着头皮上传</b>一份连大小都读不出的东西。</>,
                p2: '多半是文件还在同步、或者已经被移走了。换一份，或者重新导出一次。',
                chips: [{ tone: 'bad' as const, label: '大小未知' }],
              }
      return (
        <>
          <FileSourceStatus kind={copy.kind} title={copy.title} chips={copy.chips}>
            <StatusP>{copy.p1}</StatusP>
            <StatusP>{copy.p2}</StatusP>
          </FileSourceStatus>
          <ListCard title="被挡下的这一份" hint="未上传">
            {blockedName ? (
              <FileRow name={blockedName} meta={blockedMeta ?? ''} tag={copy.tag} tagTone="bad" bad testId="file-source-blocked-file" />
            ) : null}
            <EmptyBox icon={<UploadIcon size={38} aria-hidden="true" />}>当前文件仍然是<b>空的</b>。<br />回到窗口再挑一份合规的就能接着走。</EmptyBox>
            <FileSourceSteps title="挑一份能收的" items={['PDF 最稳，排版不会跑。', '手机拍的照片选 JPG / PNG。', '单份控制在 15MB 以内。']} row />
          </ListCard>
        </>
      )
    }
    case 'local-uploading':
      return (
        <>
          <FileSourceStatus
            kind="info"
            title="正在上传，请稍候"
            pulsing
            chips={[{ label: '没有可确认的百分比' }, { tone: 'warn', label: '本页无取消动作' }]}
          >
            <StatusP>这一份是<b>一次性整份送出</b>，<b>系统不回传进度</b>。所以这里不画进度条，也不说还剩几秒 —— 那种数字只能是编的。</StatusP>
            <StatusP><b>这一步没有「取消本次上传」这个动作</b>：请求已经送出去了，能不能停下来只有系统知道，本机<b>不拿一次点击冒充系统已经停手</b>。<b>结果出来之前我不说已经成功</b>，失败那一屏可以直接重试。</StatusP>
          </FileSourceStatus>
          <ListCard title="这一份" hint="上传中">
            {blockedName ? (
              <FileRow name={blockedName} meta={blockedMeta ?? ''} tag="正在上传" tagTone="doing" testId="file-source-uploading-file" />
            ) : null}
            <EmptyBox icon={<UploadIcon size={38} aria-hidden="true" />}>确认保存之前，<b>当前文件仍然是空的</b>。<br />退出这一页<b>不会</b>让系统停下来，也不会让它更快。</EmptyBox>
            <FileSourceSteps
              title="接下来只有三种结果"
              items={['成功：系统确认保存，文件名进入「当前文件」。', '失败：明确说没送上去，那一屏可以直接重试。', '一直不结束：叫工作人员来看，别反复点。']}
              row
            />
          </ListCard>
          <HelpMini onHelp={onHelp} text="上传一直不结束，或者反复失败，可以叫工作人员来看一眼。" />
        </>
      )
    case 'local-upload-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="上传没成功" chips={[{ tone: 'bad', label: '系统未确认' }, { label: '当前文件仍为空' }]}>
            <StatusP>系统<b>没有确认收到</b>这一份，所以当前文件还是空的。常见原因是本机网络断了，或者系统暂时不可用。</StatusP>
            <StatusP><b>你刚才挑的那一份还在</b>，直接重试就行，不用重新翻目录。</StatusP>
          </FileSourceStatus>
          <ListCard title="这一份" hint="上传失败">
            {blockedName ? (
              <FileRow name={blockedName} meta={blockedMeta ?? ''} tag="上传失败" tagTone="bad" bad testId="file-source-failed-file" />
            ) : null}
            <EmptyBox icon={<AlertTriangleIcon size={38} aria-hidden="true" />}>重试还是不行的话，换手机扫码那条通道往往能绕开本机网络问题。</EmptyBox>
            <FileSourceSteps title="重试会怎么走" items={['还是用你刚才挑的那一份。', '把刚才那一份重新整份送一次。', '成功就直接出现在当前文件里。']} row />
          </ListCard>
        </>
      )
    default:
      return null
  }
}

/** 三条通道共用的「已有当前文件」三态：local-ready / phone-confirmed / usb-ready。 */
export function ReadyBody(props: FileSourceBodyProps): ReactNode {
  const { screen, currentFile, fromLabel, onPreview, onReplace, onDelete } = props
  if (!currentFile) return null
  const status =
    screen === 'usb-ready'
      ? {
          title: '导入完成，可以拔 U 盘了',
          p: [<>文件名和大小是<b>系统确认保存后回到这台机器的结果</b>。系统已经读完这份文件，<b>可以拔出 U 盘</b>。</>, <>本机<b>没有「安全弹出」按钮</b>——屏幕上弹不出 U 盘，给一个假按钮不如说清楚。</>],
          chips: [{ tone: 'ok' as const, label: '系统已确认' }, { label: '可以拔出 U 盘' }],
        }
      : screen === 'phone-confirmed'
        ? {
            title: '已确认，这就是本次办理要打的文件',
            p: [<>文件名和大小是<b>系统回给本机的结果</b>，确认动作也已经落到系统。</>, <>这是本次办理的<b>唯一当前文件</b>。要换就先删掉，不做静默替换。</>],
            chips: [{ tone: 'ok' as const, label: '上传状态：已确认' }, { label: '手机扫码上传' }],
          }
        : {
            title: '先核对这份文件',
            p: ['打开预览，看清每一页有没有选错。', '一次办理一份；需要换文件，可以在下面更换。'],
            chips: [{ label: '下一步：隐私预检' }, { label: '本机选文件' }],
          }
  return (
    <>
      <FileSourceStatus kind="info" title={status.title} chips={status.chips}>
        {status.p.map((line, index) => <StatusP key={index}>{line}</StatusP>)}
      </FileSourceStatus>
      <NowFileCard name={currentFile.name} meta={currentFile.size} from={fromLabel} onPreview={onPreview} onReplace={onReplace} onDelete={onDelete} />
      {screen === 'usb-ready' ? (
        <InfoMini icon={<FileTextIcon size={22} aria-hidden="true" />} title="U 盘上的东西没被改">
          整个过程<b>只读不写</b>。这一份被复制到系统，你盘上的原件<b>还在原地</b>。
        </InfoMini>
      ) : screen === 'phone-confirmed' ? (
        <InfoMini icon={<FileTextIcon size={22} aria-hidden="true" />} title="手机那边可以关了">
          确认之后手机上那个上传页就没用了。<b>本机不会再从那次上传拿第二份文件。</b>
        </InfoMini>
      ) : (
        <InfoMini icon={<ArrowLeftRightIcon size={22} aria-hidden="true" />} title="想换一条来源？">
          先<b>删除</b>当前文件，再选择手机上传或 U 盘。
        </InfoMini>
      )}
    </>
  )
}
