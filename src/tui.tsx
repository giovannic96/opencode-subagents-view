// This is the package's real "./tui" entrypoint. It intentionally does not
// statically import solid-js or @opentui/solid itself (see below), and
// contains no plugin logic of its own. The actual implementation lives in
// src/plugin.tsx.
//
// Why this file exists (solid-js): solid-js publishes a conditional
// `exports` map with a "node" condition that points at its non-reactive
// SSR build. Bun matches that condition by default, so a bare
// `import ... from "solid-js"` resolves to a build whose createEffect is a
// literal no-op. See README ("Why this plugin patches solid-js's exports
// at runtime") for the full story, including why this can't be a
// `postinstall` script: opencode's own "Install Plugin" flow installs this
// package without running lifecycle scripts, so a postinstall-based fix
// silently never runs for anyone who installs this plugin that way, which
// is the normal way a first-time npm user installs it.
//
// Why this file exists (JSX): src/plugin.tsx's JSX only resolves to
// @opentui/solid's JSX runtime, instead of a broken default assumption of
// React's, when Bun applies this project's `jsxImportSource` setting or
// the per-file pragma in src/plugin.tsx. Bun does not apply either of
// those to any file resolved from a path that contains a `node_modules`
// segment, which is where this plugin's own files always end up once
// installed for real. See README ("Why this plugin escapes node_modules to
// load its own JSX") for the full story, including why prebuilding the
// JSX away entirely was tried and rejected: it silently broke rendering
// for a still-unexplained reason, verified live against a real opencode
// instance.
//
// Both fixes live directly in this module's own load path, which
// guarantees they run every time this plugin loads, regardless of how or
// where it was installed, with no separate install-time step at all.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

function findSolidJsPackageJson(fromDir: string): string | undefined {
  const require = createRequire(import.meta.url)

  let resolved: string
  try {
    resolved = require.resolve("solid-js", { paths: [fromDir] })
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

function patchSolidJsExports(fromDir: string): void {
  const pkgPath = findSolidJsPackageJson(fromDir)
  if (!pkgPath) return

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  const mainExport = pkg.exports?.["."]
  if (!mainExport || typeof mainExport !== "object" || !("node" in mainExport)) return

  delete mainExport.node
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

function isInsideNodeModules(path: string): boolean {
  return path.split(/[\\/]/).includes("node_modules")
}

// The implementation files this plugin needs to escape node_modules
// together with, so their relative imports of each other keep working from
// the vendored copy.
const IMPLEMENTATION_FILES = ["plugin.tsx", "child-sessions-tracker.ts", "labels-ui.ts", "child-sessions-types.ts"]

function vendorImplementationOutsideNodeModules(packageRoot: string, version: string): string {
  const vendorDir = join(tmpdir(), `opencode-subagents-view-vendor-${version}`)
  const vendorSrcDir = join(vendorDir, "src")
  mkdirSync(vendorSrcDir, { recursive: true })

  const srcDir = join(packageRoot, "src")
  for (const file of IMPLEMENTATION_FILES) {
    writeFileSync(join(vendorSrcDir, file), readFileSync(join(srcDir, file)))
  }

  // Symlinked back to this package's own node_modules (its parent, since
  // solid-js/@opentui/solid/@opentui/core are installed as siblings of this
  // package, not nested inside it), so the vendored copy still resolves its
  // dependencies normally, unaffected by moving out of node_modules itself.
  const vendorNodeModules = join(vendorDir, "node_modules")
  if (!existsSync(vendorNodeModules)) {
    symlinkSync(dirname(packageRoot), vendorNodeModules)
  }

  return join(vendorSrcDir, "plugin.tsx")
}

function resolveImplementationPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const packageRoot = dirname(here)

  patchSolidJsExports(here)

  if (!isInsideNodeModules(packageRoot)) return join(here, "plugin.tsx")

  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"))
  return vendorImplementationOutsideNodeModules(packageRoot, pkg.version)
}

// Typed against the authored source file (for tsc); loaded at runtime from
// whichever path resolveImplementationPath() decides on above.
type PluginModule = typeof import("./plugin")
const impl = (await import(resolveImplementationPath())) as PluginModule

export const getOrCreateChildSessions = impl.getOrCreateChildSessions
export const getOrCreateChildSessionsCollapsed = impl.getOrCreateChildSessionsCollapsed
export default impl.default
