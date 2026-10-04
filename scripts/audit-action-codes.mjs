// 源码动作全集：字面量、动作常量、审计包装函数与有限模板。新增未识别模板拒绝静默漏检。
import ts from '../services/api/node_modules/typescript/lib/typescript.js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
export function collectAuditActionCodes(root) {
  const codes = new Set()
  function strings(node) {
    if (ts.isStringLiteralLike(node) && /^[a-z][\w]*\.[\w.]+$/.test(node.text)) codes.add(node.text)
    ts.forEachChild(node, strings)
  }
  function scan(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) { scan(file); continue }
      if (!file.endsWith('.ts') || /\.(spec|test)\.ts$/.test(file)) continue
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node) {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'action') strings(node.initializer)
        if (ts.isVariableDeclaration(node) && /ACTION/.test(node.name.getText(source)) && node.initializer) strings(node.initializer)
        if (ts.isCallExpression(node) && /audit/i.test(node.expression.getText(source))) node.arguments.forEach(strings)
        if (ts.isFunctionDeclaration(node) && /auditAction/i.test(node.name?.text ?? '')) strings(node)
        if (ts.isTemplateExpression(node) && node.head.text.includes('.')) {
          if (node.head.text === 'member_data_export.' && node.templateSpans[0]?.expression.getText(source) === 'terminal') {
            const terminalType = source.text.match(/terminal:\s*((?:'[^']+'\s*\|\s*)*'[^']+')/)
            if (!terminalType) throw new Error(`缺少审计终态类型：${file}`)
            for (const match of terminalType[1].matchAll(/'([^']+)'/g)) codes.add(node.head.text + match[1])
          } else if (node.head.text === 'terminal.release_observation_plan.' && node.templateSpans[0]?.expression.getText(source) === 'dto.action') {
            for (const match of source.text.matchAll(/dto\.action === '([^']+)'/g)) codes.add(node.head.text + match[1])
          } else if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name.getText(source) === 'action') {
            throw new Error(`未登记的审计动作模板：${file}: ${node.getText(source)}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  scan(root)
  return [...codes].sort()
}
