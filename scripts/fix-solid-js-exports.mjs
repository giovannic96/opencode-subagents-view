#!/usr/bin/env node
// Removes solid-js's "node" export condition so this plugin's terminal UI
// resolves the reactive build instead of the non-reactive SSR build (see
// README, "Why this plugin patches solid-js's exports"). This intentionally
// does not use patch-package: patch-package locates the project root by
// walking up from process.cwd() until it escapes any node_modules folder,
// which finds the wrong root (and silently does nothing) when this package
// is installed as a nested dependency of someone else's project. Resolving
// "solid-js" starting from this script's own directory instead always finds
// the correct copy, regardless of how deeply this package is nested.
import { createRequire } from "node:module"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

function findSolidJsPackageJson() {
  let resolved
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

const pkgPath = findSolidJsPackageJson()
if (!pkgPath) {
  console.warn("[opencode-subagents-view] Could not locate solid-js to patch its exports. The Subagents sidebar may not update.")
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
const mainExport = pkg.exports?.["."]

if (mainExport && typeof mainExport === "object" && "node" in mainExport) {
  delete mainExport.node
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`[opencode-subagents-view] Patched solid-js exports at ${pkgPath}`)
} else {
  console.log(`[opencode-subagents-view] solid-js exports already OK at ${pkgPath}`)
}
