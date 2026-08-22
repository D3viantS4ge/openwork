import { expect } from "vitest"
import { denFetch, evalIn, go } from "@openwork/behaviors"
import { app, needs, server, test } from "@openwork/testkit"

const requirements = {
  optIn: ["OPENWORK_EVAL_E2E_TESTS", "OPENWORK_EVAL_AUTOMATION_DEPLOYMENT_GATE_E2E_TEST"],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

test("Desktop honors the published Automation availability contract", { timeout: 300_000 }, async ({ evidence, place }) => {
  needs(requirements)
  await using den = await server({
    place,
    env: { DEN_AUTOMATIONS_ENABLED: "false" },
  })

  const config = await denFetch(den.admin, "/v1/me/desktop-config", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  })
  expect(config.response.status, config.text).toBe(200)
  expect(isRecord(config.body) ? config.body.automationsEnabled : undefined).toBe(false)

  const list = await denFetch(den.admin, "/v1/automations", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  })
  expect(list.response.status, list.text).toBe(200)
  expect(isRecord(list.body) && Array.isArray(list.body.items)).toBe(true)

  const runnerTokenCallsBeforeDesktop = (await den.apiLog()).split("/v1/automation-runners/token").length - 1
  await using desktop = await app({ den, as: "admin", place })
  await go(desktop, "/automations")
  await expect.poll(
    () => evalIn(desktop, "!/^#\\/automations(?:\\?|$)/.test(location.hash)"),
    { timeout: 60_000 },
  ).toBe(true)

  const logAfterDesktopBoot = await den.apiLog()
  expect(logAfterDesktopBoot.split("/v1/automation-runners/token").length - 1)
    .toBe(runnerTokenCallsBeforeDesktop)
  expect(await den.apiLog()).toContain("Automation scheduler enabled")
  evidence.recordAssertionEvidence(
    "Desktop Automation availability",
    "Desktop redirected the disabled Automation route and did not register its runner while Den preserved existing API and scheduler behavior for published older clients.",
    true,
  )
})
