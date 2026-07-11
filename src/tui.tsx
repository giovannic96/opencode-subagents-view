// This is the package's real "./tui" entrypoint. It intentionally does not
// statically import solid-js or @opentui/solid itself (see below), and
// contains no plugin logic of its own. The actual implementation lives in
// src/tui-runtime.tsx.
//
// Why this file exists: solid-js publishes a conditional `exports` map with
// a "node" condition that points at its non-reactive SSR build. Bun matches
// that condition by default, so a bare `import ... from "solid-js"` resolves
// to a build whose createEffect is a literal no-op. See README ("Why this
// plugin patches solid-js's exports at runtime") for the full story,
// including why this can't be a `postinstall` script: opencode's own
// "Install Plugin" flow installs this package without running lifecycle
// scripts, so a postinstall-based fix silently never runs for anyone who
// installs this plugin that way, which is the normal way a first-time npm
// user installs it.
//
// The fix instead lives directly in this module's own load path: patch
// solid-js's package.json synchronously, then dynamically import the real
// implementation (whose static `import ... from "solid-js"` only gets
// evaluated *after* this file's own top-level code has already run). This
// guarantees the patch runs every time this plugin loads, regardless of how
// or where it was installed, with no separate install-time step at all.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

function findSolidJsPackageJson(): string | undefined {
  const require = createRequire(import.meta.url)
  const here = dirname(fileURLToPath(import.meta.url))

  let resolved: string
  try {
    resolved = require.resolve("solid-js", { paths: [here] })
  } catch {
    return undefined
  }

  let dir = dirname(resolved)
  while (true) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"))
      if (pkg.name === "solid-js") return candidate
    }

    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function patchSolidJsExports(): void {
  const pkgPath = findSolidJsPackageJson()
  if (!pkgPath) return

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  const mainExport = pkg.exports?.["."]
  if (!mainExport || typeof mainExport !== "object" || !("node" in mainExport)) return

  delete mainExport.node
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

patchSolidJsExports()

const runtime = await import("./tui-runtime")

export const getOrCreateChildSessions = runtime.getOrCreateChildSessions
export const getOrCreateChildSessionsCollapsed = runtime.getOrCreateChildSessionsCollapsed
export default runtime.default
