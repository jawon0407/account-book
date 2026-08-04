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

function canonicalPath(candidate: string): string | undefined {
  try {
    return realpathSync.native(candidate);
  } catch {
    return undefined;
  }
}

function isInside(directory: string, fileName: string): boolean {
  const relative = path.relative(directory, fileName);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

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

function hasExportModifier(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false;
  return ts.getModifiers(statement)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword
  ) ?? false;
}

function violation(
  category: UiFacadeBoundaryViolation["category"],
  capability: UiFacadeBoundaryCapability,
): UiFacadeBoundaryViolation {
  return { category, capability };
}

function isDirectCall(expression: ts.Expression, identifier: string): expression is ts.CallExpression {
  return ts.isCallExpression(expression)
    && expression.questionDotToken === undefined
    && expression.typeArguments === undefined
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === identifier;
}

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

function hasOnlyAsyncModifier(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  return callback.modifiers?.length === 1
    && callback.modifiers[0]?.kind === ts.SyntaxKind.AsyncKeyword;
}

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
