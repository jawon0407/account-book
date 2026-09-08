import { realpathSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

export type UiFacadeBoundaryCapability =
  | "boundary-escape"
  | "unsupported-extension"
  | "unapproved-import"
  | "unapproved-top-level"
  | "unapproved-callback"
  | "unapproved-method"
  | "unsafe-argument";

export type UiFacadeBoundaryViolation = Readonly<{
  category: "boundary" | "import" | "syntax" | "capability";
  capability: UiFacadeBoundaryCapability;
}>;

type UiFacadeBoundaryOptions = Readonly<{
  rootDirectory: string;
  rootFile: string;
}>;

const approvedModule = "../support/safe-ui-test.js";
const sourceExtensions = new Set([".ts", ".tsx"]);
const zeroArgumentMethods = new Set([
  "openLogin",
  "assertLoginUsable",
  "assertRejected",
  "assertAuthenticated",
  "assertNoBrowserCredentials",
  "assertNoAuthorizationHeaders",
]);

/**
 * 실제 파일 경로를 해석해 심볼릭 링크 우회를 확인할 기준을 만든다.
 * @param candidate - 검사할 파일 또는 디렉터리 경로다.
 * @returns realpath 결과 또는 해석 실패 시 undefined. 읽기만 하고 파일을 변경하지 않는다.
 */
function canonicalPath(candidate: string): string | undefined {
  try {
    return realpathSync.native(candidate);
  } catch {
    return undefined;
  }
}

/**
 * 상대 경로를 계산해 파일이 루트 디렉터리 내부인지 검사한다.
 * @param directory - 실제 경로로 정규화한 허용 루트다.
 * @param fileName - 실제 경로로 정규화한 검사 대상이다.
 * @returns 같은 경로 또는 부모 밖으로 나가지 않는 하위 경로이면 true다.
 */
function isInside(directory: string, fileName: string): boolean {
  const relative = path.relative(directory, fileName);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/**
 * AST import가 정확한 safe-ui-test 모듈의 authTest 단일 이름 가져오기인지 검사한다.
 * @param statement - TypeScript import 선언 노드다.
 * @returns 별칭·타입 전용·default·추가 바인딩 없는 허용 형태면 true. 코드는 실행하지 않는다.
 */
function isApprovedImport(statement: ts.ImportDeclaration): boolean {
  if (statement.attributes !== undefined
    || !ts.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== approvedModule) {
    return false;
  }
  const clause = statement.importClause;
  const namedBindings = clause?.namedBindings;
  if (clause === undefined
    || clause.isTypeOnly
    || clause.phaseModifier !== undefined
    || clause.name !== undefined
    || namedBindings === undefined
    || !ts.isNamedImports(namedBindings)) {
    return false;
  }
  if (namedBindings.elements.length !== 1) return false;
  const [binding] = namedBindings.elements;
  return binding !== undefined
    && !binding.isTypeOnly
    && binding.propertyName === undefined
    && binding.name.text === "authTest";
}

/**
 * 문장에 export 또는 default modifier가 붙었는지 확인한다.
 * @param statement - 검사할 AST 문장이다.
 * @returns 두 modifier 중 하나가 있으면 true. 문장 AST를 변경하지 않는다.
 */
function hasExportModifier(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false;
  return ts.getModifiers(statement)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
  ) ?? false;
}

/**
 * 민감한 소스 원문 대신 고정 분류만 담은 위반 결과를 만든다.
 * @param category - boundary/import/syntax/capability 중 위반 분류다.
 * @param capability - 허용 목록 기반 상세 위반 코드다.
 * @returns category와 capability를 담은 객체다.
 */
function violation(
  category: UiFacadeBoundaryViolation["category"],
  capability: UiFacadeBoundaryCapability,
): UiFacadeBoundaryViolation {
  return { category, capability };
}

/**
 * optional chaining·타입 인자 없이 고정 식별자를 직접 호출하는지 검사한다.
 * @param expression - 검사할 AST 표현식이다.
 * @param identifier - 기대 호출 이름. 예: authTest다.
 * @returns 기대 직접 호출이면 true이며 CallExpression으로 타입을 좁힌다.
 */
function isDirectCall(expression: ts.Expression, identifier: string): expression is ts.CallExpression {
  return ts.isCallExpression(expression)
    && expression.questionDotToken === undefined
    && expression.typeArguments === undefined
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === identifier;
}

/**
 * 문장이 단순 const 문자열 선언인지 검사하고 이름을 모은다.
 * @param statement - 검사할 최상위 AST 문장이다.
 * @param names - 이미 확인한 이름 집합. 성공한 선언 이름을 여기에 추가한다.
 * @returns 전체 선언이 허용되면 true. 뒤 선언 실패 전 추가된 이름은 되돌리지 않으므로 호출자는 실패 시 검사를 중단한다.
 */
function recordStringConstants(statement: ts.Statement, names: Set<string>): boolean {
  if (!ts.isVariableStatement(statement)
    || statement.modifiers !== undefined
    || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    || statement.declarationList.declarations.length === 0) {
    return false;
  }
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (!ts.isIdentifier(declaration.name)
      || declaration.exclamationToken !== undefined
      || declaration.type !== undefined
      || initializer === undefined
      || !ts.isStringLiteral(initializer)
      || declaration.name.text === "authTest"
      || names.has(declaration.name.text)) {
      return false;
    }
    names.add(declaration.name.text);
  }
  return true;
}

/**
 * callback 매개변수가 정확히 {authUi} 구조 분해 하나인지 검사한다.
 * @param parameter - 타입·초기값·별칭·rest 여부를 검사할 AST 매개변수다.
 * @returns 허용된 단일 바인딩이면 true. 입력 AST를 바꾸지 않는다.
 */
function isApprovedCallbackParameter(parameter: ts.ParameterDeclaration): boolean {
  if (parameter.modifiers !== undefined
    || parameter.dotDotDotToken !== undefined
    || parameter.questionToken !== undefined
    || parameter.type !== undefined
    || parameter.initializer !== undefined
    || !ts.isObjectBindingPattern(parameter.name)
    || parameter.name.elements.length !== 1) {
    return false;
  }
  const [binding] = parameter.name.elements;
  return binding !== undefined
    && binding.dotDotDotToken === undefined
    && binding.propertyName === undefined
    && binding.initializer === undefined
    && ts.isIdentifier(binding.name)
    && binding.name.text === "authUi";
}

/**
 * callback modifier가 async 하나뿐인지 검사한다.
 * @param callback - 화살표 함수 또는 함수 표현식 AST다.
 * @returns async modifier가 정확히 하나이면 true다.
 */
function hasOnlyAsyncModifier(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  return callback.modifiers?.length === 1
    && callback.modifiers[0]?.kind === ts.SyntaxKind.AsyncKeyword;
}

/**
 * callback 문장이 await authUi의 허용 메서드 호출인지 검사한다.
 * @param statement - 테스트 callback 안의 한 문장이다.
 * @param stringConstants - 상위에서 검증한 문자열 const 이름 집합이다.
 * @returns 첫 위반 또는 undefined. submit은 고정 email/password 또는 !wrong 변형만 허용하며 코드를 실행하지 않는다.
 */
function inspectFacadeCall(
  statement: ts.Statement,
  stringConstants: ReadonlySet<string>,
): UiFacadeBoundaryViolation | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) {
    return violation("syntax", "unapproved-callback");
  }
  const call = statement.expression.expression;
  if (!ts.isCallExpression(call)
    || call.questionDotToken !== undefined
    || call.typeArguments !== undefined) {
    return violation("syntax", "unapproved-callback");
  }
  if (!ts.isPropertyAccessExpression(call.expression)
    || call.expression.questionDotToken !== undefined
    || !ts.isIdentifier(call.expression.expression)
    || call.expression.expression.text !== "authUi") {
    return violation("capability", "unapproved-method");
  }

  const method = call.expression.name.text;
  if (zeroArgumentMethods.has(method)) {
    return call.arguments.length === 0
      ? undefined
      : violation("capability", "unsafe-argument");
  }
  if (method !== "submit") return violation("capability", "unapproved-method");
  const [argument] = call.arguments;
  if (call.arguments.length !== 1 || argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return violation("capability", "unsafe-argument");
  }

  const properties = argument.properties;
  if (properties.length !== 2) return violation("capability", "unsafe-argument");
  const [emailProperty, passwordProperty] = properties;
  if (emailProperty === undefined
    || !ts.isShorthandPropertyAssignment(emailProperty)
    || emailProperty.objectAssignmentInitializer !== undefined
    || emailProperty.name.text !== "email"
    || !stringConstants.has("email")
    || passwordProperty === undefined) {
    return violation("capability", "unsafe-argument");
  }
  if (ts.isShorthandPropertyAssignment(passwordProperty)) {
    return passwordProperty.objectAssignmentInitializer === undefined
        && passwordProperty.name.text === "password"
        && stringConstants.has("password")
      ? undefined
      : violation("capability", "unsafe-argument");
  }
  if (!ts.isPropertyAssignment(passwordProperty)
    || !ts.isIdentifier(passwordProperty.name)
    || passwordProperty.name.text !== "password"
    || !stringConstants.has("password")
    || !ts.isTemplateExpression(passwordProperty.initializer)
    || (passwordProperty.initializer.head.rawText
      ?? passwordProperty.initializer.head.text) !== ""
    || passwordProperty.initializer.templateSpans.length !== 1) {
    return violation("capability", "unsafe-argument");
  }
  const [span] = passwordProperty.initializer.templateSpans;
  return span !== undefined
      && ts.isIdentifier(span.expression)
      && span.expression.text === "password"
      && ts.isTemplateTail(span.literal)
      && (span.literal.rawText ?? span.literal.text) === "!wrong"
    ? undefined
    : violation("capability", "unsafe-argument");
}

/**
 * 최상위 authTest 호출의 제목·async callback·fixture·내부 동작을 검사한다.
 * @param statement - 검사할 최상위 AST 문장이다.
 * @param stringConstants - 허용된 합성 입력 const 이름 집합이다.
 * @returns 첫 위반 또는 undefined. 이름 있는 callback·generator·임의 문장은 거부한다.
 */
function inspectAuthTestCall(
  statement: ts.Statement,
  stringConstants: ReadonlySet<string>,
): UiFacadeBoundaryViolation | undefined {
  if (!ts.isExpressionStatement(statement) || !isDirectCall(statement.expression, "authTest")) {
    return violation("syntax", "unapproved-top-level");
  }
  const call = statement.expression;
  const [title, callback] = call.arguments;
  if (call.arguments.length !== 2
    || title === undefined
    || callback === undefined
    || !ts.isStringLiteral(title)) {
    return violation("syntax", "unapproved-callback");
  }
  if ((!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
    || !hasOnlyAsyncModifier(callback)
    || (ts.isFunctionExpression(callback) && (callback.name !== undefined || callback.asteriskToken !== undefined))
    || callback.typeParameters !== undefined
    || callback.type !== undefined
    || callback.parameters.length !== 1
    || !ts.isBlock(callback.body)) {
    return violation("syntax", "unapproved-callback");
  }
  const [parameter] = callback.parameters;
  if (parameter === undefined || !isApprovedCallbackParameter(parameter)) {
    return violation("syntax", "unapproved-callback");
  }

  for (const callbackStatement of callback.body.statements) {
    const finding = inspectFacadeCall(callbackStatement, stringConstants);
    if (finding !== undefined) return finding;
  }
  return undefined;
}

/**
 * 파일 경계·확장자·import·AST를 검사해 UI 테스트의 허용 기능만 남긴다.
 * @param options - rootDirectory는 허용 루트, rootFile은 검사할 TypeScript 소스 파일이다.
 * @returns 첫 위반 하나 또는 빈 배열. 파일 읽기/경로 실패는 고정 boundary 위반으로 반환한다.
 * @remarks 파일을 읽고 AST로 파싱할 뿐 import하거나 테스트를 실행하지 않는다.
 */
export function findUiFacadeBoundaryViolations(
  options: UiFacadeBoundaryOptions,
): readonly UiFacadeBoundaryViolation[] {
  const rootDirectory = canonicalPath(options.rootDirectory);
  const rootFile = canonicalPath(options.rootFile);
  if (rootDirectory === undefined || rootFile === undefined || !isInside(rootDirectory, rootFile)) {
    return [{ category: "boundary", capability: "boundary-escape" }];
  }
  try {
    if (!statSync(rootDirectory).isDirectory() || !statSync(rootFile).isFile()) {
      return [{ category: "boundary", capability: "boundary-escape" }];
    }
  } catch {
    return [{ category: "boundary", capability: "boundary-escape" }];
  }
  if (!sourceExtensions.has(path.extname(rootFile))) {
    return [{ category: "boundary", capability: "unsupported-extension" }];
  }

  let sourceText: string;
  try {
    sourceText = readFileSync(rootFile, "utf8");
  } catch {
    return [{ category: "boundary", capability: "boundary-escape" }];
  }
  const sourceFile = ts.createSourceFile(
    rootFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics !== undefined && parseDiagnostics.length > 0) {
    return [violation("syntax", "unapproved-top-level")];
  }

  let importCount = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      importCount += 1;
      if (importCount !== 1 || !isApprovedImport(statement)) {
        return [{ category: "import", capability: "unapproved-import" }];
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)
      || ts.isExportDeclaration(statement)
      || ts.isExportAssignment(statement)
      || ts.isNamespaceExportDeclaration(statement)
      || hasExportModifier(statement)) {
      return [{ category: "import", capability: "unapproved-import" }];
    }
  }

  if (importCount !== 1) return [violation("import", "unapproved-import")];

  const stringConstants = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      if (!recordStringConstants(statement, stringConstants)) {
        return [violation("syntax", "unapproved-top-level")];
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isVariableStatement(statement)) continue;
    const finding = inspectAuthTestCall(statement, stringConstants);
    if (finding !== undefined) return [finding];
  }

  return [];
}
