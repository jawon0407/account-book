import * as ts from "typescript";

const responseBodyMethods = ["json", "text", "arrayBuffer", "blob", "formData"] as const;
type ResponseBodyMethod = (typeof responseBodyMethods)[number];

export type ResponseBodyUse = Readonly<{
  category: "consumption" | "stream";
  method: ResponseBodyMethod | "body";
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
  const findings: ResponseBodyUse[] = [];
  const addFinding = (finding: ResponseBodyUse): void => {
    if (!findings.some((current) => current.category === finding.category && current.method === finding.method)) {
      findings.push(finding);
    }
  };
  const isResponseExpression = (expression: ts.Expression): boolean => isResponseType(checker.getTypeAtLocation(expression));

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (isResponseBodyMethod(method) && isResponseExpression(node.expression.expression)) {
        addFinding({ category: "consumption", method });
      }
    }
    const bodyReceiver = responseBodyReceiver(node);
    if (bodyReceiver !== undefined && isResponseExpression(bodyReceiver)) {
      addFinding({ category: "stream", method: "body" });
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
 * Identifies direct body access, including property and bracket forms, without reading it.
 * @param node - Parsed TypeScript node potentially representing Response stream access.
 * @returns The Response receiver when the node accesses its `body` property.
 */
function responseBodyReceiver(node: ts.Node): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "body") return node.expression;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "body") {
    return node.expression;
  }
  return undefined;
}

/**
 * Recognizes DOM Response types, including a Response member in a union.
 * @param type - TypeScript type supplied by the semantic checker.
 * @returns True when the expression is typed as a DOM Response.
 */
function isResponseType(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(isResponseType);
  return type.getSymbol()?.getName() === "Response";
}
