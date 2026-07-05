# opencode-subagent-view
A terminal UI plugin for OpenCode that adds a live "Subagents" panel to the session sidebar, showing which sub-agents are running, idle, or just finished, their type, and current activity, so you're not left staring at a generic "Delegating..." message. Unofficial community project, not affiliated with the OpenCode team.

## Installation

> **Status**: not yet published to npm. Use the "from source" instructions below for now.

### From source (current)

1. Clone this repo somewhere on your machine, e.g.:

   ```bash
   git clone git@github.com:giovannic96/opencode-subagent-view.git ~/repos/personal/opencode-subagent-view
   ```

2. Install its dependencies:

   ```bash
   cd ~/repos/personal/opencode-subagent-view
   npm install
   ```

   This also runs a `postinstall` script (`patch-package`) that patches a Bun-specific module resolution issue in `solid-js` (see [Why there's a patch for solid-js](#why-theres-a-patch-for-solid-js) below). Without it, the panel will compute correctly internally but never actually update on screen.

3. Register it in a **`tui.json`** (or `tui.jsonc`) file, not `opencode.json`. This plugin only exports a `tui` entrypoint, and opencode resolves TUI-kind plugins through a separate config file dedicated to TUI settings, independent from the main `opencode.json`. Use the global one (`~/.config/opencode/tui.json`) so it's available in every project, or a project-level `tui.json` if you only want it there:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["/absolute/path/to/opencode-subagent-view"]
   }
   ```

   Two things worth knowing, both learned the hard way while building this:
   - Dropping this folder into `.opencode/plugins/` (or `~/.config/opencode/plugins/`) will **not** work on its own, since opencode's auto-discovery for that folder only picks up bare `.ts`/`.js` files, not a package-shaped directory like this one.
   - Putting the `plugin` entry in `opencode.json` instead of `tui.json` also will not work: that only affects server-side plugin loading. TUI-kind plugins (like this one) are resolved by a separate config pipeline that reads `tui.json`/`tui.jsonc` specifically.

4. Quit and restart opencode. Config and plugins are only read at startup, so a running session won't pick up the change.

5. Confirm it actually loaded (not just that config accepted it) by opening the command palette (`ctrl+p`) and selecting **Plugins**. Look for `subagent-view` under "External" with a green **active** status.

   Note: `opencode debug info` is **not** a reliable check for this. It only echoes what the config declares, not whether the plugin actually resolved and loaded at runtime, so it can report success even when nothing actually loaded.

### From npm (once published)

Same caveat applies: put this in `tui.json`/`tui.jsonc`, not `opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-subagent-view"]
}
```

## How it works

This is a plain TUI plugin, not a fork or patch of opencode itself. It hooks into the same `sidebar_content` slot that the built-in Context, LSP, MCP, and Todo sections use, so it renders as just another section in the existing sidebar rather than a separate window or overlay.

> **Status**: being built incrementally, one small, tested, verified-in-a-real-session step at a time. Currently implemented and verified:
> - A "Subagents (N)" section appears in the sidebar as soon as the current session has at least one direct child session (e.g. one spawned via the `task` tool), and disappears again once it has none. It updates live as subagents finish and go idle, no restart needed.
> - The section now renders one row per tracked child, showing a label plus the current status.
>
> Not yet implemented: current activity, the auto-hide grace period after a subagent finishes, and colors. See the repo's commit history for what's landed so far.

### Code layout

- `src/child-sessions-tracker.ts`: session membership logic plus the live session subscription. Plain data in, data out.
- `src/child-sessions-types.ts`: shared child-session and event types.
- `src/tui.tsx`: the only file that touches solid-js (`createSignal`) and JSX, kept as thin as possible on purpose (see "Why all the solid-js code lives in one file" below). Registers the section at `order: 350` in the shared `sidebar_content` slot (built-ins: Context=100, MCP=200, LSP=300, Todo=400, Files=500), placing it right after LSP, before Todo.

### Why all the solid-js code lives in one file

Earlier in this project, `createSignal`/`createEffect` usage was split across two files (a store file and a component file). Confirmed by direct reference-equality checks at the time: despite resolving to the same file path, the two files ended up with genuinely different `solid-js` module instances, so a signal update made in one file silently never notified a subscriber registered in the other. The fix was consolidating all solid-js usage into this single file. Everything that doesn't call `createSignal`/`createEffect` directly (the two files above) can safely live elsewhere, plain TypeScript modules don't have this problem, only solid-js's own reactive primitives do.

### Development

- `npm test` (or `bun test`) runs the test suite. Session-tracking rules and the plugin's reactive wiring are tested together in `tests/child-sessions-tracker.test.ts` using plain mocks and solid-js's `createRoot`, without needing a real opencode instance.
- `npm run typecheck` runs `tsc --noEmit`.

### A real bug this project hit, and how it's guarded against now

An early version of the "Subagents (N)" line looked correct in isolated testing (right data, no crash) but froze a real session as soon as it actually had a subagent to show. Root cause, confirmed by reproducing it deliberately: the host legitimately calls a slot's render function more than once for the same session under normal operation (observed: twice, several seconds apart). That's fine on its own, but the plugin's code created a brand new signal and kicked off a brand new `client.session.children()` request on *every single one* of those calls. Each call's freshly-empty state transitioning to "has 1 child" apparently triggered another such call, compounding into an uncontrolled feedback loop, one reproduction hit over 20,000 renders in about 26 seconds and crashed the renderer outright.

The fix (see `getOrCreateChildSessionCount` in `src/tui.tsx`) caches state per session id for the plugin's lifetime instead of per render, so only the first call for a given session ever does real work; later calls just read the already-settled state, which can't restart the cycle. `tests/tui.test.ts` has a test that specifically pins this down, and the fix was also re-verified against the original real reproduction (a live `task`-tool delegation, not just a synthetic test) before being considered fixed.

The current implementation keeps a record for each child session. Active children count toward the sidebar number, idle children stay visible for future UI work, and deleted children are removed entirely.

One subtle but important detail: the cache does **not** store the count itself. It stores the function returned by `getOrCreateChildSessionCount`, and that function closes over a Solid signal. The signal changes when `setChildIds(...)` runs, but the cached function stays the same, so every later call to `childSessionCount()` still reads the latest number. That is why caching the function is enough, even though the cache entry itself is only written once.

The full flow is:

1. `View(...)` renders for a specific `session_id`.
2. `getOrCreateChildSessionCount(...)` checks whether that session already has a cached getter.
3. On the first render for that session, it creates a Solid signal with an empty `Set` of child ids.
4. `trackChildSessions(...)` subscribes to live `session.created`, `session.updated`, `session.status`, `session.idle`, `session.deleted`, `session.next.step.ended`, and `session.next.step.failed` events.
5. The live events are handled a little differently:
   - `session.created`: if the new session belongs to the current parent, it is added as `active`.
   - `session.updated`: if the session still belongs to the current parent and is already tracked, it stays in whatever state it already had; if it no longer belongs, it is removed.
   - `session.status` and `session.idle`: when a tracked child becomes idle, it stays in the map but is marked `idle`.
   - `session.next.step.ended` and `session.next.step.failed`: when a tracked child finishes a step, it is marked `idle`.
   - `session.deleted`: if the deleted session id was in the map, it is removed.
   - Those event names are defined once in `src/child-sessions-types.ts` and the type is derived from that list, so the code does not repeat the union in multiple places.
6. Whenever one of those cases changes the set, `setChildIds(...)` replaces the signal with a new set.
7. Solid notices that `childIds()` changed, so `childSessionCount()` is re-evaluated.
8. The sidebar now shows the updated `Subagents (N)` value.
9. If the same session is rendered again, the cached getter is reused instead of creating a new signal or a new listener.
10. When the plugin/view is being shut down, for example when you quit opencode, close the terminal, or disable/reload the plugin, the `onDispose(...)` callback runs. It calls `unsubscribe()` so the live event listeners stop and the cached entry for that session is removed.
11. That cleanup matters because otherwise the plugin would keep listening to old session events even after the view is gone.

### Real Example

Suppose the current session is `A`.

- At first, there are no live child-session events yet, so the sidebar stays hidden.
- Later, opencode creates a new session `B` with `parentID: "A"`.
- A `session.created` event arrives.
- `updateChildSessionMembership(...)` sees that `B` belongs to `A`, so it adds `B` to the set.
- The count changes from `0` to `1`, and the sidebar shows `Subagents (1)`.
- If `B` later becomes idle, the `session.idle` or `session.status` event keeps it in the record map but marks it `idle`.
- If `B` finishes a step, the `session.next.step.ended` or `session.next.step.failed` event marks it `idle`.
- If OpenCode emits a later `session.updated` for `B`, the plugin keeps it idle instead of reactivating it.
- If `B` is deleted, the `session.deleted` event removes it from the map.
- The count goes back to `0`, and the sidebar hides again.

### Why there's a patch for solid-js

`solid-js` publishes a conditional `exports` map with a `"node"` condition that points at its server-side rendering build, a one-shot, non-reactive implementation meant for frameworks that render HTML once on a Node.js backend. Bun explicitly supports and matches that `"node"` condition for compatibility with the wider Node ecosystem.

That's the right choice for a typical Node.js backend, but wrong here: this plugin runs inside an interactive terminal UI, not a one-shot server render, and needs the same reactive build (the one `solid-js`'s `"browser"`/default condition points to) that `@opentui/solid` itself expects. Because opencode dynamically imports this plugin's own unbundled `node_modules` at runtime (rather than bundling it ahead of time the way opencode's own internal UI code is built), Bun's normal condition matching kicks in and picks the wrong one.

The symptom, if this isn't patched, is subtle and confusing: `createSignal`, `createEffect`, and `createMemo` all still exist and don't throw, but nothing created with them ever updates after the initial render, because the resolved `solid-js` build's `createEffect` is a literal no-op and its signals don't notify subscribers.

`patches/solid-js+1.9.12.patch` removes that `"node"` condition from `solid-js`'s own `package.json`, applied automatically on install by [`patch-package`](https://github.com/ds300/patch-package) (a standard, widely-used tool for exactly this situation, patching a third-party dependency without forking it). The patch is a plain, five-line diff, reviewable in the file itself. `patch-package` fails the install loudly if a future `solid-js` upgrade makes the patch no longer apply cleanly, rather than silently doing nothing.
