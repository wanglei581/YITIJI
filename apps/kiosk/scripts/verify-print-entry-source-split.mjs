import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}

const homeServiceGroups = read('src/pages/home/serviceGroups.ts')
const uploadPage = [
  read('src/pages/print/PrintUploadPage.tsx'),
  read('src/pages/print/file-source/FileSourceView.tsx'),
  read('src/pages/print/file-source/FileSourceBits.tsx'),
].join('\n')
const session = read('src/pages/print/printMaterialSession.ts')
const flowPages = [
  'src/pages/print/PrintMaterialCheckPage.tsx',
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
  'src/pages/print/PrintProgressPage.tsx',
  'src/pages/print/PrintDonePage.tsx',
]
const materialCheckPage = read('src/pages/print/PrintMaterialCheckPage.tsx')
const previewPage = read('src/pages/print/PrintPreviewPage.tsx')
const confirmPage = read('src/pages/print/PrintConfirmPage.tsx')

assert(
  /title:\s*'简历打印'[\s\S]*?to:\s*'\/print\/upload\?source=resume'/.test(homeServiceGroups),
  '首页 AI 简历服务的简历打印入口进入 source=resume 打印流',
)

assert(
  /title:\s*'文档打印'[\s\S]*?to:\s*'\/print\/upload\?source=document'/.test(homeServiceGroups),
  '首页打印扫描的文档打印入口进入 source=document 打印流',
)

assert(
  uploadPage.includes("source === 'resume'") &&
    uploadPage.includes('简历打印') &&
    uploadPage.includes('查看我的简历记录') &&
    uploadPage.includes("navigate('/me/resumes')"),
  'PrintUploadPage 根据 source=resume 展示简历打印语义与我的简历记录入口',
)

// 简历打印与文档打印共用三种上传通道；不得再把 source=resume 收成单一「上传简历」Tab。
assert(
  uploadPage.includes('本机选文件') &&
    uploadPage.includes('手机扫码上传') &&
    uploadPage.includes('U 盘导入') &&
    !/isResumePrint\s*\?\s*\[[\s\S]*?key:\s*'file'[\s\S]*?\]\s*:\s*\[/.test(uploadPage),
  'PrintUploadPage 简历打印同样提供本机上传 / 扫码上传 / U盘导入',
)
assert(
  !/KioskPageFrame/.test(uploadPage),
  'PrintUploadPage has left the V6 frame',
)

assert(
  uploadPage.includes("source === 'document'") &&
    uploadPage.includes('文档打印') &&
    uploadPage.includes('通用文档、求职材料或图片'),
  'PrintUploadPage 保留 source=document 的通用文档打印语义',
)

assert(
  session.includes("PrintMaterialSource = 'resume' | 'document'") &&
    session.includes('source?: PrintMaterialSource') &&
    session.includes("source: next.source === 'resume' || next.source === 'document' ? next.source : undefined") &&
    session.includes('printUploadPathForSource'),
  'printMaterialSession（打印交接上下文 v2）支持保存打印来源 source，并集中生成回到上传页的路径',
)

// 2026-09-29 商用收口 P0-5：上传成功只把文件放进本页，不再写打印交接上下文 ——
// 以前上传成功就写，不点「下一步」也留在本机，会被下一位或下一个来源当成「上一份」复水。
// 点「下一步」才整份写（origin: 'upload'，带 source 与 contentCategory），跳转只带交接编号。
const persistStart = uploadPage.indexOf('const persistFile')
const persistBody = uploadPage.slice(persistStart, uploadPage.indexOf('}, [])', persistStart))
assert(
  persistStart >= 0 && persistBody.includes('clearPrintMaterialSession()') && !/startPrint|beginPrintHandoff|savePrintMaterialSession/.test(persistBody),
  'persistFile 上传成功只放进本页并作废旧的打印交接，不提前写交接上下文',
)
const nextStart = uploadPage.indexOf('const handleNext')
const nextBody = uploadPage.slice(nextStart, uploadPage.indexOf('\n  }\n', nextStart))
assert(
  nextStart >= 0 && /startPrint\(\{\s*origin:\s*'upload',\s*file,\s*source,/.test(nextBody) && nextBody.includes('contentCategory: resolveContentCategory(contentCategory, file.mimeType)'),
  '「下一步」整份写打印交接上下文（origin upload，带 source 与内容类别）再进打印台检查',
)
for (const [handler, marker] of [
  ['uploadLocalFile', 'persistFile(nextFile, \'file\')'],
  ['handleQrUploaded', 'persistFile(nextFile, \'qr\')'],
  ['handleUsbImport', 'persistFile(nextFile, \'usb\')'],
]) {
  const start = uploadPage.indexOf(`const ${handler}`)
  const nextTopLevelDecl = uploadPage.indexOf('\n  const ', start + 1)
  const body = uploadPage.slice(start, nextTopLevelDecl === -1 ? undefined : nextTopLevelDecl)
  assert(
    start >= 0 && body.includes(marker),
    `${handler} 上传成功后经 persistFile 放进本页`,
  )
}

// 打印链只从打印交接上下文读 source：跳转带来的临时状态里只有交接编号，
// 登录回跳、返回预览、刷新之后 source 仍在（以前靠 route state 和会话双通道，临时状态一丢就退回上一份）。
assert(
  materialCheckPage.includes('const source = session?.source ?? handoff?.source') &&
    !materialCheckPage.includes('location.state') &&
    previewPage.includes('const source = handoff?.source') &&
    previewPage.includes("navigate('/print/confirm', { state: { printContextId: saved.contextId } })") &&
    confirmPage.includes('const source = handoff?.source') &&
    !/state\?\.(file|params|source|materialCheck)\b/.test(confirmPage),
  '打印流程只从打印交接上下文读 source 与文件身份，跳转只带交接编号',
)

for (const file of flowPages) {
  const source = read(file)
  assert(
    source.includes('printUploadPathForSource') && !source.includes("navigate('/print/upload')"),
    `${file} 返回上传页时保留当前打印来源 source`,
  )
}

console.log('\nALL PASS')
