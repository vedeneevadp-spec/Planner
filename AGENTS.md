# AGENTS.md

## Project workflow

- Before editing code, inspect package.json and existing folder structure.
- Prefer existing components, utilities, styles, tokens, and routing patterns.
- Do not add new production dependencies without explaining why.
- Keep changes scoped to the requested screen or feature.
- Use TypeScript-safe code.
- Prefer accessible semantic HTML.
- Preserve existing naming conventions.

## Figma implementation rules

When implementing a Figma design:

- Start by using Figma MCP to get design context for the exact linked frame or node.
- Get a screenshot of the exact frame before coding.
- If Figma output is too large or truncated, inspect metadata and fetch only the needed nodes.
- Reuse existing components from the project before creating new ones.
- Match spacing, hierarchy, typography, colors, states, and responsive behavior.
- Do not invent a parallel design system.
- If the design uses icons/assets from Figma, reuse them or export them properly instead of adding random icon packages.

## Validation

After changes:

- Run the project’s lint command if available.
- Run the project’s typecheck command if available.
- Run tests if they are relevant and available.
- Start or use the dev server to visually inspect the implemented route.
- Summarize changed files and any tradeoffs.
