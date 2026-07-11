// solid-js's conditional `exports` map can resolve to its non-reactive SSR
// build under some hosts (see README, "Why this plugin patches solid-js's
// exports at runtime"). Test files that need solid-js primitives directly
// (not through the plugin's own patched load path) import the reactive
// build via its explicit dist path instead of the bare `solid-js`
// specifier, since that deep path is unconditional. It has no bundled type
// declarations of its own, so this shim re-exports the regular `solid-js`
// types for it, since the public API is identical between the entry points.
declare module "solid-js/dist/solid.js" {
  export * from "solid-js"
}
