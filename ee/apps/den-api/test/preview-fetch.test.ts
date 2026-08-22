import { describe, expect, test } from "bun:test"
import { createPreviewFetch, fetchWithConnectRetry, type FetchLike } from "../src/workers/preview-fetch.js"

function connectError() {
  return Object.assign(new Error("connect failed"), { code: "ECONNRESET" })
}

describe("preview fetch", () => {
  test("retries a connect-phase error once and succeeds", async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      if (calls === 1) throw connectError()
      return new Response("ok")
    }

    const response = await fetchWithConnectRetry({ fetchImpl, url: "https://preview.test", init: {} })

    expect(await response.text()).toBe("ok")
    expect(calls).toBe(2)
  })

  test("returns a successful response without retrying", async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return new Response("ok")
    }

    await fetchWithConnectRetry({ fetchImpl, url: "https://preview.test", init: {} })

    expect(calls).toBe(1)
  })

  test("does not retry a non-connect error", async () => {
    let calls = 0
    const failure = new Error("request failed")
    const fetchImpl: FetchLike = async () => {
      calls += 1
      throw failure
    }

    await expect(fetchWithConnectRetry({ fetchImpl, url: "https://preview.test", init: {} })).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  test("stops after one connect retry", async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      throw connectError()
    }

    await expect(fetchWithConnectRetry({ fetchImpl, url: "https://preview.test", init: {} })).rejects.toMatchObject({
      code: "ECONNRESET",
    })
    expect(calls).toBe(2)
  })

  test("preserves AbortSignal cancellation", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(createPreviewFetch({ connectTimeoutMs: 100 })("https://preview.test", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" })
  })
})
