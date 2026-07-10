/**
 * This file performs strict AST analysis of route files so the CLI can extract
 * metadata safely and report exact file, line, and column locations on errors.
 */
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type RouteAnalysis = {
  method: RouteMethod;
  operationId?: string;
};

function createLocatedError(sourceFile: ts.SourceFile, node: ts.Node, message: string): Error {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return new Error(`${sourceFile.fileName}:${position.line + 1}:${position.character + 1} ${message}`);
}

function isRouteFactoryCall(expression: ts.Expression): expression is ts.CallExpression {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    (expression.expression.text === 'defineRoute' || expression.expression.text === 'defineApi')
  );
}

function findRouteConfigObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    if (!isRouteFactoryCall(statement.expression)) {
      throw createLocatedError(sourceFile, statement.expression, 'expected `export default defineRoute({ ... })`');
    }
    const [firstArgument] = statement.expression.arguments;
    if (!firstArgument || !ts.isObjectLiteralExpression(firstArgument)) {
      throw createLocatedError(sourceFile, statement.expression, 'expected the route definition argument to be an object literal');
    }
    return firstArgument;
  }
  throw new Error(`${sourceFile.fileName}:1:1 expected a default export using defineRoute() or defineApi()`);
}

function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
    return ts.isIdentifier(property.name) ? property.name.text === name : ts.isStringLiteral(property.name) && property.name.text === name;
  });
}

function readStringLiteral(
  sourceFile: ts.SourceFile,
  property: ts.ObjectLiteralElementLike | undefined,
  label: string,
  required: boolean,
): string | undefined {
  if (!property) {
    if (required) throw new Error(`${sourceFile.fileName}:1:1 missing required route property \`${label}\``);
    return undefined;
  }
  if (!ts.isPropertyAssignment(property)) {
    throw createLocatedError(sourceFile, property, `expected \`${label}\` to be a string literal`);
  }
  if (!ts.isStringLiteral(property.initializer) && !ts.isNoSubstitutionTemplateLiteral(property.initializer)) {
    throw createLocatedError(sourceFile, property.initializer, `expected \`${label}\` to be a static string literal`);
  }
  return property.initializer.text;
}

export async function analyzeRouteFile(filePath: string): Promise<RouteAnalysis> {
  const source = await readFile(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const configObject = findRouteConfigObject(sourceFile);

  const methodValue = readStringLiteral(sourceFile, findProperty(configObject, 'method'), 'method', true)?.toLowerCase();
  if (!methodValue || !['get', 'post', 'put', 'patch', 'delete'].includes(methodValue)) {
    const methodProperty = findProperty(configObject, 'method') ?? configObject;
    throw createLocatedError(sourceFile, methodProperty, 'expected `method` to be one of get, post, put, patch, or delete');
  }

  const operationId = readStringLiteral(sourceFile, findProperty(configObject, 'operationId'), 'operationId', false);
  return {
    method: methodValue as RouteMethod,
    ...(operationId ? { operationId } : {}),
  };
}
