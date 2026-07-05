import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { For, createSignal, Show } from "solid-js"
import { countActiveChildSessions, trackChildSessions } from "./child-sessions-tracker"
import { getChildStatusMeta } from "./child-sessions-ui"
import type { ChildSessionRecords } from "./child-sessions-types"

const id = "subagent-view"

// Cached per session id instead of created fresh per render: repeated render
// calls must reuse existing state, not restart it. See README ("A real bug
// this project hit") for why.
const childSessionRecords = new Map<string, () => ChildSessionRecords>()
const childSessionCollapsed = new Map<string, { collapsed: () => boolean; setCollapsed: (next: boolean | ((current: boolean) => boolean)) => void }>()

export function getOrCreateChildSessions(
  api: TuiPluginApi,
  parentSessionID: string,
  onDispose: (fn: () => void) => void,
): () => ChildSessionRecords {
  const cached = childSessionRecords.get(parentSessionID)
  if (cached) return cached

  const [childSessions, setChildSessions] = createSignal<ChildSessionRecords>(new Map())
  const unsubscribe = trackChildSessions(api, parentSessionID, setChildSessions)

  onDispose(() => {
    unsubscribe()
    childSessionRecords.delete(parentSessionID)
  })

  childSessionRecords.set(parentSessionID, childSessions)
  return childSessions
}

export function getOrCreateChildSessionsCollapsed(
  parentSessionID: string,
  onDispose: (fn: () => void) => void,
): [() => boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const cached = childSessionCollapsed.get(parentSessionID)
  if (cached) {
    return [cached.collapsed, cached.setCollapsed]
  }

  const [collapsed, setCollapsed] = createSignal(false)

  onDispose(() => {
    childSessionCollapsed.delete(parentSessionID)
  })

  childSessionCollapsed.set(parentSessionID, { collapsed, setCollapsed })
  return [collapsed, setCollapsed]
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const childSessions = getOrCreateChildSessions(props.api, props.session_id, props.api.lifecycle.onDispose)
  const [childSessionsCollapsed, setChildSessionsCollapsed] = getOrCreateChildSessionsCollapsed(
    props.session_id,
    props.api.lifecycle.onDispose,
  )
  const childSessionCount = () => countActiveChildSessions(childSessions())
  const childSessionRows = () => Array.from(childSessions().values()).sort((a, b) => a.id.localeCompare(b.id))
  const childSessionHeader = () => (childSessionsCollapsed() ? "▶" : "▼")

  return (
    <Show when={childSessionRows().length > 0}>
      <box
        onMouseDown={() => setChildSessionsCollapsed((current) => !current)}
      >
        <text fg={theme().text}>
          <b>{childSessionHeader()} Subagents</b> ({childSessionCount()} active)
        </text>
        <Show when={!childSessionsCollapsed()}>
          <For each={childSessionRows()}>
            {(child) => {
              const statusMeta = getChildStatusMeta(child.status)
              const currentTheme = theme()
              const fg =
                statusMeta.tone === "success"
                  ? currentTheme.success
                  : statusMeta.tone === "warning"
                    ? currentTheme.warning
                    : statusMeta.tone === "error"
                      ? currentTheme.error
                      : currentTheme.textMuted

              return <text fg={fg}>{statusMeta.icon} {child.label}</text>
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350, // after built-in LSP (300), before Todo (400)
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id,
  tui,
}

export default plugin
