// 门禁里的 auth 适配器沙箱加载 `src/services/auth/index.ts` 时，它会 require('./secondFactor')。
// 这里把真实的 secondFactor.ts（纯函数，不发请求、不碰存储）转译后交给沙箱，
// 不写替身：门禁跑到的就是线上那份判定逻辑。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

export function loadAuthSecondFactorModule(appRoot = process.cwd()) {
  const source = readFileSync(join(appRoot, 'src/services/auth/secondFactor.ts'), 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: 'auth/secondFactor.ts',
  })
  const module = { exports: {} }
  const context = createContext({
    module,
    exports: module.exports,
    require: (specifier) => {
      throw new Error(`secondFactor.ts 必须保持无依赖，却 require 了 ${specifier}`)
    },
  })
  new Script(transpiled.outputText, { filename: 'auth/secondFactor.js' }).runInContext(context)
  return module.exports
}
