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

const homePage = read('src/pages/home/HomePage.tsx')
const uploadPage = read('src/pages/print/PrintUploadPage.tsx')
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
  /title:\s*'简历打印'[\s\S]*?to:\s*'\/print\/upload\?source=resume'/.test(homePage),
  '首页 AI 简历服务的简历打印入口进入 source=resume 打印流',
)

assert(
  /title:\s*'文档打印'[\s\S]*?to:\s*'\/print\/upload\?source=document'/.test(homePage),
  '首页打印扫描的文档打印入口进入 source=document 打印流',
)

assert(
  uploadPage.includes("source === 'resume'") &&
    uploadPage.includes('简历打印') &&
    uploadPage.includes('查看我的简历记录') &&
    uploadPage.includes("navigate('/me/resumes')"),
  'PrintUploadPage 根据 source=resume 展示简历打印语义与我的简历记录入口',
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
    session.includes('source: next.source') &&
    session.includes('printUploadPathForSource'),
  'printMaterialSession 支持保存打印来源 source，并集中生成回到上传页的路径',
)

// 上传成功路径现共有三条（本机上传/扫码上传/U盘导入），调用处在 source 之后追加了
// contentCategory 审计字段且 U 盘路径为多行调用，故按 handler 逐一正则断言。
// source 必须是简写属性（后跟 , 或 }），排除 source: undefined 等同名不同值的误匹配。
const saveWithSourcePattern = /savePrintMaterialSession\(\{\s*file:\s*nextFile,\s*source\s*[,}]/
for (const handler of ['handleFileChange', 'handleQrUploaded', 'handleUsbFileSelect']) {
  const start = uploadPage.indexOf(`const ${handler}`)
  const nextTopLevelDecl = uploadPage.indexOf('\n  const ', start + 1)
  const body = uploadPage.slice(start, nextTopLevelDecl === -1 ? undefined : nextTopLevelDecl)
  assert(
    start >= 0 && saveWithSourcePattern.test(body),
    `${handler} 上传成功后把 source 写入当前打印材料 session`,
  )
}

assert(
  uploadPage.includes("navigate('/print/material-check', { state: { file, source } })") &&
    materialCheckPage.includes('source?: PrintMaterialSource') &&
    materialCheckPage.includes('state?.source ?? session?.source') &&
    materialCheckPage.includes("navigate('/print/preview', { state: { file, materialCheck, source } })") &&
    previewPage.includes('source?: PrintMaterialSource') &&
    previewPage.includes('locationState?.source ?? restoredSession?.source') &&
    previewPage.includes("navigate('/print/confirm', { state: { file, params, materialCheck, source } })") &&
    confirmPage.includes('source?: PrintMaterialSource') &&
    confirmPage.includes('state?.source ?? restoredSession?.source'),
  '打印流程通过 route state 和 session 双通道保留 source，支持重试和 session 清理后的回退',
)

for (const file of flowPages) {
  const source = read(file)
  assert(
    source.includes('printUploadPathForSource') && !source.includes("navigate('/print/upload')"),
    `${file} 返回上传页时保留当前打印来源 source`,
  )
}

console.log('\nALL PASS')
