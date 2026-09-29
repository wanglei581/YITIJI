// 生成走查用的小 PDF（纯 ASCII 文本，A4，N 页）。用法：node make-pdf.mjs <输出路径> [页数] [标题]
import { writeFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export function makePdf(pages = 1, title = 'WALK K3 TEST MATERIAL') {
  const objs = []
  const add = (s) => { objs.push(s); return objs.length }
  const catalog = add('') // placeholder 1
  const pagesId = add('') // placeholder 2
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = []
  for (let i = 1; i <= pages; i++) {
    const txt = `BT /F1 20 Tf 72 760 Td (${title} - page ${i} of ${pages}) Tj 0 -30 Td (Local walkthrough test data only. Not a real document.) Tj ET`
    const content = add(`<< /Length ${Buffer.byteLength(txt)} >>\nstream\n${txt}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`
  let out = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [p, n = '1', t] = process.argv.slice(2)
  writeFileSync(p, makePdf(Number(n), t))
}
