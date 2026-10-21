/**
 * The web client ships as two bundles built from shared sources: coop-client.js
 * (src/wildstat-coop.ts) and game.js (src/main.ts). A module reachable from both
 * entries is copied into each, so module-level state written in one bundle is
 * invisible to the other. This lists those modules and the state they hold.
 *
 * Static analysis with the TypeScript parser, no build needed:
 * - follows relative static imports, re-exports and dynamic import() of .ts
 *   files; type-only imports are skipped. It does not apply tree-shaking, so it
 *   can list a module the bundler later drops from one side.
 * - mutable state is a top-level `let`/`var` that is reassigned, or a top-level
 *   const whose value is mutated in the file (`x.set/add/push/...(`, `x.a = `,
 *   `x[i] = `, `delete x.a`, `Object.assign(x, ...)`).
 * - it does not see state hidden inside class instances, closures returned by a
 *   factory call at top level, or a const handed to another module to mutate.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const MUTATING_METHODS = new Set([
  "set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice",
  "sort", "reverse", "fill", "copyWithin",
]);

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(fromFile), specifier.replace(/\?.*$/, ""));
  if (specifier.includes("?")) return undefined;
  for (const candidate of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function parse(file) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

/** Identifiers the file reads as values, outside import declarations and types. */
function valueNames(source) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) return;
    if (ts.isPropertyAccessExpression(node)) return visit(node.expression);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isMemberName = parent && "name" in parent && parent.name === node && !ts.isShorthandPropertyAssignment(parent);
      if (!isMemberName) names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function runtimeImports(file, source) {
  const found = [];
  let used;
  const add = (specifier) => {
    const target = resolveImport(file, specifier);
    if (target) found.push(target);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause) {
        const named = clause.namedBindings;
        const bindings = [
          ...(clause.name ? [clause.name.text] : []),
          ...(named && ts.isNamespaceImport(named) ? [named.name.text] : []),
          ...(named && ts.isNamedImports(named) ? named.elements.filter(element => !element.isTypeOnly).map(element => element.name.text) : []),
        ];
        // TypeScript erases an import whose bindings are only used as types.
        used ??= valueNames(source);
        if (!bindings.some(name => used.has(name))) continue;
      }
      add(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      add(statement.moduleSpecifier.text);
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function reachable(entry, cache) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!cache.has(file)) cache.set(file, parse(file));
    stack.push(...runtimeImports(file, cache.get(file)));
  }
  return seen;
}

function rootName(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
    || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/** Names of top-level bindings this file reassigns or mutates. */
export function moduleState(source) {
  const lets = new Set();
  const consts = new Set();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) (isConst ? consts : lets).add(declaration.name.text);
    }
  }
  const state = new Set();
  const markTarget = (target, direct) => {
    if (direct && ts.isIdentifier(target)) {
      if (lets.has(target.text)) state.add(target.text);
      return;
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const name = rootName(target);
      if (name && (consts.has(name) || lets.has(name))) state.add(name);
    }
  };
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && ASSIGNMENTS.has(node.operatorToken.kind)) {
      if (ts.isArrayLiteralExpression(node.left) || ts.isObjectLiteralExpression(node.left)) {
        const walk = (child) => { if (ts.isIdentifier(child)) markTarget(child, true); else ts.forEachChild(child, walk); };
        walk(node.left);
      } else markTarget(node.left, true);
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      markTarget(node.operand, true);
    } else if (ts.isDeleteExpression(node)) {
      markTarget(node.expression, false);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const name = rootName(node.expression.expression);
      if (MUTATING_METHODS.has(method) && name && (consts.has(name) || lets.has(name))) state.add(name);
      if (method === "assign" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object") {
        const first = node.arguments[0] && rootName(node.arguments[0]);
        if (first && (consts.has(first) || lets.has(first))) state.add(first);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...state].sort();
}

/** Modules reachable from every entry, with the module-level state each holds. */
export function sharedModuleState(root, entries) {
  const cache = new Map();
  const graphs = entries.map(entry => reachable(resolve(root, entry), cache));
  const shared = [...graphs[0]].filter(file => graphs.every(graph => graph.has(file))).sort();
  return shared.map(file => ({
    path: relative(root, file).replace(/\\/g, "/"),
    state: moduleState(cache.get(file)),
  }));
}
