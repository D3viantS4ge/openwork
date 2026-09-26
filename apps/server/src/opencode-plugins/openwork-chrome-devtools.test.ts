import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { server } from "./openwork-chrome-devtools.js";

const originalUiControlDiscovery = process.env.OPENWORK_UI_CONTROL_DISCOVERY;
const stops: Array<() => void> = [];

afterEach(() => {
  while (stops.length) stops.pop()?.();
  if (originalUiControlDiscovery === undefined) delete process.env.OPENWORK_UI_CONTROL_DISCOVERY;
  else process.env.OPENWORK_UI_CONTROL_DISCOVERY = originalUiControlDiscovery;
});

async function startFakeUiDiscovery() {
  const directory = await mkdtemp(join(tmpdir(), "openwork-chrome-devtools-ui-"));
  const discoveryPath = join(directory, "openwork-ui-control.json");
  await writeFile(discoveryPath, JSON.stringify({
    baseUrl: "http://127.0.0.1:1",
    token: "chrome-devtools-test-token",
  }));
  process.env.OPENWORK_UI_CONTROL_DISCOVERY = discoveryPath;
  stops.push(() => void rm(directory, { recursive: true, force: true }));
}

describe("openwork-chrome-devtools plugin registration", () => {
  test("registers no browser tools when no desktop bridge is discoverable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openwork-no-chrome-devtools-ui-"));
    process.env.OPENWORK_UI_CONTROL_DISCOVERY = join(directory, "missing-openwork-ui-control.json");
    stops.push(() => void rm(directory, { recursive: true, force: true }));

    const hooks = await server();

    expect(hooks.tool).toEqual({});
  });

  test("registers the conversation-scoped browser tools when a desktop bridge is discoverable", async () => {
    await startFakeUiDiscovery();

    const hooks = await server();

    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
      "browser_act",
      "browser_handoff",
      "browser_navigate",
      "browser_observe",
      "browser_open",
      "browser_tabs",
    ]);
  });
});
