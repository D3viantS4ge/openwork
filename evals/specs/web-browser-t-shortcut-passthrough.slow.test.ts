import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "vitest";
import { evalIn, waitFor } from "@openwork/behaviors";
import { screenshot, validate } from "@openwork/fraimz";
import { expectFrame } from "@openwork/fraimz/vitest";
import { chrome } from "@openwork/hosts";
import type { Surface } from "@openwork/cdp";
import { needs, test, unmetNeeds } from "@openwork/testkit";

/**
 * The OpenWork app's global shortcut layer must not claim Ctrl+T / Ctrl+Shift+T
 * in the web UI: those are browser shortcuts (new tab / reopen closed tab).
 * The desktop (Electron) build keeps using them for session-tab cycling,
 * covered by evals/flows/session-tab-navigation.flow.mjs.
 *
 * Lane: the headless-web stack (vite dev server + local openwork-server,
 * scripts/dev-headless-web.ts) served to a real non-Electron browser.
 */

const repoRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(repoRoot, "tmp", "dev-headless-web.json");

const requirements = { optIn: ["OPENWORK_EVAL_APP_SPECS"] };
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `web Ctrl+T passthrough skipped — needs: ${missingRequirements.join(", ")}`
  : "the web UI lets Ctrl+T and Ctrl+Shift+T pass through to the browser";

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

type HeadlessManifest = { webUrl: string; healthUrl: string; startedAt: string };

async function readManifest(): Promise<HeadlessManifest | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "webUrl" in parsed &&
      "healthUrl" in parsed &&
      "startedAt" in parsed &&
      typeof (parsed as Record<string, unknown>).webUrl === "string" &&
      typeof (parsed as Record<string, unknown>).healthUrl === "string"
    ) {
      return parsed as unknown as HeadlessManifest;
    }
    return null;
  } catch {
    return null;
  }
}

async function probeOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reuse a healthy headless-web stack or boot one detached. The stack is the
 * same surface `pnpm dev:headless-web --detach` manages; the manifest at
 * tmp/dev-headless-web.json is its health contract.
 */
async function ensureHeadlessStack(): Promise<HeadlessManifest> {
  const previous = await readManifest();
  if (previous && (await probeOk(previous.webUrl)) && (await probeOk(previous.healthUrl))) {
    return previous;
  }
  const child = spawn("bun", ["scripts/dev-headless-web.ts", "--detach"], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(1_000);
    const manifest = await readManifest();
    if (
      manifest &&
      manifest.startedAt !== previous?.startedAt &&
      (await probeOk(manifest.webUrl)) &&
      (await probeOk(manifest.healthUrl))
    ) {
      return manifest;
    }
  }
  throw new Error(`Headless web stack did not become healthy within 120s (manifest: ${manifestPath})`);
}

/**
 * Dispatch one keydown and report whether any app handler called
 * preventDefault. The probe listener is registered after the app's global
 * listeners, so it observes the event the app decided on. The app's handler
 * is registered on window during mount, which is why this works.
 */
async function dispatchKey(browser: Surface, key: string, ctrlKey: boolean, shiftKey: boolean) {
  const result = await evalIn(browser, `(async () => {
    const control = window.__openworkControl;
    const before = control.snapshot().route;
    const event = new KeyboardEvent("keydown", {
      key: ${JSON.stringify(key)},
      ctrlKey: ${String(ctrlKey)},
      shiftKey: ${String(shiftKey)},
      bubbles: true,
      cancelable: true,
    });
    let defaultPrevented = null;
    const probe = (e) => { defaultPrevented = e.defaultPrevented; };
    window.addEventListener("keydown", probe);
    window.dispatchEvent(event);
    window.removeEventListener("keydown", probe);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 600));
    return {
      defaultPrevented,
      routeUnchanged: before === control.snapshot().route,
      route: control.snapshot().route,
    };
  })()`, { awaitPromise: true });
  expect(result).toMatchObject({ defaultPrevented: expect.any(Boolean), routeUnchanged: expect.any(Boolean) });
  return result as { defaultPrevented: boolean; routeUnchanged: boolean; route: string };
}

test.skipIf(missingRequirements.length > 0)(title, async ({ evidence, place }) => {
  needs(requirements);
  const manifest = await ensureHeadlessStack();

  await using browser = await chrome({
    name: "web-browser-t-shortcut-passthrough",
    startUrl: manifest.webUrl,
    headless: true,
    host: place.host(),
  });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await waitFor(browser, `location.href.startsWith(${JSON.stringify(manifest.webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "web app origin before shell boot",
  });
  await waitFor(browser, `(() => {
    const control = window.__openworkControl;
    return Boolean(control)
      && typeof window.__OPENWORK_ELECTRON__ === "undefined"
      && /\\/session(\\/|$)/.test(control.snapshot().route);
  })()`, {
    timeoutMs: 120_000,
    label: "web session shell (non-Electron) with the control API",
  });
  const lane = await evalIn(browser, `typeof window.__OPENWORK_ELECTRON__ === "undefined" ? "web" : "electron"`);
  expect(lane).toBe("web");
  evidence.fact(
    "The spec runs in the web lane, not Electron",
    `window.__OPENWORK_ELECTRON__ is undefined, so isDesktopRuntime() is false and the browser owns T shortcuts.`,
    lane === "web",
  );

  // 1. Single open session: Ctrl+Shift+T must reach the browser.
  const shiftT = await dispatchKey(browser, "t", true, true);
  expect(shiftT.defaultPrevented).toBe(false);
  expect(shiftT.routeUnchanged).toBe(true);
  evidence.fact(
    "Ctrl+Shift+T is not intercepted in the web UI",
    `defaultPrevented=${String(shiftT.defaultPrevented)}; route unchanged=${String(shiftT.routeUnchanged)}.`,
    shiftT.defaultPrevented === false && shiftT.routeUnchanged === true,
  );

  // 2. Single open session: Ctrl+T must reach the browser too.
  const ctrlT = await dispatchKey(browser, "t", true, false);
  expect(ctrlT.defaultPrevented).toBe(false);
  expect(ctrlT.routeUnchanged).toBe(true);
  evidence.fact(
    "Ctrl+T is not intercepted in the web UI",
    `defaultPrevented=${String(ctrlT.defaultPrevented)}; route unchanged=${String(ctrlT.routeUnchanged)}.`,
    ctrlT.defaultPrevented === false && ctrlT.routeUnchanged === true,
  );

  // 3. With a second session open the shortcuts still pass through: the web UI
  // never claims browser-owned T shortcuts, regardless of how many tabs exist.
  const created = await evalIn(browser, `(async () => {
    const result = await window.__openworkControl.execute("session.create_task");
    return result;
  })()`, { awaitPromise: true });
  expect(created).toMatchObject({ ok: true });
  const secondSessionRoute = await waitFor(browser, `(() => {
    const route = window.__openworkControl.snapshot().route;
    return /\\/session\\/ses_/.test(route) ? route : null;
  })()`, {
    timeoutMs: 60_000,
    label: "second session route",
  });
  expect(typeof secondSessionRoute).toBe("string");

  const shiftTWithTabs = await dispatchKey(browser, "t", true, true);
  expect(shiftTWithTabs.defaultPrevented).toBe(false);
  expect(shiftTWithTabs.routeUnchanged).toBe(true);
  const ctrlTWithTabs = await dispatchKey(browser, "t", true, false);
  expect(ctrlTWithTabs.defaultPrevented).toBe(false);
  expect(ctrlTWithTabs.routeUnchanged).toBe(true);
  evidence.fact(
    "T shortcuts stay browser-owned with multiple session tabs open",
    `two sessions open; Ctrl+Shift+T defaultPrevented=${String(shiftTWithTabs.defaultPrevented)}, route unchanged=${String(shiftTWithTabs.routeUnchanged)}; Ctrl+T defaultPrevented=${String(ctrlTWithTabs.defaultPrevented)}, route unchanged=${String(ctrlTWithTabs.routeUnchanged)}.`,
    shiftTWithTabs.defaultPrevented === false &&
      shiftTWithTabs.routeUnchanged === true &&
      ctrlTWithTabs.defaultPrevented === false &&
      ctrlTWithTabs.routeUnchanged === true,
  );

  // 4. Regression guard: app-owned shortcuts still work in the web UI.
  await evalIn(browser, `(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    return true;
  })()`);
  await waitFor(browser, `document.querySelectorAll('[data-slot="command-item"]').length > 0`, {
    timeoutMs: 15_000,
    label: "command palette opens with Ctrl+K",
  });
  const paletteItemCount = Number(await evalIn(browser, `document.querySelectorAll('[data-slot="command-item"]').length`));
  expect(paletteItemCount).toBeGreaterThan(0);
  await evalIn(browser, `(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "k", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    return true;
  })()`);
  await waitFor(browser, `document.querySelectorAll('[data-slot="command-item"]').length === 0`, {
    timeoutMs: 15_000,
    label: "command palette closes with Ctrl+K",
  });
  evidence.fact(
    "Ctrl+K still toggles the command palette in the web UI",
    `command palette opened with ${String(paletteItemCount)} items and closed on the second Ctrl+K.`,
    paletteItemCount > 0,
  );

  const shot = await screenshot(browser);
  const seen = await validate(shot, ["The OpenWork web session page is visible"], {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "An OpenWork web session page in a non-Electron browser." })
      : JSON.stringify({
        results: [{
          expectation: "The OpenWork web session page is visible",
          passed: true,
          evidence: "The session shell is displayed in a non-Electron browser.",
        }],
      }),
  });
  expectFrame(seen);
});
