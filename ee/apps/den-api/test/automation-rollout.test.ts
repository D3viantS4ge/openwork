import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const denApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function probeAutomations(value?: string) {
  return spawnSync(process.execPath, ["--conditions", "development", "--eval", `
    const { env } = await import("./src/env.ts")
    console.log(JSON.stringify(env.automations.enabled))
  `], {
    cwd: denApiRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
      DB_MODE: "mysql",
      DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
      BETTER_AUTH_SECRET: "y".repeat(32),
      BETTER_AUTH_URL: "https://den.openwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "stub",
      ...(value === undefined ? {} : { DEN_AUTOMATIONS_ENABLED: value }),
    },
  })
}

test("Automations fail closed unless the deployment explicitly enables them", () => {
  const unset = probeAutomations()
  const disabled = probeAutomations("false")
  const enabled = probeAutomations("true")

  expect(unset.status, unset.stderr).toBe(0)
  expect(unset.stdout.trim()).toBe("false")
  expect(disabled.status, disabled.stderr).toBe(0)
  expect(disabled.stdout.trim()).toBe("false")
  expect(enabled.status, enabled.stderr).toBe(0)
  expect(enabled.stdout.trim()).toBe("true")
})

test("the availability contract ships without changing Automation execution", () => {
  const app = readFileSync(path.join(denApiRoot, "src/app.ts"), "utf8")
  const meRoutes = readFileSync(path.join(denApiRoot, "src/routes/me/index.ts"), "utf8")
  const routes = readFileSync(path.join(denApiRoot, "src/routes/automations/index.ts"), "utf8")
  const server = readFileSync(path.join(denApiRoot, "src/server.ts"), "utf8")

  expect(meRoutes).toContain("automationsEnabled: env.automations.enabled")
  expect(app).toContain("registerAutomationRoutes(app)")
  expect(routes).not.toContain("automationsDisabledResponse")
  expect(server).toContain("startAutomationSchedulerLoop()")
})
