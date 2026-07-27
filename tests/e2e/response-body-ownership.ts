import path from "node:path";
import * as ts from "typescript";

const responseBodyMethods = ["json", "text", "arrayBuffer", "blob", "formData"] as const;
type ResponseBodyMethod = (typeof responseBodyMethods)[number];
type ResponseBodyDiagnosticMethod = ResponseBodyMethod | "body" | "computed";

export type ResponseBodyUse = Readonly<{
  category: "consumption" | "stream";
  method: ResponseBodyDiagnosticMethod;
}>;

/**
 * Finds Response body access without retaining source text or response values.
 * @param sourceText - TypeScript source to inspect in memory.
 * @returns Safe categories and method names for forbidden Response body uses.
 */
export function findResponseBodyUses(sourceText: string): readonly ResponseBodyUse[] {
  const fileName = "response-body-ownership-fixture.ts";
  const compilerOptions: ts.CompilerOptions = {
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2023,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requestedFileName, languageVersion, onError, shouldCreateNewSourceFile) => (
    requestedFileName === fileName
      ? ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS)
      : readSourceFile(requestedFileName, languageVersion, onError, shouldCreateNewSourceFile)
  );
  const program = ts.createProgram([fileName], compilerOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) throw new Error("Response body policy source was unavailable");

  const checker = program.getTypeChecker();
  const domLibraryFileName = canonicalFileName(path.join(path.dirname(ts.getDefaultLibFilePath(compilerOptions)), "lib.dom.d.ts"));
  const findings: ResponseBodyUse[] = [];
  const addFinding = (finding: ResponseBodyUse): void => {
    if (!findings.some((current) => current.category === finding.category && current.method === finding.method)) {
      findings.push(finding);
    }
  };
  const isResponseExpression = (expression: ts.Expression): boolean => (
    isDomResponseType(checker, checker.getTypeAtLocation(expression), domLibraryFileName)
  );

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const access = responseMemberAccess(checker, node.expression);
      if (access !== undefined && isResponseExpression(access.receiver)) {
        if (access.propertyNames === undefined) {
          addFinding({ category: "consumption", method: "computed" });
        } else {
          for (const propertyName of access.propertyNames) {
            if (isResponseBodyMethod(propertyName)) addFinding({ category: "consumption", method: propertyName });
          }
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const access = responseMemberAccess(checker, node);
      if (access !== undefined && isResponseExpression(access.receiver)) {
        const isCallTarget = ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (access.propertyNames === undefined) {
          if (!isCallTarget) addFinding({ category: "stream", method: "computed" });
        } else if (access.propertyNames.includes("body")) {
          addFinding({ category: "stream", method: "body" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

/**
 * Checks whether a property name is a Response body-consuming method.
 * @param name - Property name obtained from the parsed TypeScript AST.
 * @returns True only for the body APIs prohibited in browser-journey specs.
 */
function isResponseBodyMethod(name: string): name is ResponseBodyMethod {
  return (responseBodyMethods as readonly string[]).includes(name);
}

/**
 * Resolves a property receiver and any statically provable property names.
 * @param checker - Semantic checker for computed property types.
 * @param expression - Property expression used directly or as a call target.
 * @returns Receiver plus names, or undefined names when a computed key is not safely bounded.
 */
function responseMemberAccess(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): Readonly<{ receiver: ts.Expression; propertyNames: readonly string[] | undefined }> | undefined {
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
 * Extracts the complete set of string-literal names represented by a key type.
 * @param type - Type of a computed property key.
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
 * Recognizes the standard-library DOM Response across unions, intersections, aliases, and constraints.
 * @param checker - Semantic checker used to resolve aliases and constraints.
 * @param type - TypeScript type supplied by the semantic checker.
 * @param domLibraryFileName - Canonical TypeScript lib.dom declaration path.
 * @param seen - Types already inspected while resolving recursive constraints.
 * @returns True when the expression is typed as a DOM Response.
 */
function isDomResponseType(
  checker: ts.TypeChecker,
  type: ts.Type,
  domLibraryFileName: string,
  seen: ReadonlySet<ts.Type> = new Set(),
): boolean {
  if (seen.has(type)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(type);
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => isDomResponseType(checker, member, domLibraryFileName, nextSeen));
  }

  const symbols = [type.getSymbol(), type.aliasSymbol];
  if (symbols.some((symbol) => symbol !== undefined && isDomResponseSymbol(checker, symbol, domLibraryFileName))) {
    return true;
  }

  const constraint = checker.getBaseConstraintOfType(type);
  return constraint !== undefined && isDomResponseType(checker, constraint, domLibraryFileName, nextSeen);
}

/**
 * Checks whether a symbol resolves to Response declared by TypeScript's exact lib.dom file.
 * @param checker - Semantic checker used to follow import aliases.
 * @param symbol - Candidate symbol attached to a receiver type.
 * @param domLibraryFileName - Canonical TypeScript lib.dom declaration path.
 * @returns True only for the standard DOM Response declaration.
 */
function isDomResponseSymbol(checker: ts.TypeChecker, symbol: ts.Symbol, domLibraryFileName: string): boolean {
  const resolved = (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
  return resolved.getName() === "Response"
    && (resolved.declarations ?? []).some(
      (declaration) => canonicalFileName(declaration.getSourceFile().fileName) === domLibraryFileName,
    );
}

/**
 * Normalizes declaration paths for reliable standard-library provenance checks.
 * @param fileName - Path supplied by TypeScript.
 * @returns Absolute, slash-normalized path with host-appropriate casing.
 */
function canonicalFileName(fileName: string): string {
  const normalized = ts.sys.resolvePath(fileName).replaceAll("\\", "/");
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}
