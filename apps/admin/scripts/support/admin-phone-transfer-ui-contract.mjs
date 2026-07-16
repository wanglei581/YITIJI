import ts from 'typescript'

export function parseTsx(source, fileName) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

export function visit(node, callback) {
  callback(node)
  node.forEachChild((child) => visit(child, callback))
}

export function findNamedFunction(sourceFile, name) {
  let match
  visit(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) match = node
  })
  return match
}

export function identifiersIn(node) {
  const names = new Set()
  visit(node, (child) => {
    if (ts.isIdentifier(child)) names.add(child.text)
  })
  return names
}

export function callsNamed(node, name) {
  const calls = []
  visit(node, (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) calls.push(child)
  })
  return calls
}

export function hasPropertyCall(node, owner, name) {
  let found = false
  visit(node, (child) => {
    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
      const target = child.expression
      if (ts.isIdentifier(target.expression) && target.expression.text === owner && target.name.text === name) found = true
    }
  })
  return found
}

export function stringLiteralsIn(node) {
  const values = new Set()
  visit(node, (child) => {
    if (ts.isStringLiteral(child)) values.add(child.text)
  })
  return values
}

export function hasNumericCall(node, name, value) {
  return callsNamed(node, name).some((call) => {
    const argument = call.arguments[0]
    return argument && ts.isNumericLiteral(argument) && Number(argument.text) === value
  })
}

export function useStateBindings(sourceFile) {
  const bindings = new Set()
  visit(sourceFile, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'useState'
    ) {
      const stateName = node.name.elements[0]?.name
      if (stateName && ts.isIdentifier(stateName)) bindings.add(stateName.text)
    }
  })
  return bindings
}

export function jsxTagName(node) {
  return node.tagName.getText()
}

export function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === name,
  )
}

export function jsxAttributeText(attribute) {
  if (!attribute?.initializer) return undefined
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined
}

export function renderedText(node) {
  const parts = []
  visit(node, (child) => {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, ' ').trim()
      if (text) parts.push(text)
    }
    if (ts.isStringLiteral(child)) parts.push(child.text)
  })
  return parts
}

export function hasNegatedIdentifier(node, name) {
  let found = false
  visit(node, (child) => {
    if (
      ts.isPrefixUnaryExpression(child) &&
      child.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(child.operand) &&
      child.operand.text === name
    ) found = true
  })
  return found
}

export function expectRejected(label, assertion) {
  let rejected = false
  try {
    assertion()
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error(`${label} mutation escaped the UI verifier`)
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function unwrapParentheses(node) {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

function isNegatedIdentifierExpression(node, name) {
  const expression = unwrapParentheses(node)
  return (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(expression.operand) &&
    expression.operand.text === name
  )
}

function isPositiveCooldownComparison(node) {
  const expression = unwrapParentheses(node)
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.GreaterThanToken &&
    ts.isIdentifier(unwrapParentheses(expression.left)) &&
    unwrapParentheses(expression.left).text === 'cooldownSeconds' &&
    ts.isNumericLiteral(unwrapParentheses(expression.right)) &&
    Number(unwrapParentheses(expression.right).text) === 0
  )
}

function disabledDuringActiveCooldown(node) {
  const expression = unwrapParentheses(node)
  if (isPositiveCooldownComparison(expression)) return true
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
    (disabledDuringActiveCooldown(expression.left) || disabledDuringActiveCooldown(expression.right))
  )
}

function isActiveUnknownStartCooldown(node) {
  const expression = unwrapParentheses(node)
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
    return false
  }
  const left = unwrapParentheses(expression.left)
  const right = unwrapParentheses(expression.right)
  return (
    (isNegatedIdentifierExpression(left, 'bindTicket') && isPositiveCooldownComparison(right)) ||
    (isPositiveCooldownComparison(left) && isNegatedIdentifierExpression(right, 'bindTicket'))
  )
}

export function verifyCooldownReturnContract(componentSource) {
  const sourceFile = parseTsx(componentSource, 'AdminPhoneTransferCard.tsx')
  const component = findNamedFunction(sourceFile, 'AdminPhoneTransferCard')
  const returnToInitialBind = findNamedFunction(sourceFile, 'returnToInitialBind')
  expect(component && returnToInitialBind, 'missing transfer component or return handler')

  const backButtons = []
  visit(component, (node) => {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement) === 'Button') {
      if (renderedText(node).includes('返回首次绑定')) backButtons.push(node.openingElement)
    }
  })
  expect(backButtons.length === 2, 'identity and confirmation states each need one return button')
  const cooldownButtons = backButtons.filter((button) => {
    const disabled = jsxAttribute(button, 'disabled')?.initializer?.expression
    return disabled && identifiersIn(disabled).has('cooldownSeconds')
  })
  expect(cooldownButtons.length === 1, 'only the identity return button must honor the unknown-start cooldown')
  const cooldownDisabled = jsxAttribute(cooldownButtons[0], 'disabled')?.initializer?.expression
  expect(
    cooldownDisabled && disabledDuringActiveCooldown(cooldownDisabled),
    'identity return button must be disabled when cooldownSeconds > 0',
  )

  let cooldownGuard
  const noTicketReturns = []
  visit(returnToInitialBind, (node) => {
    if (!ts.isIfStatement(node) || !hasNegatedIdentifier(node.expression, 'bindTicket')) return
    if (isActiveUnknownStartCooldown(node.expression)) cooldownGuard = node
    if (callsNamed(node.thenStatement, 'onBack').length > 0) noTicketReturns.push(node)
  })
  expect(cooldownGuard, 'return handler must guard !bindTicket && cooldownSeconds > 0')
  expect(callsNamed(cooldownGuard.thenStatement, 'onBack').length === 0, 'cooldown guard must not switch modes')
  expect(callsNamed(cooldownGuard.thenStatement, 'clearTransferState').length === 0, 'cooldown guard must not clear cooldown state')
  expect(callsNamed(cooldownGuard.thenStatement, 'cancelAdminPhoneTransfer').length === 0, 'no-ticket cooldown must not fake remote cancel')
  expect(noTicketReturns.length > 0, 'after cooldown expiry the no-ticket branch must allow returning')
  expect(
    noTicketReturns.every((branch) => cooldownGuard.getStart() < branch.getStart()),
    'cooldown guard must run before every no-ticket branch that switches modes',
  )
  const cancelCall = callsNamed(returnToInitialBind, 'cancelAdminPhoneTransfer')[0]
  expect(
    cancelCall && noTicketReturns.every((branch) => branch.getEnd() < cancelCall.getStart()),
    'no-ticket return must occur without a remote cancel',
  )
}

export function verifyUnavailableRestartContract(componentSource) {
  const sourceFile = parseTsx(componentSource, 'AdminPhoneTransferCard.tsx')
  const verifyCode = findNamedFunction(sourceFile, 'verifyCode')
  expect(verifyCode, 'missing verifyCode handler')
  let unavailableBranch
  visit(verifyCode, (node) => {
    if (!ts.isIfStatement(node)) return
    if (stringLiteralsIn(node.expression).has('AUTH_PHONE_TRANSFER_UNAVAILABLE')) unavailableBranch = node
  })
  expect(unavailableBranch, 'verify must handle AUTH_PHONE_TRANSFER_UNAVAILABLE explicitly')
  expect(callsNamed(unavailableBranch.thenStatement, 'clearTransferState').length === 1, 'changed state must invalidate the current ticket')
  const messages = stringLiteralsIn(unavailableBranch.thenStatement)
  expect([...messages].some((message) => message.includes('状态已变化，请重新开始')), 'changed state message must contain 状态已变化，请重新开始')
}
