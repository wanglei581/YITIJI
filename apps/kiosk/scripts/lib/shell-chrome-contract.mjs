// 壳层遮蔽契约 —— KioskRoot 什么情况下允许藏掉顶栏/底部导航。
//
// ## 这条断言在防什么
//
// 顶栏带设备状态，底部导航是用户唯一的退出路径。两者被藏掉，用户就可能卡在
// 一个页面里出不去，或者看不到打印机已经离线。所以「藏」必须是逐条列举的
// 决定，不能是某个页面自己能顺手打开的口子。
//
// ## 为什么不再逐字匹配表达式
//
// 原断言是字面量精确匹配 `hideHeader={isCampusZone}`。它确实有牙，但表达的是
// 「当前恰好只有 campus 这一项」，而不是那条规则本身。于是 2026-09-02 新增一条
// 同样合法的 `isQxRoute`（青序流光迁移路由，形状与 isCampusZone 完全一致：本文件内
// 对 pathname 求封闭集合）时，两条门禁直接转红 —— 报的是「正则没匹配上」，
// 不是「你违反了什么」。改断言比改代码更对，但要先证明新断言不是单纯放宽。
//
// ## 现在断言的三件事（缺一即拒）
//
//   1. 整个表达式只由 `||` 连接的**裸标识符**组成
//      → 挡掉 hideHeader={true}、={props.x}、={pathname !== '/'} 这类内联判断
//   2. 每个标识符都在同一文件内声明为 `const X = ...`
//      → 挡掉从外部传进来的布尔
//   3. 每个初始化式是**对 pathname 的封闭集合判定**，只接受四种写法：
//        pathname === '<字面量>'
//        <SET>.has(pathname)          且 SET 必须由字符串字面量数组构造
//        <MAP>.get(pathname)
//        <namedPredicate>(pathname)
//      → 挡掉 `const isAny = pathname.length > 0`、`pathname !== ''` 这类
//        看起来也是"从 pathname 求值"、实际全站命中的写法
//
// 结果：路由集合增删不需要动门禁（那是数据），新增一类遮蔽条件需要动门禁（那是决定）。

/** 只接受这四种「封闭集合判定」写法，其余一律判非法。 */
const CLOSED_MEMBERSHIP_FORMS = [
  { name: 'pathname 等于字面量', re: /^pathname\s*===\s*(['"])[^'"]*\1$/ },
  { name: 'Set.has(pathname)', re: /^([A-Za-z_$][\w$]*)\.has\(\s*pathname\s*\)$/, setRef: 1 },
  { name: 'Map.get(pathname)', re: /^([A-Za-z_$][\w$]*)\.get\(\s*pathname\s*\)$/ },
  { name: '具名路由谓词(pathname)', re: /^[A-Za-z_$][\w$]*\(\s*pathname\s*\)$/ },
]

/** 把 `a || b || c` 拆成 ['a','b','c']；含非裸标识符时返回 null。 */
function splitBareIdentifierDisjuncts(expression) {
  const parts = expression.split('||').map((part) => part.trim())
  if (parts.length === 0) return null
  return parts.every((part) => /^[A-Za-z_$][\w$]*$/.test(part)) ? parts : null
}

/** 取 JSX 属性 `name={...}` 的表达式文本，按花括号配平截取（属性值里可能有嵌套花括号）。 */
export function readJsxBooleanProp(source, propName) {
  const open = source.indexOf(`${propName}={`)
  if (open === -1) return null
  let depth = 0
  const from = open + propName.length + 1
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from + 1, i).trim()
    }
  }
  return null
}

/** 读 `const <name> = <初始化式>`（到行尾），找不到返回 null。 */
function readConstInitializer(source, name) {
  const match = new RegExp(`\\bconst\\s+${name}\\s*=\\s*([^\\n]+)`).exec(source)
  return match ? match[1].trim().replace(/;$/, '') : null
}

/** Set 必须由字符串字面量数组构造，挡掉 `new Set(allRoutes)`。 */
function isStringLiteralSet(source, setName) {
  const match = new RegExp(`\\bconst\\s+${setName}\\s*=\\s*new\\s+Set(?:<[^>]*>)?\\(\\s*\\[([\\s\\S]*?)\\]`).exec(source)
  if (!match) return false
  const members = match[1].split(',').map((m) => m.trim()).filter(Boolean)
  return members.length > 0 && members.every((m) => /^(['"])[^'"]*\1$/.test(m))
}

/**
 * 校验一个壳层遮蔽属性。
 * @returns {{ok: true, disjuncts: string[]} | {ok: false, reason: string}}
 */
export function checkShellChromeProp(source, propName) {
  const expression = readJsxBooleanProp(source, propName)
  if (expression === null) return { ok: false, reason: `找不到 ${propName}={...}` }

  const disjuncts = splitBareIdentifierDisjuncts(expression)
  if (!disjuncts) {
    return {
      ok: false,
      reason: `${propName} 只能由 || 连接的具名条件组成，当前是 \`${expression}\`。`
        + '内联表达式/字面量/外部传入的布尔一律不接受 —— 藏掉顶栏或底部导航必须是逐条列举的决定。',
    }
  }

  for (const name of disjuncts) {
    // 字面量 true/false 在语法上也是"裸标识符"，但它们表达的是"永远藏"或"永远不藏"，
    // 不是任何判定。单独报一句，免得被上面那条 const 提示引去写 `const always = true`。
    if (name === 'true' || name === 'false') {
      return { ok: false, reason: `${propName} 不能是字面量 \`${name}\` —— 遮蔽顶栏或底部导航必须由具体路由条件决定，不能无条件生效。` }
    }
    const initializer = readConstInitializer(source, name)
    if (initializer === null) {
      return { ok: false, reason: `${propName} 用到 \`${name}\`，但它不是本文件内的 const —— 不接受外部传入的遮蔽条件。` }
    }
    const form = CLOSED_MEMBERSHIP_FORMS.find((candidate) => candidate.re.test(initializer))
    if (!form) {
      return {
        ok: false,
        reason: `${propName} 的条件 \`${name}\` 初始化式是 \`${initializer}\`，不是对 pathname 的封闭集合判定。`
          + `只接受：${CLOSED_MEMBERSHIP_FORMS.map((c) => c.name).join('、')}。`,
      }
    }
    if (form.setRef) {
      const setName = form.re.exec(initializer)[form.setRef]
      if (!isStringLiteralSet(source, setName)) {
        return { ok: false, reason: `${propName} 的条件 \`${name}\` 走 ${setName}.has(pathname)，但 ${setName} 不是由字符串字面量数组构造的封闭集合。` }
      }
    }
  }
  return { ok: true, disjuncts }
}
