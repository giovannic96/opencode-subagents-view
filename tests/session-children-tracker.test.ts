import { describe, expect, test } from "bun:test"
import { trackChildSessions } from "../src/session-children-tracker"
import type { ChildSessionEvent, ChildSessionEventType } from "../src/session-children"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

const PARENT = "ses_parent"

/** A fake `api.event.on` good enough to drive this in isolation. */
function createMockApi() {
  const handlers = new Map<ChildSessionEventType, Set<(event: ChildSessionEvent) => void>>()
  const api = {
    event: {
      on(type: ChildSessionEventType, handler: (event: ChildSessionEvent) => void) {
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
function createUpdateRecorder(initial: ReadonlySet<string> = new Set()) {
  let current = initial
  return {
    update: (reducer: (current: ReadonlySet<string>) => ReadonlySet<string>) => {
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

describe("trackChildSessions", () => {
  test("a live session.created event for a new child adds it", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })

    expect([...recorder.current]).toEqual(["ses_a"])
  })

  test("a live session.deleted event removes a tracked child", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    emit({ type: "session.deleted", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })

    expect([...recorder.current]).toEqual([])
  })

  test("events for unrelated sessions are ignored", () => {
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()
    trackChildSessions(api, PARENT, recorder.update)

    emit({
      type: "session.created",
      properties: { sessionID: "ses_other", info: { id: "ses_other", parentID: "ses_not_our_parent" } },
    })

    expect([...recorder.current]).toEqual([])
  })

  test("a live event updates state even before other work settles", async () => {
    // Simulates a live event arriving right away.
    const { api, emit } = createMockApi()
    const recorder = createUpdateRecorder()

    trackChildSessions(api, PARENT, recorder.update)
    emit({ type: "session.created", properties: { sessionID: "ses_live", info: { id: "ses_live", parentID: PARENT } } })
    await flush()

    expect([...recorder.current]).toEqual(["ses_live"])
  })

  test("the returned unsubscribe function stops listening for events", () => {
    const { api, emit, subscriberCount } = createMockApi()
    const recorder = createUpdateRecorder()

    const unsubscribe = trackChildSessions(api, PARENT, recorder.update)
    expect(subscriberCount()).toBeGreaterThan(0)

    unsubscribe()
    expect(subscriberCount()).toBe(0)

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: PARENT } } })
    expect([...recorder.current]).toEqual([])
  })
})
