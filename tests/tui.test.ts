import { createEffect, createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import { getOrCreateChildSessions } from "../src/tui"
import { countActiveChildSessions } from "../src/child-sessions-tracker"
import type { ChildSessionEvent, ChildSessionEventType, ChildSessionRecord, ChildSessionRecords } from "../src/child-sessions-types"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

let sessionCounter = 0
/** A fresh id per test, since the cache under test is keyed by session id and lives at module scope. */
function uniqueSessionID() {
  sessionCounter += 1
  return `ses_parent_${sessionCounter}`
}

/** A fake `api.event.on` good enough to drive the reactive wiring in isolation. */
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

/** Stands in for `api.lifecycle.onDispose`: collects cleanup callbacks so a test can invoke them on demand. */
function createDisposeCollector() {
  const fns: Array<() => void> = []
  return {
    onDispose: (fn: () => void) => fns.push(fn),
    disposeAll: () => {
      for (const fn of fns) fn()
    },
  }
}

const flush = () => Promise.resolve().then(() => Promise.resolve())

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

describe("getOrCreateChildSessions", () => {
  test("starts at 0 before any live events arrive", () => {
    const sessionID = uniqueSessionID()
    const { api } = createMockApi()
    const records = getOrCreateChildSessions(api, sessionID, createDisposeCollector().onDispose)
    expect(countActiveChildSessions(records())).toBe(0)
  })

  // Regression test for a real bug that hung a real opencode session; see
  // README("A real bug this project hit") for the full story.
  test("calling it twice for the same session reuses state and only fetches once", async () => {
    const sessionID = uniqueSessionID()
    const { api } = createMockApi()
    const { onDispose } = createDisposeCollector()

    const first = getOrCreateChildSessions(api, sessionID, onDispose)
    const second = getOrCreateChildSessions(api, sessionID, onDispose)

    expect(second).toBe(first)
    await flush()
    expect(countActiveChildSessions(first())).toBe(0)
  })

  test("different sessions get independent state", async () => {
    const sessionA = uniqueSessionID()
    const sessionB = uniqueSessionID()
    const { api: apiA } = createMockApi()
    const { api: apiB } = createMockApi()
    const { onDispose } = createDisposeCollector()

    const countA = getOrCreateChildSessions(apiA, sessionA, onDispose)
    const countB = getOrCreateChildSessions(apiB, sessionB, onDispose)

    await flush()
    expect(countActiveChildSessions(countA())).toBe(0)
    expect(countActiveChildSessions(countB())).toBe(0)
  })

  test("idle children stay tracked while the active count drops", async () => {
    const sessionID = uniqueSessionID()
    const seen: number[] = []
    const { api, emit } = createMockApi()
    const { onDispose } = createDisposeCollector()
    let dispose!: () => void

    createRoot((d) => {
      dispose = d
      const records = getOrCreateChildSessions(api, sessionID, onDispose)
      createEffect(() => {
        seen.push(countActiveChildSessions(records()))
      })
    })

    await flush()
    expect(seen).toEqual([0])

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: sessionID } } })
    await flush()
    expect(seen).toEqual([0, 1])

    emit({ type: "session.next.step.ended", properties: { sessionID: "ses_a" } })
    await flush()
    expect(seen).toEqual([0, 1, 0])

    dispose()
  })

  test("disposing unsubscribes all event handlers (no leaks)", () => {
    const sessionID = uniqueSessionID()
    const { api, subscriberCount } = createMockApi()
    const { onDispose, disposeAll } = createDisposeCollector()

    getOrCreateChildSessions(api, sessionID, onDispose)
    expect(subscriberCount()).toBeGreaterThan(0)

    disposeAll()
    expect(subscriberCount()).toBe(0)
  })

  // Guards against a regression in our own wiring (e.g. mutating the Set in
  // place and returning the same reference by mistake, which would stop a
  // reactive subscriber from rerunning). Not a test of the solid-js "node"
  // export condition patch, bun test's own resolution isn't affected by
  // that either way (verified separately).
  test("a reactive subscriber (createEffect) reruns as the count rises and falls", async () => {
    const sessionID = uniqueSessionID()
    const seen: number[] = []
    const { api, emit } = createMockApi()
    const { onDispose } = createDisposeCollector()
    let dispose!: () => void

    createRoot((d) => {
      dispose = d
      const records = getOrCreateChildSessions(api, sessionID, onDispose)
      createEffect(() => {
        seen.push(countActiveChildSessions(records()))
      })
    })

    await flush()
    expect(seen).toEqual([0])

    emit({ type: "session.created", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: sessionID } } })
    await flush()
    expect(seen).toEqual([0, 1])

    emit({ type: "session.created", properties: { sessionID: "ses_b", info: { id: "ses_b", parentID: sessionID } } })
    await flush()
    expect(seen).toEqual([0, 1, 2])

    emit({ type: "session.next.step.ended", properties: { sessionID: "ses_b" } })
    await flush()
    expect(seen).toEqual([0, 1, 2, 1])

    emit({ type: "session.deleted", properties: { sessionID: "ses_a", info: { id: "ses_a", parentID: sessionID } } })
    await flush()
    expect(seen).toEqual([0, 1, 2, 1, 0])

    dispose()
  })
})
