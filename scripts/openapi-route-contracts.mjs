import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

import ts from 'typescript'

import {
  contractQueryParameters,
  contractSchema,
} from '../apps/api/src/bootstrap/openapi-schema.ts'

const modulesDirectory = fileURLToPath(
  new URL('../apps/api/src/modules/', import.meta.url),
)
const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])

// Read the handlers independently of the documentation map. Adding/removing a
// field in a validator, or wiring an operation to another DTO, must not silently
// leave a plausible-looking but incorrect OpenAPI document behind.
export async function assertRouteContracts(document) {
  const counts = { bodies: 0, queries: 0, responses: 0, statuses: 0 }
  for (const directory of await readdir(modulesDirectory, {
    withFileTypes: true,
  })) {
    if (!directory.isDirectory()) continue
    const modulePath = path.join(modulesDirectory, directory.name)
    for (const file of await readdir(modulePath)) {
      if (!file.endsWith('.routes.ts')) continue
      const filePath = path.join(modulePath, file)
      const source = await readFile(filePath, 'utf8')
      const ast = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
      )
      const bindings = { ...(await import(pathToFileURL(filePath).href)) }
      const constants = new Map()
      for (const statement of ast.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          const specifier = statement.moduleSpecifier.text
          if (statement.importClause?.isTypeOnly) continue
          const names = statement.importClause?.namedBindings
          if (!names || !ts.isNamedImports(names)) continue
          const requested = names.elements.filter(
            (name) =>
              !name.isTypeOnly &&
              (name.name.text.endsWith('Schema') || name.name.text === 'z'),
          )
          if (!requested.length) continue
          const resolved = specifier.startsWith('.')
            ? pathToFileURL(
                path.resolve(modulePath, specifier.replace(/\.js$/, '.ts')),
              ).href
            : specifier
          const imported = await import(resolved)
          for (const name of requested)
            bindings[name.name.text] =
              imported[name.propertyName?.text ?? name.name.text]
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              declaration.initializer &&
              ts.isStringLiteral(declaration.initializer)
            ) {
              constants.set(declaration.name.text, declaration.initializer.text)
            }
          }
        }
      }

      const resolveSchema = (node) => {
        if (ts.isIdentifier(node)) return bindings[node.text]
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(ast) === 'z.array'
        ) {
          const item = resolveSchema(node.arguments[0])
          return item ? bindings.z.array(item) : undefined
        }
        return undefined
      }
      const routePath = (node) => {
        if (ts.isStringLiteral(node)) return node.text
        if (ts.isTemplateExpression(node)) {
          let value = node.head.text
          for (const span of node.templateSpans) {
            const part = constants.get(span.expression.getText(ast))
            if (part === undefined) return undefined
            value += part + span.literal.text
          }
          return value
        }
        return undefined
      }
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          methods.has(node.expression.name.text) &&
          node.arguments[0]
        ) {
          const url = routePath(node.arguments[0])?.replace(/:([\w]+)/g, '{$1}')
          const method = node.expression.name.text
          const item = document.paths[url]
          const operation = item?.[method]
          if (operation) {
            const label = `${method.toUpperCase()} ${url}`
            const handler = node.arguments.at(-1)
            const inspect = (child) => {
              if (ts.isCallExpression(child)) {
                let schemaNode, valueNode
                if (child.expression.getText(ast) === 'parseOrThrow') {
                  ;[schemaNode, valueNode] = child.arguments
                } else if (
                  ts.isPropertyAccessExpression(child.expression) &&
                  child.expression.name.text === 'safeParse'
                ) {
                  schemaNode = child.expression.expression
                  valueNode = child.arguments[0]
                }
                const value = valueNode?.getText(ast)
                if (
                  schemaNode &&
                  (value === 'request.query' ||
                    value === 'request.body' ||
                    value === 'request.body ?? {}')
                ) {
                  const schema = resolveSchema(schemaNode)
                  assert.ok(
                    schema,
                    `${label}: export the route validator ${schemaNode.getText(ast)} for documentation checks`,
                  )
                  if (value === 'request.query') {
                    const parameters = [
                      ...(item.parameters ?? []),
                      ...(operation.parameters ?? []),
                    ]
                      .map((p) => dereference(document, p))
                      .filter((p) => p.in === 'query')
                    assert.deepEqual(
                      parameters,
                      contractQueryParameters(schema),
                      `${label}: query parameters drifted`,
                    )
                    counts.queries++
                  } else {
                    const body = dereference(document, operation.requestBody)
                    assert.ok(body, `${label}: missing request body`)
                    for (const media of Object.values(body.content)) {
                      assert.deepEqual(
                        structuralSchema(dereference(document, media.schema)),
                        structuralSchema(contractSchema(schema, 'input')),
                        `${label}: request schema drifted`,
                      )
                    }
                    const optional =
                      value === 'request.body ?? {}' &&
                      schema.safeParse({}).success
                    assert.equal(
                      body.required ?? false,
                      !optional,
                      `${label}: request body required flag drifted`,
                    )
                    counts.bodies++
                  }
                }
                if (
                  ts.isPropertyAccessExpression(child.expression) &&
                  child.expression.name.text === 'code' &&
                  child.arguments[0] &&
                  ts.isNumericLiteral(child.arguments[0])
                ) {
                  const status = child.arguments[0].text
                  assert.ok(
                    operation.responses[status],
                    `${label}: missing HTTP ${status}`,
                  )
                  counts.statuses++
                }
              }
              if (
                ts.isReturnStatement(child) &&
                child.expression &&
                ts.isCallExpression(child.expression) &&
                ts.isPropertyAccessExpression(child.expression.expression) &&
                child.expression.expression.name.text === 'parse'
              ) {
                const schema = resolveSchema(
                  child.expression.expression.expression,
                )
                assert.ok(schema, `${label}: unknown response validator`)
                const success = Object.entries(operation.responses).find(
                  ([status]) => /^2/.test(status),
                )?.[1]
                const responseSchema = dereference(
                  document,
                  dereference(document, success)?.content?.['application/json']
                    ?.schema,
                )
                assert.deepEqual(
                  structuralSchema(responseSchema),
                  structuralSchema(contractSchema(schema, 'output')),
                  `${label}: response schema drifted`,
                )
                counts.responses++
              }
              ts.forEachChild(child, inspect)
            }
            if (handler) inspect(handler)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
  }
  return counts
}

function dereference(document, value) {
  if (!value?.$ref) return value
  return value.$ref
    .split('/')
    .slice(1)
    .reduce((current, key) => current?.[key], document)
}

function structuralSchema(value) {
  if (Array.isArray(value)) return value.map(structuralSchema)
  if (!value || typeof value !== 'object') return value
  // Extra prose and documented refinements do not alter the Zod shape.
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !['description', 'deprecated', 'minProperties'].includes(key),
      )
      .map(([key, child]) => [key, structuralSchema(child)]),
  )
}
