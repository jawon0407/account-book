import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const domResponseBodyMethods = ["json", "text", "arrayBuffer", "blob", "bytes", "formData"] as const;
const playwrightResponseBodyMethods = ["json", "text", "body"] as const;
type ResponseBodyMethod =
  | (typeof domResponseBodyMethods)[number]
  | (typeof playwrightResponseBodyMethods)[number];
type ResponseBodyDiagnosticMethod = ResponseBodyMethod | "computed";

export type ResponseBodyUse = Readonly<{
  category: "consumption" | "stream";
  method: ResponseBodyDiagnosticMethod;
}>;

type ResponseProvenance = Readonly<{
  dom: boolean;
  playwright: boolean;
}>;

type ResponseMemberAccess = Readonly<{
  propertyNames: readonly string[] | undefined;
  receiver: ts.Expression;
}>;

const compilerOptions: ts.CompilerOptions = {
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2023,
};

/**
 * Analyzes an in-memory TypeScript fixture without returning source or response values.
 * @param sourceText - Synthetic source used to pressure-test the ownership policy.
 * @returns Deduplicated fixed categories and method names for forbidden body use.
 */
export function findResponseBodyUses(sourceText: string): readonly ResponseBodyUse[] {
  const fileName = path.join(path.dirname(fileURLToPath(import.meta.url)), ".response-body-ownership-fixture.ts");
  const canonicalFixture = canonicalFileName(fileName);
  const host = ts.createCompilerHost(compilerOptions, true);
  const readSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.fileExists = (requestedFileName) => canonicalFileName(requestedFileName) === canonicalFixture
    || fileExists(requestedFileName);
  host.readFile = (requestedFileName) => canonicalFileName(requestedFileName) === canonicalFixture
    ? sourceText
    : readFile(requestedFileName);
  host.getSourceFile = (requestedFileName, languageVersion, onError, shouldCreateNewSourceFile) => (
    canonicalFileName(requestedFileName) === canonicalFixture
      ? ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS)
      : readSourceFile(requestedFileName, languageVersion, onError, shouldCreateNewSourceFile)
  );
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) throw new Error("Response body policy source was unavailable");
  return inspectResponseBodyUses(program, [sourceFile]);
}

/**
 * Builds a TypeScript Program at one UI root and inspects every reachable local source.
 * Declaration files, TypeScript libraries, and node_modules remain type inputs but are
 * never visited, preventing dependency implementation details from becoming findings.
 * @param rootFileName - Absolute or workspace-relative UI spec that owns the import graph.
 * @returns Deduplicated fixed categories and method names for forbidden body use.
 */
export function findResponseBodyUsesInProgram(rootFileName: string): readonly ResponseBodyUse[] {
  const resolvedRoot = ts.sys.resolvePath(rootFileName);
  if (isDependencyFile(resolvedRoot)) throw new Error("Response body policy root must be local");
  const program = ts.createProgram([resolvedRoot], compilerOptions);
  const root = program.getSourceFile(resolvedRoot);
  if (root === undefined) throw new Error("Response body policy root was unavailable");
  const localSources = program.getSourceFiles().filter(
    (sourceFile) => !sourceFile.isDeclarationFile && !isDependencyFile(sourceFile.fileName),
  );
  return inspectResponseBodyUses(program, localSources);
}

/**
 * Visits local ASTs with semantic provenance while retaining only safe diagnostic labels.
 * @param program - TypeScript Program that supplies imported and inherited type information.
 * @param sourceFiles - Reachable local implementation files allowed into policy ownership.
 * @returns Deduplicated fixed categories and method names for forbidden body use.
 */
function inspectResponseBodyUses(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
): readonly ResponseBodyUse[] {
  const checker = program.getTypeChecker();
  const domLibraryFileName = canonicalFileName(
    path.join(path.dirname(ts.getDefaultLibFilePath(compilerOptions)), "lib.dom.d.ts"),
  );
  const findings: ResponseBodyUse[] = [];

  /** Records a fixed finding once so source paths and expressions never reach diagnostics. */
  const addFinding = (finding: ResponseBodyUse): void => {
    if (!findings.some((current) => current.category === finding.category && current.method === finding.method)) {
      findings.push(finding);
    }
  };

  /** Classifies one statically named or fail-closed response member. */
  const inspectMember = (
    provenance: ResponseProvenance,
    propertyNames: readonly string[] | undefined,
    computedCategory: ResponseBodyUse["category"],
  ): void => {
    if (propertyNames === undefined) {
      addFinding({ category: computedCategory, method: "computed" });
      return;
    }
    for (const propertyName of propertyNames) {
      if (propertyName === "body") {
        if (provenance.dom) addFinding({ category: "stream", method: "body" });
        if (provenance.playwright) addFinding({ category: "consumption", method: "body" });
        continue;
      }
      if (
        (provenance.dom && isDomResponseBodyMethod(propertyName))
        || (provenance.playwright && isPlaywrightResponseBodyMethod(propertyName))
      ) {
        addFinding({ category: "consumption", method: propertyName });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const access = responseMemberAccess(checker, node.expression);
      if (access !== undefined) {
        const provenance = responseProvenance(
          checker,
          checker.getTypeAtLocation(access.receiver),
          domLibraryFileName,
        );
        if (hasResponseProvenance(provenance)) inspectMember(provenance, access.propertyNames, "consumption");
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const access = responseMemberAccess(checker, node);
      if (access !== undefined) {
        const provenance = responseProvenance(
          checker,
          checker.getTypeAtLocation(access.receiver),
          domLibraryFileName,
        );
        if (hasResponseProvenance(provenance)) {
          const isCallTarget = ts.isCallExpression(node.parent) && node.parent.expression === node;
          if (access.propertyNames !== undefined) {
            inspectMember(provenance, access.propertyNames, "consumption");
          } else if (!isCallTarget) {
            inspectMember(provenance, undefined, provenance.dom ? "stream" : "consumption");
          }
        }
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer !== undefined) {
      const provenance = responseProvenance(
        checker,
        checker.getTypeAtLocation(node.initializer),
        domLibraryFileName,
      );
      if (hasResponseProvenance(provenance)) {
        for (const element of node.name.elements) {
          const propertyNames = bindingElementPropertyNames(checker, element);
          inspectMember(provenance, propertyNames, provenance.dom ? "stream" : "consumption");
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sourceFile of sourceFiles) visit(sourceFile);
  return findings;
}

/**
 * Resolves a response member receiver and every statically bounded property name.
 * @param checker - Semantic checker for computed property-key types.
 * @param expression - Property expression used directly or as a call target.
 * @returns Receiver plus names, or undefined names when the key is unbounded.
 */
function responseMemberAccess(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ResponseMemberAccess | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return { receiver: expression.expression, propertyNames: [expression.name.text] };
  }
  if (ts.isElementAccessExpression(expression)) {
    return {
      receiver: expression.expression,
      propertyNames: possiblePropertyNames(checker.getTypeAtLocation(expression.argumentExpression)),
    };
  }
  return undefined;
}

/**
 * Resolves an object-binding element to a safe bounded property-name set.
 * @param checker - Semantic checker used for computed binding property names.
 * @param element - Destructured member of a recognized response value.
 * @returns Property names, or undefined for a rest/unbounded computed binding.
 */
function bindingElementPropertyNames(
  checker: ts.TypeChecker,
  element: ts.BindingElement,
): readonly string[] | undefined {
  if (element.dotDotDotToken !== undefined) return undefined;
  const propertyName = element.propertyName ?? element.name;
  if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName)) {
    return [propertyName.text];
  }
  if (ts.isComputedPropertyName(propertyName)) {
    return possiblePropertyNames(checker.getTypeAtLocation(propertyName.expression));
  }
  return undefined;
}

/**
 * Extracts every string-literal name represented by a computed key type.
 * @param type - Type of a computed response member key.
 * @returns Literal names, or undefined when the key could be an unbounded string.
 */
function possiblePropertyNames(type: ts.Type): readonly string[] | undefined {
  if (type.isUnion()) {
    const names: string[] = [];
    for (const member of type.types) {
      const memberNames = possiblePropertyNames(member);
      if (memberNames === undefined) return undefined;
      for (const name of memberNames) {
        if (!names.includes(name)) names.push(name);
      }
    }
    return names;
  }
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return [(type as ts.StringLiteralType).value];
  }
  if ((type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.ESSymbolLike)) !== 0) return [];
  return undefined;
}

/**
 * Resolves DOM and Playwright provenance through aliases, unions, intersections, bases, and constraints.
 * @param checker - Semantic checker used to resolve declarations and inherited interfaces.
 * @param type - Receiver type whose response ownership is being classified.
 * @param domLibraryFileName - Canonical TypeScript lib.dom declaration path.
 * @param seen - Types already visited while resolving recursive relationships.
 * @returns Independent DOM and Playwright provenance flags.
 */
function responseProvenance(
  checker: ts.TypeChecker,
  type: ts.Type,
  domLibraryFileName: string,
  seen: ReadonlySet<ts.Type> = new Set(),
): ResponseProvenance {
  if (seen.has(type)) return { dom: false, playwright: false };
  const nextSeen = new Set(seen);
  nextSeen.add(type);
  let provenance: ResponseProvenance = { dom: false, playwright: false };

  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      provenance = mergeProvenance(
        provenance,
        responseProvenance(checker, member, domLibraryFileName, nextSeen),
      );
    }
  }

  for (const symbol of [type.getSymbol(), type.aliasSymbol]) {
    if (symbol === undefined) continue;
    provenance = mergeProvenance(provenance, {
      dom: isDomBodyOrResponseSymbol(checker, symbol, domLibraryFileName),
      playwright: isPlaywrightResponseSymbol(checker, symbol),
    });
  }

  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    const objectType = type as ts.ObjectType;
    if ((objectType.objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0) {
      for (const baseType of checker.getBaseTypes(objectType as ts.InterfaceType) ?? []) {
        provenance = mergeProvenance(
          provenance,
          responseProvenance(checker, baseType, domLibraryFileName, nextSeen),
        );
      }
    }
  }

  const constraint = checker.getBaseConstraintOfType(type);
  if (constraint !== undefined) {
    provenance = mergeProvenance(
      provenance,
      responseProvenance(checker, constraint, domLibraryFileName, nextSeen),
    );
  }
  return provenance;
}

/**
 * Checks whether a symbol is TypeScript's exact DOM Body or Response declaration.
 * @param checker - Semantic checker used to follow import aliases.
 * @param symbol - Candidate receiver symbol.
 * @param domLibraryFileName - Canonical TypeScript lib.dom declaration path.
 * @returns True only for Body/Response declared by the active lib.dom file.
 */
function isDomBodyOrResponseSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  domLibraryFileName: string,
): boolean {
  const resolved = resolveSymbol(checker, symbol);
  return (resolved.getName() === "Body" || resolved.getName() === "Response")
    && (resolved.declarations ?? []).some(
      (declaration) => canonicalFileName(declaration.getSourceFile().fileName) === domLibraryFileName,
    );
}

/**
 * Checks whether a symbol is Playwright's exact Response or APIResponse declaration.
 * @param checker - Semantic checker used to follow package re-export aliases.
 * @param symbol - Candidate receiver symbol.
 * @returns True only for declarations from playwright-core's public type file.
 */
function isPlaywrightResponseSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  const resolved = resolveSymbol(checker, symbol);
  return (resolved.getName() === "Response" || resolved.getName() === "APIResponse")
    && (resolved.declarations ?? []).some((declaration) => {
      const sourceFileName = canonicalFileName(declaration.getSourceFile().fileName);
      return sourceFileName.endsWith("/node_modules/playwright-core/types/types.d.ts");
    });
}

/**
 * Follows one TypeScript alias without accepting same-named local declarations.
 * @param checker - Semantic checker that owns the alias graph.
 * @param symbol - Possibly aliased symbol.
 * @returns Resolved declaration symbol.
 */
function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * Merges response provenance without conflating DOM and Playwright method sets.
 * @param left - Provenance accumulated from earlier type branches.
 * @param right - Provenance from the next symbol, base, or constraint.
 * @returns Combined immutable provenance flags.
 */
function mergeProvenance(left: ResponseProvenance, right: ResponseProvenance): ResponseProvenance {
  return { dom: left.dom || right.dom, playwright: left.playwright || right.playwright };
}

/**
 * Reports whether a receiver has any protected response declaration provenance.
 * @param provenance - DOM and Playwright provenance flags.
 * @returns True when at least one protected response owner is present.
 */
function hasResponseProvenance(provenance: ResponseProvenance): boolean {
  return provenance.dom || provenance.playwright;
}

/**
 * Checks whether a method consumes a TypeScript DOM Body.
 * @param name - Statically resolved property name.
 * @returns True for the active DOM Body consumption surface.
 */
function isDomResponseBodyMethod(name: string): name is (typeof domResponseBodyMethods)[number] {
  return (domResponseBodyMethods as readonly string[]).includes(name);
}

/**
 * Checks whether a method consumes a Playwright Response or APIResponse.
 * @param name - Statically resolved property name.
 * @returns True for Playwright's body-consuming methods.
 */
function isPlaywrightResponseBodyMethod(
  name: string,
): name is (typeof playwrightResponseBodyMethods)[number] {
  return (playwrightResponseBodyMethods as readonly string[]).includes(name);
}

/**
 * Identifies dependency/type-library files that must never become visited policy sources.
 * @param fileName - Source path supplied by the TypeScript Program.
 * @returns True for node_modules paths; declaration files are excluded by the caller.
 */
function isDependencyFile(fileName: string): boolean {
  return canonicalFileName(fileName).includes("/node_modules/");
}

/**
 * Normalizes declaration paths for reliable package and standard-library provenance checks.
 * @param fileName - Path supplied by TypeScript.
 * @returns Absolute, slash-normalized path with host-appropriate casing.
 */
function canonicalFileName(fileName: string): string {
  const normalized = ts.sys.resolvePath(fileName).replaceAll("\\", "/");
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}
