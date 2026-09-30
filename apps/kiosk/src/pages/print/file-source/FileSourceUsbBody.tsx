// 选择文件来源 · U 盘通道的正文（稿 12-file-source 的 usb-* 各态）
//
// 事实口径跟 Terminal Agent（apps/terminal-agent/src/usb/usb-files.ts）一致：只列最外层
// PDF / JPG / PNG、单份 ≤ 15MB、最多列 200 个；每个文件标识只能导入一次、10 分钟内有效。
// 盘名、文件名、大小一律来自读盘结果；稿里的示例盘名与示例文件不照搬。
import type { ReactNode } from 'react'
import { AlertTriangleIcon, ClockIcon, UploadIcon, UsbIcon } from 'lucide-react'
import { ChannelGrid, FileRow, FileSourceNote, FileSourceStatus, FileSourceSteps, HelpMini } from './FileSourceBits'
import { EmptyBox, GrowCard, ListCard, NotesCard, StatusP, SwitchRow, TailCard } from './FileSourceParts'
import type { FileSourceBodyProps } from './FileSourceView'

export function UsbBody(props: FileSourceBodyProps): ReactNode {
  const { screen, channelKeys, usbMode, onSelectChannel, onHelp, usbFiles, usbSelected, usbDriveLabel, formatBytes, onUsbSelect } = props
  const switchRow = <SwitchRow keys={channelKeys} active="usb" usbMode={usbMode} onSelect={onSelectChannel} />
  const others = channelKeys.filter((key) => key !== 'usb').length
  const selectedRow = (tag: string, tone: 'ok' | 'bad' | 'doing', opts: { bad?: boolean; on?: boolean; dim?: boolean } = {}) =>
    usbSelected ? (
      <FileRow
        name={usbSelected.filename}
        meta={`${formatBytes(usbSelected.sizeBytes)}${usbDriveLabel ? ` · ${usbDriveLabel}` : ''}`}
        tag={tag}
        tagTone={tone}
        {...opts}
        testId="file-source-selected-file"
      />
    ) : null
  switch (screen) {
    case 'usb-unavailable':
      return (
        <>
          <FileSourceStatus kind="lock" title="这台机器没开通 U 盘导入" chips={[{ tone: 'warn', label: '本机没开通 · 重试无效' }]}>
            <StatusP>这台机器<b>没有开通读 U 盘</b>，所以这条通道锁着。<b>这不是重试能解决的</b>，得由工作人员在这台机器上开通。</StatusP>
            <StatusP>插着的 U 盘<b>不会被本机读取</b>，也没有任何文件被复制走。</StatusP>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="fs-sec-h">
              <span className="no">01</span>
              <span className="t">{others === 2 ? '还能用的两条路' : '还能用的那条路'}</span>
              <span className="hint">U 盘那格是锁着的</span>
            </div>
            <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
          </section>
          <TailCard
            title="和「暂时没连上」不是一回事"
            body={<>没开通 = 这台机器从来没打开过这条通道；没连上 = 读 U 盘的功能装好了，只是此刻没连上。<b>后者才值得重试。</b></>}
            stepsTitle="这条通道要开通需要什么"
            steps={['这台机器装好读盘的功能并开着。', '屏幕这边和读 U 盘的功能配好对。', '两边对上之后 U 盘那一格才会解锁。']}
            foot={<>这三件事都得由工作人员在机器上做，<b>你在这一屏点什么都不会改变它</b>。</>}
          />
        </>
      )
    case 'usb-agent-offline':
      return (
        <>
          <FileSourceStatus kind="error" title="读 U 盘的功能暂时没连上" chips={[{ tone: 'bad', label: '读 U 盘暂时没连上' }, { label: '可以重试' }]}>
            <StatusP>这台机器<b>开通了</b> U 盘导入，读 U 盘的功能也装好了，只是此刻没连上。<b>和「没开通」不是一回事</b>——这个可以重试。</StatusP>
            <StatusP>重新连上之前，本机<b>不去猜 U 盘里有什么</b>，也不显示上一次的列表。</StatusP>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="fs-sec-h">
              <span className="no">01</span>
              <span className="t">重试，或者换一条</span>
              <span className="hint">{others === 2 ? '两条通道不受影响' : '手机扫码不受影响'}</span>
            </div>
            <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
          </section>
          <TailCard
            title="重试是安全的"
            body={<>读盘<b>只读不写</b>，只看最外层的文件。重试不会改动你盘上的任何东西。</>}
            stepsTitle="重试会做什么"
            steps={['本机再试着连一次读 U 盘的功能。', '连上了就重新列一次 U 盘最外层的文件。', '还是连不上，就换手机扫码那条通道。']}
            foot={<>连不上期间本机<b>不去猜 U 盘里有什么</b>，也不显示上一次的列表。</>}
          />
        </>
      )
    case 'usb-wait':
      return (
        <>
          <FileSourceStatus kind="plain" title="把 U 盘插进右侧 USB 口" chips={[{ label: '只看最外层' }, { label: 'PDF / JPG / PNG · ≤ 15MB' }]}>
            <StatusP>还<b>没有检测到 U 盘</b>。插上后这台机器列出<b>最外层</b>能打印的文件，你在屏幕上选一份。</StatusP>
            <StatusP>本机<b>不会自动读整盘</b>，也不进子文件夹。想传的文件请先放到 U 盘最外层。</StatusP>
          </FileSourceStatus>
          <GrowCard spread>
            <FileSourceSteps
              title="插上之后会发生什么"
              items={['这台机器认出插上的 U 盘。', <>列出最外层的 PDF / JPG / PNG，<b>每份文件只能导入一次，10 分钟内有效</b>。</>, '你选一份，这台机器把它读出来传到系统。']}
              row
            />
            <div className="fs-notes">
              <FileSourceNote>屏幕上<b>只列文件名</b>，不显示你盘上的完整路径。</FileSourceNote>
              <FileSourceNote>整个过程<b>只读不写</b>，不会往你的 U 盘里放东西。</FileSourceNote>
            </div>
          </GrowCard>
          {switchRow}
        </>
      )
    case 'usb-detecting':
      return (
        <>
          <FileSourceStatus kind="plain" title="正在读 U 盘" pulsing chips={[{ label: '正在读 U 盘最外层' }, { label: '每份只能导入一次 · 10 分钟内有效' }]}>
            <StatusP>这台机器在读 U 盘最外层的文件。<b>不画进度条</b>——读盘这件事没有可确认的百分比，编一个只会误导人。</StatusP>
            <StatusP><b>每份文件只能导入一次，10 分钟内有效</b>；重新读一次 U 盘，就可以重新选。</StatusP>
          </FileSourceStatus>
          <NotesCard
            title="这一步在做什么"
            notes={[<>只列<b>最外层</b>的 PDF / JPG / PNG，不进子文件夹。</>, '超过 15MB 的不列出来 —— 列了你也传不上去。', <>读盘期间<b>请不要拔盘</b>。</>]}
            after={
              <>
                <FileSourceSteps title="读完之后" items={['列出最外层能打印的文件。', '你点其中一份，它被标为已选中。', '再点导入，这台机器才开始读这份文件。']} row />
                <FileSourceNote>读完之前本机<b>不显示任何文件名</b>，也不拿上一次的列表凑数。</FileSourceNote>
              </>
            }
          />
          <HelpMini onHelp={onHelp} text="读盘一直不出结果，可能是 U 盘或插口的问题，叫工作人员看看。" />
        </>
      )
    case 'usb-empty':
      return (
        <>
          <FileSourceStatus kind="warn" title="这个 U 盘里没有能用的文件" chips={[{ tone: 'warn', label: '最外层 0 个可用文件' }]}>
            <StatusP>最外层<b>没有找到</b> PDF / JPG / PNG。常见原因：简历是 DOCX、文件放在子文件夹里、或者单份超过 15MB。</StatusP>
            <StatusP>在电脑上把文件<b>另存成 PDF 放到最外层</b>，再插一次就能看到了。</StatusP>
          </FileSourceStatus>
          <NotesCard
            title="对号入座"
            notes={[
              <><b>简历是 DOCX</b> —— Word 里「另存为 PDF」，再放回 U 盘最外层。</>,
              <><b>文件在子文件夹里</b> —— 本机不进子文件夹，拖到最外层。</>,
              <><b>单份超过 15MB</b> —— 降一档分辨率再导出。</>,
            ]}
            after={<FileSourceNote>手边没有电脑的话，<b>手机扫码上传</b>通常比折腾 U 盘快。</FileSourceNote>}
          />
          {switchRow}
        </>
      )
    case 'usb-read-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="读 U 盘失败" chips={[{ tone: 'bad', label: '读盘失败' }, { label: '不显示上一次的列表' }]}>
            <StatusP>这台机器连上了 U 盘，但这次<b>没能列出文件</b>。可能是盘没插稳、文件系统不认识，或者刚才被拔了。</StatusP>
            <StatusP>重新插一次再读。本机<b>不显示上一次的列表</b>——免得你选中一份其实已经不在盘上的文件。</StatusP>
          </FileSourceStatus>
          <NotesCard
            title="先试这几步"
            twoCol
            notes={['拔出来再插一次，插到底。', '换一个 USB 口。', '盘是 exFAT / NTFS / FAT32 之外的格式，本机认不出来。']}
            after={<FileSourceNote><b>没有任何文件被读取或上传。</b>你的 U 盘内容没有被改动。</FileSourceNote>}
          />
          {switchRow}
        </>
      )
    case 'usb-list': {
      const files = usbFiles ?? []
      return (
        <>
          <section className="fs-sec">
            <FileSourceNote>每一份都<b>只能导入一次</b>，导入就算用掉；<b>重新读一次 U 盘，就可以重新选</b>。一次只能选一份。</FileSourceNote>
          </section>
          <ListCard title={usbDriveLabel ? `U 盘最外层（${usbDriveLabel}）` : 'U 盘最外层'} hint={`${files.length} 项 · 一次选一个`}>
            <div className="fs-flist">
              {files.map((item) => (
                <FileRow
                  key={item.safeId}
                  name={item.filename}
                  meta={formatBytes(item.sizeBytes)}
                  tag="选这份"
                  tagTone="pickable"
                  on={usbSelected?.safeId === item.safeId}
                  onClick={() => onUsbSelect(item.safeId)}
                  testId={`file-source-usb-file-${item.safeId}`}
                />
              ))}
            </div>
            <FileSourceSteps
              title="选中之后会怎样"
              items={['这一份被标为已选中，其它的不动。', '点「导入这一份」，这台机器才开始读这份文件。', '读完传到系统，保存成功才算数。']}
              row
            />
            <FileSourceNote>只列<b>最外层</b>的 PDF / JPG / PNG，最多 200 个；超过 15MB 的不列。子文件夹里的东西不在这里。</FileSourceNote>
          </ListCard>
        </>
      )
    }
    case 'usb-selected':
      return (
        <>
          <FileSourceStatus kind="plain" title="选中了这一份，还没导入" chips={[{ label: '这一份只能导入一次' }, { label: '只动这一份' }]}>
            <StatusP><b>只导入这一份</b>，U 盘上其它文件不会被读走，也不会发给任何人。</StatusP>
            <StatusP>点导入之后，这台机器把它读出来传到系统。<b>导入完成前它还不是当前文件。</b></StatusP>
          </FileSourceStatus>
          <ListCard title="准备导入" hint="1 项 · 选中">
            {selectedRow('已选中', 'ok', { on: true })}
            <EmptyBox icon={<UsbIcon size={38} aria-hidden="true" />}>选错了？回列表<b>重选一份</b>就行，<br />这一步还没有任何东西被上传。</EmptyBox>
            <FileSourceSteps title="点「导入这一份」之后" items={['这台机器把它读出来。', '读出来的内容传到系统，校验并保存。', '保存成功，它才成为当前文件。']} row />
          </ListCard>
        </>
      )
    case 'usb-safeid-expired':
      return (
        <>
          <FileSourceStatus kind="warn" title="这一份已经不能再导入" chips={[{ tone: 'warn', label: '这一份已失效' }, { label: '没有文件被导入' }]}>
            <StatusP>刚才读出的这份清单<b>已经过期</b>——超过 10 分钟或重新读过 U 盘，旧清单就不能用了。这是防止选中一份其实已经不在盘上的文件。</StatusP>
            <StatusP><b>没有任何文件被导入。</b>重新读一次盘，在新列表里再选一次就行。</StatusP>
          </FileSourceStatus>
          <ListCard title="失效的这一份" hint="需要重选">
            {selectedRow('已失效', 'bad', { bad: true, dim: true })}
            <EmptyBox icon={<ClockIcon size={38} aria-hidden="true" />}>本机<b>不拿旧列表凑数</b>。<br />重新读盘之后你看到的才是盘上此刻真有的东西。</EmptyBox>
            <FileSourceSteps title="重新读盘之后" items={['这台机器重新列一次最外层的文件。', '新列表里的每份文件都可以重新导入。', '你在新列表里重选一份就行。']} row />
          </ListCard>
        </>
      )
    case 'usb-importing':
      return (
        <>
          <FileSourceStatus kind="info" title="正在从 U 盘导入" pulsing chips={[{ label: '导入中' }, { tone: 'warn', label: '别拔 U 盘' }]}>
            <StatusP>这台机器在把这一份读出来传到系统。<b>没有可确认的中间进度</b>，所以不画百分比，也不说还剩几秒。</StatusP>
            <StatusP><b>这期间不要拔 U 盘。</b>结果出来之前它还不是当前文件。</StatusP>
          </FileSourceStatus>
          <ListCard title="这一份" hint="导入中">
            {selectedRow('导入中', 'doing')}
            <EmptyBox icon={<UploadIcon size={38} aria-hidden="true" />}>系统确认之前，<b>当前文件仍然是空的</b>。<br />这一步不解析内容，也不看页数。</EmptyBox>
            <FileSourceSteps title="导入完成之后" items={['系统确认保存，并带回文件名。', '它成为本次办理的唯一当前文件。', '那时候才可以拔 U 盘。']} row />
          </ListCard>
          <HelpMini onHelp={onHelp} text="导入长时间不结束，先别拔盘，叫工作人员来处理。" />
        </>
      )
    case 'usb-import-failed':
      return (
        <>
          <FileSourceStatus kind="error" title="这一份没导进来" chips={[{ tone: 'bad', label: '导入失败' }, { label: '当前文件仍为空' }]}>
            <StatusP>系统<b>没有确认收到</b>。多半是这份已经不能再导入（重新读过 U 盘），也可能是本机到系统的网络断了。</StatusP>
            <StatusP><b>还没有发起任何解析。</b>重新读一次盘，在新列表里再选一次最稳。</StatusP>
          </FileSourceStatus>
          <ListCard title="这一份" hint="导入失败">
            {selectedRow('导入失败', 'bad', { bad: true })}
            <EmptyBox icon={<AlertTriangleIcon size={38} aria-hidden="true" />}>反复失败的话，把文件<b>拷到手机上扫码传</b>往往更快。</EmptyBox>
            <FileSourceSteps title="重新读盘再选一次" items={['这台机器重新列一次最外层的文件。', '你在新列表里重选一份。', '这样不会撞上已经失效的那一份。']} row />
          </ListCard>
        </>
      )
    default:
      return null
  }
}
