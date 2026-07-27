import { existsSync, realpathSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export type UiNetworkCapability =
  | "boundary-escape"
  | "unsupported-extension"
  | "dynamic-import"
  | "unapproved-external-import"
  | "unapproved-playwright-import"
  | "direct-http-client"
  | "response-type"
  | "response-consumption"
  | "http-status"
  | "response-event"
  | "request-response"
  | "request-context"
  | "dynamic-code"
  | "script-injection"
  | "navigation-response"
  | "unapproved-request-observer";

export type UiNetworkBoundaryViolation = Readonly<{
  category: "boundary" | "import" | "network" | "response" | "event" | "execution" | "navigation";
  capability: UiNetworkCapability;
}>;

export type UiNetworkBoundaryOptions = Readonly<{
  rootDirectory: string;
  rootFile: string;
}>;

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const responseMembers = new Set(["json", "text", "arrayBuffer", "blob", "bytes", "formData", "body"]);
const eventMethods = new Set(["on", "once", "addListener", "prependListener", "prependOnceListener"]);
const navigationMethods = new Set(["goto", "reload", "goBack", "goForward"]);

/**
 * Walks a UI-only static module graph and returns stable, source-safe policy findings.
 * @param options - Canonical UI root directory and the entry file to inspect.
 * @returns Deduplicated category/capability findings ordered by category then capability.
 */
export function findUiNetworkBoundaryViolations(
  options: UiNetworkBoundaryOptions,
): readonly UiNetworkBoundaryViolation[] {
  const findings = new Map<string, UiNetworkBoundaryViolation>();
  const add = (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability): void => {
    findings.set(`${category}\0${capability}`, { category, capability });
  };
  const rootDirectory = canonicalPath(options.rootDirectory);
  const rootFile = canonicalPath(options.rootFile);
  if (rootDirectory === undefined || rootFile === undefined || !inside(rootDirectory, rootFile)) {
    add("boundary", "boundary-escape");
    return ordered(findings);
  }
  if (!sourceExtensions.has(path.extname(rootFile).toLowerCase())) {
    add("boundary", "unsupported-extension");
    return ordered(findings);
  }

  const visited = new Set<string>();
  /** Inspects one canonical local source file at most once. */
  const inspectFile = (fileName: string): void => {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    let sourceText: string;
    try {
      sourceText = readFileSync(fileName, "utf8");
    } catch {
      add("boundary", "boundary-escape");
      return;
    }
    const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
    const localModules = new Map<string, string>();
    for (const statement of sourceFile.statements) {
      if (ts.isImportEqualsDeclaration(statement)) {
        add("import", "dynamic-import");
        continue;
      }
      if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
        const specifier = statement.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier)) {
          add("import", "dynamic-import");
          continue;
        }
        inspectModuleSpecifier(statement, specifier.text, fileName, rootDirectory, localModules, inspectFile, add);
      }
    }
    inspectSyntax(sourceFile, add);
  };
  inspectFile(rootFile);
  return ordered(findings);
}

/**
 * Canonicalizes an existing path without throwing so all root checks are reparse-point safe.
 * @param candidate - File-system path supplied by the caller or resolver.
 * @returns Native real path, or undefined when it cannot be resolved.
 */
function canonicalPath(candidate: string): string | undefined {
  try {
    return realpathSync.native(candidate);
  } catch {
    return undefined;
  }
}

/**
 * Checks canonical child ownership without accepting a sibling path prefix.
 * @param directory - Canonical UI root directory.
 * @param fileName - Canonical candidate file path.
 * @returns True only when the candidate is inside the UI root.
 */
function inside(directory: string, fileName: string): boolean {
  const relative = path.relative(directory, fileName);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Resolves and scans one static import or export without returning its source text.
 * @param statement - Import/export AST node owning the module specifier.
 * @param specifier - Static module path.
 * @param fromFile - Canonical local importer path.
 * @param rootDirectory - Canonical UI source boundary.
 * @param localModules - Cache of resolved local edges for this source.
 * @param inspectFile - Recursive local graph visitor.
 * @param add - Safe fixed finding recorder.
 */
function inspectModuleSpecifier(
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
  specifier: string,
  fromFile: string,
  rootDirectory: string,
  localModules: Map<string, string>,
  inspectFile: (fileName: string) => void,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (!isLocalSpecifier(specifier)) {
    inspectExternalImport(statement, specifier, add);
    return;
  }
  if (path.extname(specifier) !== "" && !sourceExtensions.has(path.extname(specifier).toLowerCase())) {
    add("boundary", "unsupported-extension");
    return;
  }
  const target = localModules.get(specifier) ?? resolveLocalModule(fromFile, specifier);
  if (target === undefined || !inside(rootDirectory, target)) {
    add("boundary", "boundary-escape");
    return;
  }
  if (!sourceExtensions.has(path.extname(target).toLowerCase())) {
    add("boundary", "unsupported-extension");
    return;
  }
  localModules.set(specifier, target);
  inspectFile(target);
}

/**
 * Determines whether an import specifier is a local graph edge.
 * @param specifier - Static ESM module specifier.
 * @returns True for relative or absolute file-system specifiers.
 */
function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || path.isAbsolute(specifier);
}

/**
 * Resolves TypeScript source candidates for one local import, including emitted JS specifiers.
 * @param fromFile - Canonical importing source file.
 * @param specifier - Relative or absolute static import path.
 * @returns Canonical local source target, or undefined when unresolved.
 */
function resolveLocalModule(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const extension = path.extname(base).toLowerCase();
  if (extension !== "" && !sourceExtensions.has(extension)) return existsSync(base) ? canonicalPath(base) : undefined;
  const candidates = extension === ""
    ? [...sourceExtensions].flatMap((suffix) => [`${base}${suffix}`, path.join(base, `index${suffix}`)])
    : [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((suffix) => `${base.slice(0, -extension.length)}${suffix}`)];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const canonical = canonicalPath(candidate);
    if (canonical !== undefined) return canonical;
  }
  return undefined;
}

/**
 * Applies the narrow external import allowlist to one import or re-export declaration.
 * @param statement - Static import/export declaration.
 * @param specifier - External package specifier.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectExternalImport(
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
  specifier: string,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (!ts.isImportDeclaration(statement)) {
    add("import", "unapproved-external-import");
    return;
  }
  const clause = statement.importClause;
  if (specifier === "@playwright/test") {
    if (clause === undefined || clause.name !== undefined || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
      add("import", "unapproved-playwright-import");
      return;
    }
    for (const element of clause.namedBindings.elements) {
      const name = element.name.text;
      if ((name !== "test" && name !== "expect" && name !== "Page") || (name === "Page" && !element.isTypeOnly)) {
        add("import", "unapproved-playwright-import");
      }
    }
    return;
  }
  if (specifier === "@axe-core/playwright" && clause !== undefined && clause.name === undefined
    && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
    && [...clause.namedBindings.elements].every((element) => element.name.text === "AxeBuilder" && !element.isTypeOnly)) return;
  add("import", "unapproved-external-import");
}

/**
 * Visits source syntax with conservative response, event, execution, and navigation policies.
 * @param sourceFile - Parsed local UI source file.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectSyntax(
  sourceFile: ts.SourceFile,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const responseNames = new Set<string>();
  const navigationAliases = new Set<string>();
  const typeAliases = new Set<string>();
  const inspectNode = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && typeMentionsResponse(node.type, typeAliases)) typeAliases.add(node.name.text);
    if (ts.isVariableDeclaration(node) && node.type !== undefined && typeMentionsResponse(node.type, typeAliases)) {
      bindNames(node.name, responseNames);
      add("response", "response-type");
    }
    if (ts.isParameter(node) && node.type !== undefined && typeMentionsResponse(node.type, typeAliases)) {
      bindNames(node.name, responseNames);
      add("response", "response-type");
    }
    if (ts.isTypeReferenceNode(node) && typeMentionsResponse(node, typeAliases)) add("response", "response-type");
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      trackNavigationAlias(node.name, node.initializer, navigationAliases);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      trackNavigationAssignmentAlias(node.left, node.right, navigationAliases);
    }
    if ((ts.isVariableDeclaration(node) || ts.isBinaryExpression(node)) && objectBindingFromResponse(node, responseNames)) {
      add("response", "response-consumption");
    }
    if (ts.isCallExpression(node)) inspectCall(node, responseNames, navigationAliases, inspectNode, add);
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "XMLHttpRequest") {
      add("network", "direct-http-client");
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) inspectResponseMember(node, responseNames, add);
    ts.forEachChild(node, inspectNode);
  };
  inspectNode(sourceFile);
}

/**
 * Determines whether a type syntax references a response ownership type or prior alias.
 * @param type - Type syntax to inspect.
 * @param aliases - Locally declared response aliases.
 * @returns True when the syntax grants response/body capabilities.
 */
function typeMentionsResponse(type: ts.TypeNode, aliases: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === "Response" || node.text === "APIResponse" || node.text === "Body" || aliases.has(node.text))) found = true;
    ts.forEachChild(node, visit);
  };
  visit(type);
  return found;
}

/**
 * Adds identifiers from a binding name to a mutable capability-tracking set.
 * @param name - Identifier or nested object/array binding pattern.
 * @param names - Capability-tracking identifier set.
 * @returns Nothing.
 */
function bindNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindNames(element.name, names);
  }
}

/**
 * Tracks every local alias derived from a Page navigation method so aliases cannot retain a response.
 * @param name - Binding receiving a direct, destructured, or transitive navigation method alias.
 * @param initializer - Expression that supplies the navigation method.
 * @param aliases - Navigation method aliases accumulated for this local source file.
 * @returns Nothing.
 */
function trackNavigationAlias(
  name: ts.BindingName,
  initializer: ts.Expression,
  aliases: Set<string>,
): void {
  const source = stripExpression(initializer);
  if (ts.isIdentifier(name) && ts.isIdentifier(source) && aliases.has(source.text)) {
    aliases.add(name.text);
    return;
  }
  if (ts.isIdentifier(name) && ts.isPropertyAccessExpression(source)
    && navigationMethods.has(source.name.text)) {
    const receiver = stripExpression(source.expression);
    if (!ts.isIdentifier(receiver) || receiver.text !== "page") return;
    aliases.add(name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(name) || !ts.isIdentifier(source) || source.text !== "page") return;
  for (const element of name.elements) {
    if (element.dotDotDotToken !== undefined) continue;
    const property = element.propertyName ?? element.name;
    if (ts.isIdentifier(property) && navigationMethods.has(property.text)) bindNames(element.name, aliases);
  }
}

/**
 * Tracks navigation methods acquired through an object-destructuring assignment from Page.
 * @param left - Assignment target, including an optional parenthesized object pattern.
 * @param right - Assignment source expression.
 * @param aliases - Navigation method aliases accumulated for this local source file.
 * @returns Nothing.
 */
function trackNavigationAssignmentAlias(
  left: ts.Expression,
  right: ts.Expression,
  aliases: Set<string>,
): void {
  const target = stripExpression(left);
  const source = stripExpression(right);
  if (!ts.isObjectLiteralExpression(target) || !ts.isIdentifier(source) || source.text !== "page") return;
  for (const property of target.properties) {
    if (ts.isShorthandPropertyAssignment(property) && navigationMethods.has(property.name.text)) aliases.add(property.name.text);
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && navigationMethods.has(property.name.text)) {
      const alias = stripExpression(property.initializer);
      if (ts.isIdentifier(alias)) aliases.add(alias.text);
    }
  }
}

/**
 * Recognizes object destructuring from a tracked response value, including assignment patterns.
 * @param node - Candidate variable declaration or assignment expression.
 * @param responseNames - Tracked response identifiers.
 * @returns True when a response member was destructured.
 */
function objectBindingFromResponse(node: ts.VariableDeclaration | ts.BinaryExpression, responseNames: ReadonlySet<string>): boolean {
  const left = ts.isVariableDeclaration(node) ? node.name : node.left;
  const right = ts.isVariableDeclaration(node) ? node.initializer : node.right;
  const binding = ts.isParenthesizedExpression(left) ? left.expression : left;
  if (right === undefined || (!ts.isObjectBindingPattern(binding) && !ts.isObjectLiteralExpression(binding))) return false;
  const receiver = stripExpression(right);
  return ts.isIdentifier(receiver) && responseNames.has(receiver.text);
}

/**
 * Removes transparent syntax wrappers before identifier/property checks.
 * @param expression - Source expression with optional assertion/parenthesis wrappers.
 * @returns The underlying expression.
 */
function stripExpression(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

/**
 * Applies direct-call policies that do not require TypeScript provenance diagnostics.
 * @param call - Call expression to classify.
 * @param responseNames - Tracked response identifiers.
 * @param navigationAliases - Names bound from navigation methods.
 * @param inspectNode - Full local policy visitor used for function evaluation bodies.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectCall(
  call: ts.CallExpression,
  responseNames: ReadonlySet<string>,
  navigationAliases: ReadonlySet<string>,
  inspectNode: (node: ts.Node) => void,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const expression = stripExpression(call.expression);
  if (ts.isIdentifier(expression)) {
    if (expression.text === "fetch") add("network", "direct-http-client");
    if (expression.text === "require") add("import", "dynamic-import");
    if (expression.text === "eval" || expression.text === "Function") add("execution", "dynamic-code");
    if (navigationAliases.has(expression.text)) add("navigation", "navigation-response");
  }
  if (expression.kind === ts.SyntaxKind.ImportKeyword) add("import", "dynamic-import");
  if (ts.isNewExpression(call.parent) && ts.isIdentifier(call.parent.expression) && call.parent.expression.text === "XMLHttpRequest") {
    add("network", "direct-http-client");
  }
  if (staticMemberName(expression) === "evaluate" && !isDirectPageMember(expression, "evaluate")) {
    add("execution", "dynamic-code");
  }
  const chain = memberChain(expression);
  if (chain === undefined) return;
  const member = chain.at(-1);
  const receiver = chain.at(-2);
  if (member === "response" && chain[0] === "request") add("response", "request-response");
  if (chain.includes("request") && chain[0] === "page") add("network", "direct-http-client");
  if (chain.includes("request") && chain[0] === "context") add("network", "request-context");
  if (member === "waitForResponse" || member === "waitForEvent") add("response", "response-event");
  if (member !== undefined && eventMethods.has(member)) inspectEventCall(call, member, chain[0] === "page", add);
  if (member === "evaluate") {
    if (chain.length !== 2 || chain[0] !== "page") add("execution", "dynamic-code");
    else inspectEvaluate(call, inspectNode, add);
  }
  if (member !== undefined && ["evaluateHandle", "waitForFunction"].includes(member)) add("execution", "dynamic-code");
  if (member !== undefined && ["addInitScript", "addScriptTag", "setContent"].includes(member)) add("execution", "script-injection");
  if (member !== undefined && navigationMethods.has(member) && !isDiscardedAwait(call)) add("navigation", "navigation-response");
  if (receiver !== undefined && responseNames.has(receiver) && member !== undefined && responseMembers.has(member)) add("response", "response-consumption");
  if (receiver !== undefined && responseNames.has(receiver) && member === "status") add("response", "http-status");
}

/**
 * Extracts a static identifier/property chain from property syntax.
 * @param expression - Candidate property or element access expression.
 * @returns Identifier/property segments when statically known, otherwise undefined.
 */
function memberChain(expression: ts.Expression): readonly string[] | undefined {
  expression = stripExpression(expression);
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = memberChain(expression.expression);
    return receiver === undefined ? undefined : [...receiver, expression.name.text];
  }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    const receiver = memberChain(expression.expression);
    return receiver === undefined ? undefined : [...receiver, expression.argumentExpression.text];
  }
  return undefined;
}

/**
 * Reads the final static member name even when its receiver is a call chain.
 * @param expression - Candidate call target.
 * @returns The final property name, or undefined for computed/dynamic targets.
 */
function staticMemberName(expression: ts.Expression): string | undefined {
  expression = stripExpression(expression);
  return ts.isPropertyAccessExpression(expression) ? expression.name.text
    : ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text
      : undefined;
}

/**
 * Checks that a sensitive browser execution API is called directly on Page.
 * @param expression - Candidate call target.
 * @param name - Required API member name.
 * @returns True only for the direct `page.<name>` form.
 */
function isDirectPageMember(expression: ts.Expression, name: string): boolean {
  expression = stripExpression(expression);
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== name) return false;
  const receiver = stripExpression(expression.expression);
  return ts.isIdentifier(receiver) && receiver.text === "page";
}

/**
 * Flags direct response member access, including optional, bracket, and unbounded computed forms.
 * @param access - Property or element access expression.
 * @param responseNames - Tracked response identifiers.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectResponseMember(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  responseNames: ReadonlySet<string>,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const receiver = stripExpression(access.expression);
  if (!ts.isIdentifier(receiver) || !responseNames.has(receiver.text)) return;
  const name = ts.isPropertyAccessExpression(access)
    ? access.name.text
    : ts.isStringLiteral(access.argumentExpression) ? access.argumentExpression.text : undefined;
  if (name === undefined || responseMembers.has(name)) add("response", "response-consumption");
  if (name === "status") add("response", "http-status");
}

/**
 * Allows only the exact named authorization recorder request observer.
 * @param call - Event registration call.
 * @param method - Static event listener method name.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectEventCall(
  call: ts.CallExpression,
  method: string,
  isPageReceiver: boolean,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const event = call.arguments[0];
  if (event === undefined || !ts.isStringLiteral(event)) {
    add("event", "unapproved-request-observer");
    return;
  }
  if (event.text === "response") {
    add("event", "response-event");
    return;
  }
  if (!isPageReceiver || event.text !== "request" || method !== "on" || !isAuthorizationRecorder(call.arguments[1])) {
    add("event", "unapproved-request-observer");
  }
}

/**
 * Verifies the sole accepted request observer's exact named function shape.
 * @param callback - Second listener argument.
 * @returns True only for the authorization header boolean recorder.
 */
function isAuthorizationRecorder(callback: ts.Expression | undefined): boolean {
  if (callback === undefined || !ts.isFunctionExpression(callback) || callback.name?.text !== "authorizationRecorder") return false;
  const parameter = callback.parameters[0]?.name;
  const statement = callback.body.statements[0];
  if (parameter === undefined || !ts.isIdentifier(parameter) || callback.parameters.length !== 1 || callback.body.statements.length !== 1 || statement === undefined) return false;
  const expression = ts.isReturnStatement(statement) ? statement.expression : ts.isExpressionStatement(statement) ? statement.expression : undefined;
  return expression !== undefined && (isAuthorizationBoolean(expression, parameter.text) || isAuthorizationPromiseBoolean(expression, parameter.text));
}

/**
 * Recognizes an immediate boolean comparison of the authorization header.
 * @param expression - Candidate recorder expression.
 * @param requestName - Exact request callback parameter name.
 * @returns True only when header access is immediately reduced to a boolean.
 */
function isAuthorizationBoolean(expression: ts.Expression, requestName: string): boolean {
  if (!ts.isBinaryExpression(expression)) return false;
  if (![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) return false;
  return isAuthorizationHeaderValue(expression.left, requestName) || isAuthorizationHeaderValue(expression.right, requestName);
}

/**
 * Recognizes recording a boolean promise derived directly from the authorization header.
 * @param expression - Candidate recorder expression.
 * @param requestName - Exact request callback parameter name.
 * @returns True only for a push of headerValue(...).then(boolean comparison).
 */
function isAuthorizationPromiseBoolean(expression: ts.Expression, requestName: string): boolean {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== "push") return false;
  const promise = expression.arguments[0];
  if (expression.arguments.length !== 1 || promise === undefined || !ts.isCallExpression(promise)
    || !ts.isPropertyAccessExpression(promise.expression) || promise.expression.name.text !== "then") return false;
  if (!isAuthorizationHeaderValue(promise.expression.expression, requestName)) return false;
  const callback = promise.arguments[0];
  if (promise.arguments.length !== 1 || callback === undefined || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || callback.parameters.length !== 1) return false;
  const value = callback.parameters[0]?.name;
  if (value === undefined || !ts.isIdentifier(value)) return false;
  const body = callback.body;
  return ts.isBinaryExpression(body) && (ts.isIdentifier(body.left) && body.left.text === value.text || ts.isIdentifier(body.right) && body.right.text === value.text);
}

/**
 * Recognizes a direct authorization header access without accepting other request material.
 * @param expression - Candidate side of an immediate boolean comparison.
 * @param requestName - Exact request callback parameter name.
 * @returns True only for request.headerValue("authorization").
 */
function isAuthorizationHeaderValue(expression: ts.Expression, requestName: string): boolean {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return false;
  const receiver = expression.expression.expression;
  const headerName = expression.arguments[0];
  return expression.expression.name.text === "headerValue" && ts.isIdentifier(receiver) && receiver.text === requestName
    && expression.arguments.length === 1 && headerName !== undefined && ts.isStringLiteral(headerName) && headerName.text === "authorization";
}

/**
 * Inspects function evaluation bodies with the same AST visitor as local UI source.
 * @param call - Page evaluation call.
 * @param inspectNode - Full local policy visitor supplied by the enclosing source inspection.
 * @param add - Safe fixed finding recorder.
 * @returns Nothing.
 */
function inspectEvaluate(
  call: ts.CallExpression,
  inspectNode: (node: ts.Node) => void,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const callback = call.arguments[0];
  if (callback === undefined || ts.isStringLiteral(callback)) {
    add("execution", "dynamic-code");
    return;
  }
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    add("execution", "dynamic-code");
    return;
  }
  inspectNode(callback.body);
}

/**
 * Checks the only approved navigation form: directly awaited and discarded as a statement.
 * @param call - Navigation method invocation.
 * @returns True when its response cannot be observed or propagated.
 */
function isDiscardedAwait(call: ts.CallExpression): boolean {
  return ts.isAwaitExpression(call.parent) && ts.isExpressionStatement(call.parent.parent);
}

/**
 * Orders safe diagnostic labels deterministically without retaining source-derived strings.
 * @param findings - Deduplicated fixed findings.
 * @returns Sorted immutable policy finding array.
 */
function ordered(findings: ReadonlyMap<string, UiNetworkBoundaryViolation>): readonly UiNetworkBoundaryViolation[] {
  return [...findings.values()].sort((left, right) => left.category.localeCompare(right.category) || left.capability.localeCompare(right.capability));
}
