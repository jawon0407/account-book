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
  | "unapproved-request-observer"
  | "unapproved-browser-capability";

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
const locatorMethods = new Set(["click", "fill", "first"]);
const prohibitedCapabilityTypes = new Set(["BrowserContext", "Request", "Route", "APIRequestContext"]);

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
    if (clause === undefined || clause.isTypeOnly || clause.name !== undefined
      || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) {
      add("import", "unapproved-playwright-import");
      return;
    }
    for (const element of clause.namedBindings.elements) {
      const name = element.name.text;
      if (element.propertyName !== undefined || (name !== "test" && name !== "expect" && name !== "Page")
        || (name === "Page" ? !element.isTypeOnly : element.isTypeOnly)) {
        add("import", "unapproved-playwright-import");
      }
    }
    return;
  }
  if (specifier === "@axe-core/playwright" && clause !== undefined && !clause.isTypeOnly && clause.name === undefined
    && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
    && [...clause.namedBindings.elements].every((element) => element.propertyName === undefined
      && element.name.text === "AxeBuilder" && !element.isTypeOnly)) return;
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
  const capabilityNames = new Map<string, BrowserCapabilityKind>([
    ["page", "page"],
    ["context", "context"],
    ["request", "request"],
    ["route", "route"],
  ]);
  const capabilityTypeAliases = new Map<string, BrowserCapabilityKind>();
  const locatorNames = new Set<string>();
  const inspectNode = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && typeMentionsResponse(node.type, typeAliases)) typeAliases.add(node.name.text);
    if (ts.isTypeAliasDeclaration(node)) {
      const capability = browserCapabilityType(node.type, capabilityTypeAliases);
      if (capability !== undefined) capabilityTypeAliases.set(node.name.text, capability);
    }
    if (ts.isVariableDeclaration(node) && node.type !== undefined && typeMentionsResponse(node.type, typeAliases)) {
      bindNames(node.name, responseNames);
      add("response", "response-type");
    }
    if (ts.isParameter(node) && node.type !== undefined && typeMentionsResponse(node.type, typeAliases)) {
      bindNames(node.name, responseNames);
      add("response", "response-type");
    }
    if (ts.isTypeReferenceNode(node) && typeMentionsResponse(node, typeAliases)) add("response", "response-type");
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type !== undefined) {
      const capability = browserCapabilityType(node.type, capabilityTypeAliases);
      if (capability !== undefined) {
        bindCapabilityNames(node.name, capability, capabilityNames);
        add("network", "unapproved-browser-capability");
      }
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
      && (prohibitedCapabilityTypes.has(node.typeName.text) || capabilityTypeAliases.has(node.typeName.text))) {
      add("network", "unapproved-browser-capability");
    }
    if (isFunctionWithReturnType(node) && node.type !== undefined
      && browserCapabilityType(node.type, capabilityTypeAliases) !== undefined) {
      add("network", "unapproved-browser-capability");
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      trackNavigationAlias(node.name, node.initializer, navigationAliases);
      if (isLocatorExpression(node.initializer, locatorNames)) bindNames(node.name, locatorNames);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      trackNavigationAssignmentAlias(node.left, node.right, navigationAliases);
    }
    if ((ts.isVariableDeclaration(node) || ts.isBinaryExpression(node)) && objectBindingFromResponse(node, responseNames)) {
      add("response", "response-consumption");
    }
    if (ts.isIdentifier(node)) {
      inspectBrowserCapabilityIdentifier(node, capabilityNames, add);
      inspectLocatorIdentifier(node, locatorNames, add);
      inspectFetchOrXhrIdentifier(node, add);
      inspectRequestResponseFactoryIdentifier(node, add);
      inspectTrustedConsumerShadow(node, add);
    }
    if (ts.isCallExpression(node)) {
      inspectTestCallbackShape(node, add);
      inspectLocatorExpressionUse(node, locatorNames, add);
      inspectCall(node, responseNames, navigationAliases, inspectNode, add);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "XMLHttpRequest") {
      add("network", "direct-http-client");
    }
    if (ts.isNewExpression(node) && staticMemberName(node.expression) === "XMLHttpRequest") {
      add("network", "direct-http-client");
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      inspectLocatorAccess(node, locatorNames, add);
      inspectTransportMember(node, add);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) inspectResponseMember(node, responseNames, add);
    if (ts.isElementAccessExpression(node) && !ts.isStringLiteral(node.argumentExpression)
      && insidePageEvaluateCallback(node)) add("execution", "dynamic-code");
    ts.forEachChild(node, inspectNode);
  };
  inspectNode(sourceFile);
}

type BrowserCapabilityKind = "page" | "context" | "request" | "route" | "api-request";

/**
 * Narrows function-like syntax that can explicitly mint a capability return.
 * @param node - Candidate syntax node.
 * @returns True for function forms with an inspectable return type.
 */
function isFunctionWithReturnType(
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node);
}

/**
 * Allows only inline Playwright callbacks destructuring exact `page`/`context` fixtures.
 * @param call - Candidate direct `test(title, callback)` call.
 * @param add - Safe fixed finding recorder.
 */
function inspectTestCallbackShape(
  call: ts.CallExpression,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const target = stripExpression(call.expression);
  if (!ts.isIdentifier(target) || target.text !== "test") return;
  const callback = call.arguments[1];
  if (callback === undefined || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    || callback.parameters.length !== 1) {
    add("network", "unapproved-browser-capability");
    return;
  }
  const parameter = callback.parameters[0];
  if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)
    || parameter.dotDotDotToken !== undefined || parameter.questionToken !== undefined
    || parameter.initializer !== undefined || parameter.type !== undefined) {
    add("network", "unapproved-browser-capability");
    return;
  }
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken !== undefined || element.propertyName !== undefined || element.initializer !== undefined
      || !ts.isIdentifier(element.name) || (element.name.text !== "page" && element.name.text !== "context")) {
      add("network", "unapproved-browser-capability");
      return;
    }
  }
}

/**
 * Finds a browser capability type, including a local alias of one.
 * @param type - Candidate type annotation.
 * @param aliases - Browser capability type aliases already declared in this file.
 * @returns The represented capability kind, if any.
 */
function browserCapabilityType(
  type: ts.TypeNode,
  aliases: ReadonlyMap<string, BrowserCapabilityKind>,
): BrowserCapabilityKind | undefined {
  let capability: BrowserCapabilityKind | undefined;
  const visit = (node: ts.Node): void => {
    if (!ts.isIdentifier(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (node.text === "Page") capability = "page";
    else if (node.text === "BrowserContext") capability = "context";
    else if (node.text === "Request") capability = "request";
    else if (node.text === "Route") capability = "route";
    else if (node.text === "APIRequestContext") capability = "api-request";
    else capability ??= aliases.get(node.text);
  };
  visit(type);
  return capability;
}

/**
 * Adds every identifier in a typed binding to the closed capability tracker.
 * @param name - Runtime binding that receives the capability.
 * @param capability - Capability granted by the type annotation.
 * @param names - Mutable capability-name tracker.
 */
function bindCapabilityNames(
  name: ts.BindingName,
  capability: BrowserCapabilityKind,
  names: Map<string, BrowserCapabilityKind>,
): void {
  if (ts.isIdentifier(name)) {
    names.set(name.text, capability);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindCapabilityNames(element.name, capability, names);
  }
}

/**
 * Enforces the closed Page, Context, Request, and Route use allowlist.
 * @param identifier - Candidate tracked capability identifier.
 * @param names - Capability names established syntactically in this file.
 * @param add - Safe fixed finding recorder.
 */
function inspectBrowserCapabilityIdentifier(
  identifier: ts.Identifier,
  names: ReadonlyMap<string, BrowserCapabilityKind>,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (isNonValuePropertyName(identifier)) return;
  const capability = names.get(identifier.text);
  if (capability === undefined) return;
  if (capability === "page" && isAllowedPageUse(identifier)) return;
  if (capability === "context" && isAllowedContextUse(identifier)) return;
  if (capability === "request" && isAuthorizationRecorderIdentifier(identifier)) return;
  if (capability === "page" && isNavigationDestructuringSource(identifier)) {
    add("navigation", "navigation-response");
    return;
  }
  if (capability === "page" && directPropertyName(identifier) !== undefined
    && navigationMethods.has(directPropertyName(identifier) ?? "")) {
    add("navigation", "navigation-response");
    return;
  }
  if (capability === "page" && directPropertyName(identifier) === "request") {
    add("network", "direct-http-client");
    return;
  }
  if (capability === "context" && directPropertyName(identifier) === "request") {
    add("network", "request-context");
    return;
  }
  if (capability === "request" && directPropertyName(identifier) === "response"
    && directCall(identifier, ["response"]) !== undefined) {
    return;
  }
  add("network", "unapproved-browser-capability");
}

/**
 * Checks a direct Page identifier against every approved consumer and method shape.
 * @param identifier - Identifier known syntactically as Page.
 * @returns True only for an explicitly approved Page use.
 */
function isAllowedPageUse(identifier: ts.Identifier): boolean {
  if (isExactTestFixtureBinding(identifier, "page")) return true;
  if (isExactExpectConsumer(identifier)) return true;
  if (isExactAxeBuilderConsumer(identifier)) return true;
  if (isCallApplyBindThisArgument(identifier)) return true;
  if (directCall(identifier, ["locator"]) !== undefined) return true;
  if (directCall(identifier, ["keyboard", "press"]) !== undefined) return true;
  if (directCall(identifier, ["waitForURL"]) !== undefined) return true;
  if (directCall(identifier, ["evaluate"]) !== undefined) return true;
  for (const method of navigationMethods) {
    if (directCall(identifier, [method]) !== undefined) return true;
  }
  for (const method of eventMethods) {
    if (directCall(identifier, [method]) !== undefined) return true;
  }
  for (const method of ["waitForResponse", "waitForEvent", "evaluateHandle", "waitForFunction", "addInitScript", "addScriptTag", "setContent"]) {
    if (directCall(identifier, [method]) !== undefined) return true;
  }
  return false;
}

/**
 * Avoids a duplicate generic finding when a `.call/.apply/.bind` shape is already
 * classified through the Page method expression itself.
 * @param identifier - Candidate Page `this` argument.
 * @returns True when the enclosing call targets another direct Page member.
 */
function isCallApplyBindThisArgument(identifier: ts.Identifier): boolean {
  const call = identifier.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== identifier) return false;
  const adapter = stripExpression(call.expression);
  if (!ts.isPropertyAccessExpression(adapter) || !["call", "apply", "bind"].includes(adapter.name.text)) return false;
  const member = stripExpression(adapter.expression);
  if (!ts.isPropertyAccessExpression(member)) return false;
  const receiver = stripExpression(member.expression);
  return ts.isIdentifier(receiver) && receiver.text === "page";
}

/**
 * Checks a direct Context identifier against its sole approved call and fixture binding.
 * @param identifier - Identifier known syntactically as BrowserContext.
 * @returns True only for exact fixture binding or direct `context.cookies()`.
 */
function isAllowedContextUse(identifier: ts.Identifier): boolean {
  if (isExactTestFixtureBinding(identifier, "context") || directCall(identifier, ["cookies"]) !== undefined) return true;
  for (const method of eventMethods) {
    if (directCall(identifier, [method]) !== undefined) return true;
  }
  return false;
}

/**
 * Classifies direct and assignment object destructuring of Page navigation methods.
 * @param identifier - Candidate Page source.
 * @returns True when Page is the source of a navigation-method object pattern.
 */
function isNavigationDestructuringSource(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === identifier && ts.isObjectBindingPattern(parent.name)) {
    return parent.name.elements.some((element) => {
      const property = element.propertyName ?? element.name;
      return ts.isIdentifier(property) && navigationMethods.has(property.text);
    });
  }
  if (!ts.isBinaryExpression(parent) || parent.right !== identifier || parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const target = stripExpression(parent.left);
  return ts.isObjectLiteralExpression(target) && target.properties.some((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return navigationMethods.has(property.name.text);
    return ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && navigationMethods.has(property.name.text);
  });
}

/**
 * Recognizes an exact non-aliased Playwright test fixture binding.
 * @param identifier - Candidate `page` or `context` binding name.
 * @param name - Required fixture name.
 * @returns True only for the first parameter of a direct `test(title, callback)` callback.
 */
function isExactTestFixtureBinding(identifier: ts.Identifier, name: "page" | "context"): boolean {
  const element = identifier.parent;
  if (!ts.isBindingElement(element) || element.name !== identifier || identifier.text !== name
    || element.propertyName !== undefined || element.dotDotDotToken !== undefined || element.initializer !== undefined) return false;
  const pattern = element.parent;
  const parameter = pattern.parent;
  if (!ts.isObjectBindingPattern(pattern) || !ts.isParameter(parameter) || parameter.name !== pattern) return false;
  const callback = parameter.parent;
  if ((!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || callback.parameters[0] !== parameter) return false;
  const call = callback.parent;
  if (!ts.isCallExpression(call) || call.arguments[1] !== callback) return false;
  const target = stripExpression(call.expression);
  return ts.isIdentifier(target) && target.text === "test";
}

/**
 * Recognizes `expect(page)` without optional calls, aliases, or extra arguments.
 * @param identifier - Candidate Page argument.
 * @returns True only for the exact trusted consumer.
 */
function isExactExpectConsumer(identifier: ts.Identifier): boolean {
  const call = identifier.parent;
  if (!ts.isCallExpression(call) || call.arguments.length !== 1 || call.arguments[0] !== identifier
    || call.questionDotToken !== undefined) return false;
  const target = stripExpression(call.expression);
  return ts.isIdentifier(target) && target.text === "expect";
}

/**
 * Recognizes exactly `new AxeBuilder({ page })`.
 * @param identifier - Candidate shorthand Page property.
 * @returns True only for the exact trusted AxeBuilder construction.
 */
function isExactAxeBuilderConsumer(identifier: ts.Identifier): boolean {
  const property = identifier.parent;
  if (!ts.isShorthandPropertyAssignment(property) || property.name !== identifier
    || property.objectAssignmentInitializer !== undefined) return false;
  const object = property.parent;
  const construct = object.parent;
  if (!ts.isObjectLiteralExpression(object) || object.properties.length !== 1
    || !ts.isNewExpression(construct) || construct.arguments?.length !== 1 || construct.arguments[0] !== object) return false;
  const target = stripExpression(construct.expression);
  return ts.isIdentifier(target) && target.text === "AxeBuilder";
}

/**
 * Returns an exact direct call reached from one root identifier and property path.
 * @param identifier - Required root object identifier.
 * @param members - Required non-optional dot-property path.
 * @returns The direct call expression, if the shape matches exactly.
 */
function directCall(identifier: ts.Identifier, members: readonly string[]): ts.CallExpression | undefined {
  let current: ts.Expression = identifier;
  for (const member of members) {
    const access = current.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== current || access.questionDotToken !== undefined
      || access.name.text !== member) return undefined;
    current = access;
  }
  const call = current.parent;
  return ts.isCallExpression(call) && call.expression === current && call.questionDotToken === undefined ? call : undefined;
}

/**
 * Reads a direct dot-property name from one root identifier.
 * @param identifier - Candidate root identifier.
 * @returns Static member name, excluding optional and computed access.
 */
function directPropertyName(identifier: ts.Identifier): string | undefined {
  const access = identifier.parent;
  return ts.isPropertyAccessExpression(access) && access.expression === identifier
    && access.questionDotToken === undefined ? access.name.text : undefined;
}

/**
 * Excludes syntax positions that spell a property rather than read a value.
 * @param identifier - Candidate identifier.
 * @returns True when it is a non-computed property label.
 */
function isNonValuePropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === identifier)
    || ts.isImportSpecifier(parent)
    || ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent))
      && parent.name === identifier);
}

/**
 * Allows Request identifiers only inside the one recognized recorder callback.
 * @param identifier - Candidate Request parameter or use.
 * @returns True when enclosed by the exact named callback position of `page.on("request", ...)`.
 */
function isAuthorizationRecorderIdentifier(identifier: ts.Identifier): boolean {
  let current: ts.Node | undefined = identifier;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionExpression(current)) {
      const call = current.parent;
      if (!ts.isCallExpression(call) || call.arguments[1] !== current || current.name?.text !== "authorizationRecorder") return false;
      const event = call.arguments[0];
      const target = stripExpression(call.expression);
      return event !== undefined && ts.isStringLiteral(event) && event.text === "request"
        && staticMemberName(target) === "on";
    }
    current = current.parent;
  }
  return false;
}

/**
 * Treats direct fetch/XHR calls as legacy classified findings and rejects every retained alias.
 * @param identifier - Candidate global transport identifier.
 * @param add - Safe fixed finding recorder.
 */
function inspectFetchOrXhrIdentifier(
  identifier: ts.Identifier,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (isNonValuePropertyName(identifier) || (identifier.text !== "fetch" && identifier.text !== "XMLHttpRequest")) return;
  if (identifier.text === "fetch" && ts.isCallExpression(identifier.parent)
    && identifier.parent.expression === identifier && identifier.parent.questionDotToken === undefined) return;
  if (identifier.text === "XMLHttpRequest" && ts.isNewExpression(identifier.parent)
    && identifier.parent.expression === identifier) return;
  add("network", "unapproved-browser-capability");
}

/**
 * Rejects browser Request/Response constructor values while leaving type-only
 * response diagnostics to the existing response policy.
 * @param identifier - Candidate constructor or retained constructor value.
 * @param add - Safe fixed finding recorder.
 */
function inspectRequestResponseFactoryIdentifier(
  identifier: ts.Identifier,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if ((identifier.text !== "Request" && identifier.text !== "Response")
    || isNonValuePropertyName(identifier) || ts.isTypeReferenceNode(identifier.parent)) return;
  add("network", "unapproved-browser-capability");
}

/**
 * Prevents local bindings from impersonating the two trusted Page consumers.
 * @param identifier - Candidate declaration or binding name.
 * @param add - Safe fixed finding recorder.
 */
function inspectTrustedConsumerShadow(
  identifier: ts.Identifier,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (identifier.text !== "test" && identifier.text !== "expect" && identifier.text !== "AxeBuilder") return;
  const parent = identifier.parent;
  if (ts.isImportSpecifier(parent)) {
    if (importSpecifierIsLocal(parent)) add("network", "unapproved-browser-capability");
    return;
  }
  if (identifier.text === "test") {
    if (ts.isCallExpression(parent) && parent.expression === identifier && parent.questionDotToken === undefined) return;
    if (!isNonValuePropertyName(identifier)) add("network", "unapproved-browser-capability");
    return;
  }
  const isBinding = (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === identifier
    || ts.isBindingElement(parent) && parent.name === identifier
    || (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent)
      || ts.isClassExpression(parent)) && parent.name === identifier;
  if (isBinding) add("network", "unapproved-browser-capability");
}

/**
 * Determines whether an import binding came from the inspected local graph.
 * @param specifier - Candidate named import binding.
 * @returns True only for a relative or absolute module specifier.
 */
function importSpecifierIsLocal(specifier: ts.ImportSpecifier): boolean {
  const namedImports = specifier.parent;
  const clause = namedImports.parent;
  const declaration = clause.parent;
  return ts.isImportClause(clause) && ts.isImportDeclaration(declaration)
    && ts.isStringLiteral(declaration.moduleSpecifier) && isLocalSpecifier(declaration.moduleSpecifier.text);
}

/**
 * Determines whether an expression is a Locator produced by the approved Page factory.
 * @param expression - Candidate Locator expression.
 * @param locatorNames - Locator bindings already established in this file.
 * @returns True only for direct `page.locator()` or approved `.first()` composition.
 */
function isLocatorExpression(expression: ts.Expression, locatorNames: ReadonlySet<string>): boolean {
  expression = stripExpression(expression);
  if (ts.isIdentifier(expression)) return locatorNames.has(expression.text);
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined) return false;
  const target = stripExpression(expression.expression);
  if (!ts.isPropertyAccessExpression(target) || target.questionDotToken !== undefined) return false;
  if (target.name.text === "locator") {
    const receiver = stripExpression(target.expression);
    return ts.isIdentifier(receiver) && receiver.text === "page";
  }
  return target.name.text === "first" && isLocatorExpression(target.expression, locatorNames);
}

/**
 * Enforces exact Locator binding, trusted expect consumption, and approved method calls.
 * @param identifier - Candidate tracked Locator identifier.
 * @param locatorNames - Locator bindings established from approved expressions.
 * @param add - Safe fixed finding recorder.
 */
function inspectLocatorIdentifier(
  identifier: ts.Identifier,
  locatorNames: ReadonlySet<string>,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (!locatorNames.has(identifier.text) || isNonValuePropertyName(identifier)) return;
  const declaration = identifier.parent;
  if (ts.isVariableDeclaration(declaration) && declaration.name === identifier
    && declaration.initializer !== undefined && isLocatorExpression(declaration.initializer, locatorNames)) return;
  if (isExactExpectConsumer(identifier)) return;
  for (const method of locatorMethods) {
    if (directCall(identifier, [method]) !== undefined) return;
  }
  add("network", "unapproved-browser-capability");
}

/**
 * Rejects every direct Locator member outside the operations used by the actual UI.
 * @param access - Candidate Locator property access.
 * @param locatorNames - Locator bindings established from approved expressions.
 * @param add - Safe fixed finding recorder.
 */
function inspectLocatorAccess(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  locatorNames: ReadonlySet<string>,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const receiver = stripExpression(access.expression);
  if (!isLocatorExpression(receiver, locatorNames)) return;
  if (!ts.isPropertyAccessExpression(access) || access.questionDotToken !== undefined) {
    add("network", "unapproved-browser-capability");
    return;
  }
  const call = access.parent;
  if (!ts.isCallExpression(call) || call.expression !== access || call.questionDotToken !== undefined
    || !locatorMethods.has(access.name.text)) {
    if (access.name.text === "evaluate" || access.name.text === "evaluateAll") add("execution", "dynamic-code");
    else add("network", "unapproved-browser-capability");
  }
}

/**
 * Rejects retained global fetch/XHR members, including static bracket access.
 * @param access - Candidate member expression.
 * @param add - Safe fixed finding recorder.
 */
function inspectTransportMember(
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  const member = staticMemberName(access);
  if (member !== "fetch" && member !== "XMLHttpRequest") return;
  const chain = memberChain(access);
  if (chain?.[0] === "route") return;
  add("network", "direct-http-client");
}

/**
 * Prevents a Locator factory result from escaping before its operation is checked.
 * @param call - Candidate direct Page Locator or approved Locator composition.
 * @param locatorNames - Locator bindings established from approved expressions.
 * @param add - Safe fixed finding recorder.
 */
function inspectLocatorExpressionUse(
  call: ts.CallExpression,
  locatorNames: ReadonlySet<string>,
  add: (category: UiNetworkBoundaryViolation["category"], capability: UiNetworkCapability) => void,
): void {
  if (!isLocatorExpression(call, locatorNames)) return;
  const parent = call.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === call && ts.isIdentifier(parent.name)) return;
  if (ts.isCallExpression(parent) && parent.arguments.length === 1 && parent.arguments[0] === call) {
    const target = stripExpression(parent.expression);
    if (ts.isIdentifier(target) && target.text === "expect") return;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === call && parent.questionDotToken === undefined) {
    const operation = parent.name.text;
    const operationCall = parent.parent;
    if (ts.isCallExpression(operationCall) && operationCall.expression === parent
      && operationCall.questionDotToken === undefined
      && (locatorMethods.has(operation) || operation === "evaluate" || operation === "evaluateAll")) return;
  }
  add("network", "unapproved-browser-capability");
}

/**
 * Determines whether a node executes inside a direct Page evaluate callback.
 * @param node - Candidate syntax node.
 * @returns True only when enclosed by a function supplied directly to `page.evaluate`.
 */
function insidePageEvaluateCallback(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const call = current.parent;
      return ts.isCallExpression(call) && call.arguments[0] === current && isDirectPageMember(call.expression, "evaluate");
    }
    current = current.parent;
  }
  return false;
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
  if (member === "fetch" && chain[0] !== "route") add("network", "direct-http-client");
  if (member === "eval" || member === "Function") add("execution", "dynamic-code");
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
  if (!isPageReceiver || event.text !== "request" || method !== "on" || call.arguments.length !== 2
    || !isAuthorizationRecorder(call.arguments[1])) {
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
  const callbackParameter = callback.parameters[0];
  const parameter = callbackParameter?.name;
  const statement = callback.body.statements[0];
  if (callback.modifiers !== undefined || callback.asteriskToken !== undefined
    || callback.typeParameters !== undefined || callback.type !== undefined
    || callbackParameter === undefined || parameter === undefined || !ts.isIdentifier(parameter) || parameter.text !== "request"
    || callbackParameter.modifiers !== undefined || callbackParameter.type !== undefined
    || callbackParameter.dotDotDotToken !== undefined || callbackParameter.questionToken !== undefined
    || callbackParameter.initializer !== undefined || callback.parameters.length !== 1
    || callback.body.statements.length !== 1 || statement === undefined || !ts.isExpressionStatement(statement)) return false;
  return isAuthorizationPromiseBoolean(statement.expression, parameter.text);
}

/**
 * Recognizes recording a boolean promise derived directly from the authorization header.
 * @param expression - Candidate recorder expression.
 * @param requestName - Exact request callback parameter name.
 * @returns True only for a push of headerValue(...).then(boolean comparison).
 */
function isAuthorizationPromiseBoolean(expression: ts.Expression, requestName: string): boolean {
  expression = stripExpression(expression);
  const collection = ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
    ? stripExpression(expression.expression.expression) : undefined;
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined
    || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.questionDotToken !== undefined
    || expression.expression.name.text !== "push"
    || collection === undefined || !ts.isIdentifier(collection)
    || collection.text !== "authorizationPresence") return false;
  const promise = expression.arguments[0];
  if (expression.arguments.length !== 1 || promise === undefined || !ts.isCallExpression(promise)
    || promise.questionDotToken !== undefined || !ts.isPropertyAccessExpression(promise.expression)
    || promise.expression.questionDotToken !== undefined || promise.expression.name.text !== "then") return false;
  if (!isAuthorizationHeaderValue(promise.expression.expression, requestName)) return false;
  const callback = promise.arguments[0];
  if (promise.arguments.length !== 1 || callback === undefined || !ts.isArrowFunction(callback)
    || callback.modifiers !== undefined || callback.typeParameters !== undefined || callback.type !== undefined
    || callback.parameters.length !== 1) return false;
  const callbackParameter = callback.parameters[0];
  const value = callbackParameter?.name;
  if (callbackParameter === undefined || value === undefined || !ts.isIdentifier(value)
    || callbackParameter.modifiers !== undefined || callbackParameter.type !== undefined
    || callbackParameter.dotDotDotToken !== undefined || callbackParameter.questionToken !== undefined
    || callbackParameter.initializer !== undefined || ts.isBlock(callback.body)) return false;
  const body = stripExpression(callback.body);
  if (!ts.isBinaryExpression(body)
    || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(body.operatorToken.kind)) return false;
  return isIdentifierAndNull(body.left, body.right, value.text)
    || isIdentifierAndNull(body.right, body.left, value.text);
}

/**
 * Recognizes exactly one callback parameter compared to the null literal.
 * @param identifierSide - Candidate callback parameter operand.
 * @param nullSide - Candidate exact null operand.
 * @param parameterName - Sole promise callback parameter.
 * @returns True only for `parameter <strict-op> null` operand shapes.
 */
function isIdentifierAndNull(
  identifierSide: ts.Expression,
  nullSide: ts.Expression,
  parameterName: string,
): boolean {
  identifierSide = stripExpression(identifierSide);
  nullSide = stripExpression(nullSide);
  return ts.isIdentifier(identifierSide) && identifierSide.text === parameterName
    && nullSide.kind === ts.SyntaxKind.NullKeyword;
}

/**
 * Recognizes a direct authorization header access without accepting other request material.
 * @param expression - Candidate side of an immediate boolean comparison.
 * @param requestName - Exact request callback parameter name.
 * @returns True only for request.headerValue("authorization").
 */
function isAuthorizationHeaderValue(expression: ts.Expression, requestName: string): boolean {
  expression = stripExpression(expression);
  if (!ts.isCallExpression(expression) || expression.questionDotToken !== undefined
    || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.questionDotToken !== undefined) return false;
  const receiver = stripExpression(expression.expression.expression);
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
