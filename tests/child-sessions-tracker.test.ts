import { describe, expect, test } from "bun:test"
import { countActiveChildSessions, isChildOf, trackChildSessions, updateChildSessionRecords } from "../src/child-sessions-tracker"
import { DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH, formatChildSessionLabel, getChildSessionDisplayLabel, getChildStatusMeta, truncateChildSessionLabel } from "../src/labels-ui"
import type { ChildSessionEvent } from "../src/child-sessions-types"
import type { ChildSessionEventType, ChildSessionRecord, ChildSessionRecords } from "../src/child-sessions-types"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

const PARENT = "ses_parent"

/** A fake `api.event.on` good enough to drive this in isolation. */
function createMockApi() {
  const handlers = new Map<ChildSessionEventType, Set<(event: ChildSessionEvent) => void>>()
  const api = {
    event: {
      on(
        type: ChildSessionEventType,
        handler: (event: ChildSessionEvent) => void,
      ) {
        const set = handlers.get(type) ?? new Set()
        set.add(handler)
        handlers.set(type, set)
        return () => {
          handlers.get(type)?.delete(handler)
        }
      },
    },
  } as unknown as TuiPluginApi

  return {
    api,
    emit(event: ChildSessionEvent) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
    subscriberCount() {
      let total = 0
      for (const set of handlers.values()) total += set.size
      return total
    },
  }
}

/** Stands in for a solid-js signal setter: applies the reducer to a plain local value. */
function createUpdateRecorder(initial: ChildSessionRecords = new Map<string, ChildSessionRecord>()) {
  let current: ChildSessionRecords = initial
  return {
    update: (reducer: (current: ChildSessionRecords) => ChildSessionRecords) => {
      current = reducer(current)
    },
    get current() {
      return current
    },
  }
}

// The seed call is a real (mocked) async round-trip, so tests need to let
// its microtasks flush before asserting on the result.
const flush = () => Promise.resolve().then(() => Promise.resolve())

function createdEvent(id: string, parentID?: string): ChildSessionEvent {
  return { type: "session.created", properties: { sessionID: id, info: { id, parentID } } }
}

function updatedEvent(id: string, parentID?: string): ChildSessionEvent {
  return { type: "session.updated", properties: { sessionID: id, info: { id, parentID } } }
}

function deletedEvent(id: string, parentID?: string): ChildSessionEvent {
  return { type: "session.deleted", properties: { sessionID: id, info: { id, parentID } } }
}

function idleEvent(id: string): ChildSessionEvent {
  return { type: "session.idle", properties: { sessionID: id } }
}

function statusEvent(id: string, type: "idle" | "retry" | "busy"): ChildSessionEvent {
  return { type: "session.status", properties: { sessionID: id, status: { type } } }
}

function stepEndedEvent(id: string): ChildSessionEvent {
  return { type: "session.next.step.ended", properties: { sessionID: id } }
}

function stepFailedEvent(id: string): ChildSessionEvent {
  return { type: "session.next.step.failed", properties: { sessionID: id } }
}

describe("isChildOf", () => {
  test("true when parentID matches", () => {
    expect(isChildOf({ id: "ses_a", parentID: PARENT }, PARENT)).toBe(true)
  })

  test("false when parentID differs", () => {
    expect(isChildOf({ id: "ses_a", parentID: "ses_other" }, PARENT)).toBe(false)
  })

  test("false when parentID is missing (a root session)", () => {
    expect(isChildOf({ id: "ses_a" }, PARENT)).toBe(false)
  })
})

describe("countActiveChildSessions", () => {
  test("counts only active child records", () => {
    const records = new Map([
      ["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }],
      ["ses_b", { id: "ses_b", label: "[unknown] Cooking stuff", status: "idle" as const }],
    ])
    expect(countActiveChildSessions(records)).toBe(1)
  })
})

describe("getChildStatusMeta", () => {
  test("maps statuses to icons and tones", () => {
    expect(getChildStatusMeta("active")).toEqual({ icon: "●", tone: "success" })
    expect(getChildStatusMeta("retry")).toEqual({ icon: "◐", tone: "warning" })
    expect(getChildStatusMeta("error")).toEqual({ icon: "✖", tone: "error" })
    expect(getChildStatusMeta("idle")).toEqual({ icon: "○", tone: "muted" })
  })
})

describe("formatChildSessionLabel", () => {
  test("uses agent and title with fallback values", () => {
    expect(formatChildSessionLabel({ id: "ses_a", agent: "explore", title: "Inspect plugin purpose" })).toBe("[explore] Inspect plugin purpose")
    expect(formatChildSessionLabel({ id: "ses_b" })).toBe("[unknown] Cooking stuff")
  })

  test("strips the trailing subagent marker from the title", () => {
    expect(formatChildSessionLabel({ id: "ses_a", agent: "explore", title: "Inspect tests (@explore subagent)" })).toBe("[explore] Inspect tests")
  })
})

describe("truncateChildSessionLabel", () => {
  test("keeps short labels intact", () => {
    expect(truncateChildSessionLabel("[demo] short", DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH)).toBe("[demo] short")
  })

  test("adds an ellipsis when the label is too long", () => {
    expect(truncateChildSessionLabel("[demo] a very long child session label that needs trimming", 20)).toBe("[demo] a very long …")
  })

  test("falls back sanely for tiny widths", () => {
    expect(truncateChildSessionLabel("[demo] tiny", 1)).toBe("[")
  })

  test("does not truncate typical longer labels at the default estimate", () => {
    expect(truncateChildSessionLabel("[demo] inspect src, explain the tracker and summarize the UI", DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH)).toBe("[demo] inspect src, explain the tracker and summarize the UI")
  })

  test("uses the shared default estimate", () => {
    expect(DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH).toBe(72)
  })
})

describe("getChildSessionDisplayLabel", () => {
  test("prefers activity over the original label", () => {
    expect(getChildSessionDisplayLabel({ id: "ses_a", label: "[demo] original", status: "active", activity: "working" })).toBe("working")
  })

  test("falls back to the original label", () => {
    expect(getChildSessionDisplayLabel({ id: "ses_a", label: "[demo] original", status: "active" })).toBe("[demo] original")
  })
})

describe("updateChildSessionRecords", () => {
  test("session.created for a matching child adds it", () => {
    const before = new Map()
    const after = updateChildSessionRecords(before, PARENT, createdEvent("ses_a", PARENT))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "active" })
  })

  test("session.created prefers agent and title for the label", () => {
    const before = new Map()
    const after = updateChildSessionRecords(before, PARENT, {
      type: "session.created",
      properties: {
        sessionID: "ses_a",
        info: { id: "ses_a", parentID: PARENT, agent: "explore", title: "Inspect plugin purpose" },
      },
    })
    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[explore] Inspect plugin purpose",
      status: "active",
    })
  })

  test("session.created strips the trailing subagent marker from the title", () => {
    const before = new Map()
    const after = updateChildSessionRecords(before, PARENT, {
      type: "session.created",
      properties: {
        sessionID: "ses_a",
        info: { id: "ses_a", parentID: PARENT, agent: "explore", title: "Inspect videolist tests (@explore subagent)" },
      },
    })
    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[explore] Inspect videolist tests",
      status: "active",
    })
  })

  test("session.created falls back to unknown and Cooking stuff", () => {
    const before = new Map()
    const after = updateChildSessionRecords(before, PARENT, {
      type: "session.created",
      properties: {
        sessionID: "ses_a",
        info: { id: "ses_a", parentID: PARENT },
      },
    })
    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
    })
  })

  test("session.created for an unrelated session is a no-op and keeps the same reference", () => {
    const before = new Map([["ses_existing", { id: "ses_existing", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, createdEvent("ses_other", "ses_not_our_parent"))
    expect(after).toBe(before)
  })

  test("session.updated re-adding an already-tracked child is a no-op and keeps the same reference", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, updatedEvent("ses_a", PARENT))
    expect(after).toBe(before)
  })

  test("session.updated whose parentID no longer matches removes it (defensive case)", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, updatedEvent("ses_a", "ses_someone_else"))
    expect(after.has("ses_a")).toBe(false)
  })

  test("session.updated for an already tracked idle child does not reactivate it", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" as const }]])
    const after = updateChildSessionRecords(before, PARENT, updatedEvent("ses_a", PARENT))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.deleted removes a tracked child", () => {
    const before = new Map([
      ["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }],
      ["ses_b", { id: "ses_b", label: "[unknown] Cooking stuff", status: "idle" as const }],
    ])
    const after = updateChildSessionRecords(before, PARENT, deletedEvent("ses_a", PARENT))
    expect(after.has("ses_a")).toBe(false)
    expect(after.get("ses_b")).toEqual({ id: "ses_b", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.deleted for an id we don't track is a no-op and keeps the same reference", () => {
    const before = new Map([["ses_b", { id: "ses_b", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, deletedEvent("ses_a", PARENT))
    expect(after).toBe(before)
  })

  test("session.idle removes a tracked child", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, idleEvent("ses_a"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.status with idle removes a tracked child", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, statusEvent("ses_a", "idle"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.status busy leaves a tracked child in place", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, statusEvent("ses_a", "busy"))
    expect(after).toBe(before)
  })

  test("session.next.step.ended marks a tracked child idle", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, stepEndedEvent("ses_a"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.next.step.failed marks a tracked child error", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, stepFailedEvent("ses_a"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "error" })
  })

  test("session.next.step.ended keeps a tracked child idle", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, stepEndedEvent("ses_a"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.next.tool.called chooses a stable tool label", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, {
      type: "session.next.tool.called",
      properties: { sessionID: "ses_a", tool: "grep", input: { pattern: "src/**/*.ts" } },
    })

    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
      activity: "searching src/**/*.ts",
    })
  })

  test("session.next.tool.called reports running shell for shell tools", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, {
      type: "session.next.tool.called",
      properties: { sessionID: "ses_a", tool: "shell", input: { command: "bun test" } },
    })

    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
      activity: "running shell: bun test",
    })
  })

  test("message.part.updated prefers a finalized subtask description", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_a",
        time: 1,
        part: {
          id: "part_a",
          sessionID: "ses_a",
          messageID: "msg_a",
          type: "subtask",
          prompt: "Inspect tests",
          description: "Review the tracker tests",
          agent: "task",
        },
      },
    })

    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
      activity: "subtask: Review the tracker tests",
    })
  })

  test("message.part.updated prefers concrete tool titles when available", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_a",
        time: 1,
        part: {
          id: "part_a",
          sessionID: "ses_a",
          messageID: "msg_a",
          type: "tool",
          callID: "call_a",
          tool: "glob",
          state: { status: "completed", input: {}, output: "", title: "src/**/*.ts", metadata: {}, time: { start: 1, end: 2 } },
        },
      },
    })

    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
      activity: "glob: src/**/*.ts",
    })
  })

  test("message.part.updated uses text directly", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const }]])
    const after = updateChildSessionRecords(before, PARENT, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_a",
        time: 1,
        part: {
          id: "part_a",
          sessionID: "ses_a",
          messageID: "msg_a",
          type: "text",
          text: "drafting the summary for the next step",
          time: { start: 1 },
        },
      },
    })

    expect(after.get("ses_a")).toEqual({
      id: "ses_a",
      label: "[unknown] Cooking stuff",
      status: "active",
      activity: "drafting the summary for the next step",
    })
  })

  test("session.next.step.ended clears the live activity label", () => {
    const before = new Map([["ses_a", { id: "ses_a", label: "[unknown] Cooking stuff", status: "active" as const, activity: "writing a summary" }]])
    const after = updateChildSessionRecords(before, PARENT, stepEndedEvent("ses_a"))
    expect(after.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("session.created clears old idle children when a new run starts", () => {
    const before = new Map([
      ["ses_old_a", { id: "ses_old_a", label: "[unknown] Cooking stuff", status: "idle" as const }],
      ["ses_old_b", { id: "ses_old_b", label: "[unknown] Cooking stuff", status: "idle" as const }],
    ])

    const after = updateChildSessionRecords(before, PARENT, createdEvent("ses_new", PARENT))

    expect(after.has("ses_old_a")).toBe(false)
    expect(after.has("ses_old_b")).toBe(false)
    expect(after.get("ses_new")).toEqual({ id: "ses_new", label: "[unknown] Cooking stuff", status: "active" })
  })

  test("session.created keeps existing active children and idle ones when a run is already active", () => {
    const before = new Map([
      ["ses_active", { id: "ses_active", label: "[unknown] Cooking stuff", status: "active" as const }],
      ["ses_idle", { id: "ses_idle", label: "[unknown] Cooking stuff", status: "idle" as const }],
    ])

    const after = updateChildSessionRecords(before, PARENT, createdEvent("ses_new", PARENT))

    expect(after.get("ses_active")).toEqual({ id: "ses_active", label: "[unknown] Cooking stuff", status: "active" })
    expect(after.get("ses_idle")).toEqual({ id: "ses_idle", label: "[unknown] Cooking stuff", status: "idle" })
    expect(after.get("ses_new")).toEqual({ id: "ses_new", label: "[unknown] Cooking stuff", status: "active" })
  })

})

describe("trackChildSessions", () => {
  test("a live session.created event for a new child adds it", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })

    expect(recorder.current.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "active" })
  })

  test("a live session.deleted event removes a tracked child", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.deleted", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })

    expect(recorder.current.has("ses_a")).toBe(false)
  })

  test("a live session.idle event removes a tracked child", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.idle", properties: { sessionID: "ses_a" } })

    expect(recorder.current.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("a live session.status idle event removes a tracked child", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.status", properties: { sessionID: "ses_a", status: { type: "idle" } } })

    expect(recorder.current.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("a live session.next.step.ended event marks a tracked child idle", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.next.step.ended", properties: { sessionID: "ses_a" } })

    expect(recorder.current.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("a live session.updated event does not reactivate an idle tracked child", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.idle", properties: { sessionID: "ses_a" } })
    emit({ type: "session.updated", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })

    expect(recorder.current.get("ses_a")).toEqual({ id: "ses_a", label: "[unknown] Cooking stuff", status: "idle" })
  })

  test("events for unrelated sessions are ignored", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({
      type: "session.created",
      properties: { sessionID: "ses_other", info: { id: "ses_other", parentID: "ses_not_our_parent" } },
    })

    expect(recorder.current.size).toBe(0)
  })

  test("a live event updates state even before other work settles", async () => {
    // Simulates a live event arriving right away.
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()

    trackChildSessions(api, PARENT, recorder.update)
    emit({ type: "session.created", properties: { sessionID: "ses_live", info: { id: "ses_live", parentID: PARENT } } })
    await flush()

    expect(recorder.current.get("ses_live")).toEqual({ id: "ses_live", label: "[unknown] Cooking stuff", status: "active" })
  })

  test("the returned unsubscribe function stops listening for events", () => {
    const { api, emit, subscriberCount } = createMockApi()
    const recorder = createUpdateRecorder()

    const unsubscribe = trackChildSessions(api, PARENT, recorder.update)
    expect(subscriberCount()).toBeGreaterThan(0)

    unsubscribe()
    expect(subscriberCount()).toBe(0)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    expect(recorder.current.size).toBe(0)
  })

})
