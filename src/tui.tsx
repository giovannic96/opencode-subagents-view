import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, Show } from "solid-js"
import { countActiveChildSessions, trackChildSessions } from "./child-sessions-tracker"
import type { ChildSessionRecords } from "./child-sessions-types"

const id = "subagent-view"

// Cached per session id instead of created fresh per render: repeated render
// calls must reuse existing state, not restart it. See README ("A real bug
// this project hit") for why.
const childSessionCounts = new Map<string, () => number>()

export function getOrCreateChildSessionCount(
  api: TuiPluginApi,
  parentSessionID: string,
  onDispose: (fn: () => void) => void,
): () => number {
  const cached = childSessionCounts.get(parentSessionID)
  if (cached) return cached

  const [childSessions, setChildSessions] = createSignal<ChildSessionRecords>(new Map())
  const unsubscribe = trackChildSessions(api, parentSessionID, setChildSessions)

  onDispose(() => {
    unsubscribe()
    childSessionCounts.delete(parentSessionID)
  })

  const childSessionCount = () => countActiveChildSessions(childSessions())
  childSessionCounts.set(parentSessionID, childSessionCount)
  return childSessionCount
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const childSessionCount = getOrCreateChildSessionCount(props.api, props.session_id, props.api.lifecycle.onDispose)

  return (
    <Show when={childSessionCount() > 0}>
      <box>
        <text fg={theme().text}>
          <b>Subagents</b> ({childSessionCount()})
        </text>
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
