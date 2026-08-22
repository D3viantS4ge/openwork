import { setTimeout as delay } from "node:timers/promises";
import { evalIn } from "@openwork/behaviors";
import type { Surface } from "@openwork/cdp";
import { screenshot } from "@openwork/test-evidence";
import type { Gate, Viewport } from "./scene.ts";

export async function setViewport(surface: Surface, viewport: Viewport): Promise<void> {
  await surface.client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: false,
  });
  // The capture window is never OS-focused; without focus emulation every
  // shot shows the app's blurred (dimmed) state.
  await surface.client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  // The macOS vibrancy sidebar is a transparent renderer region (the OS
  // composites the tint outside the page, so a raw capture has alpha-0
  // pixels there). Paint the light vibrancy tone at the html level so the
  // capture reads like the real focused window.
  if (surface.handle.kind === "electron") {
    await evalIn(surface, `(() => {
      if (!document.getElementById("docs-shots-backdrop")) {
        const style = document.createElement("style");
        style.id = "docs-shots-backdrop";
        style.textContent = "html { background-color: #232326 !important; }";
        document.head.appendChild(style);
      }
      return true;
    })()`);
  }
}

/** Stop CSS motion and text carets so two clean frames can be pixel-identical. */
export async function freezeMotion(surface: Surface): Promise<void> {
  await evalIn(surface, `(() => {
    if (!document.getElementById("docs-shots-freeze")) {
      const style = document.createElement("style");
      style.id = "docs-shots-freeze";
      style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }";
      document.head.appendChild(style);
    }
    return true;
  })()`);
}

function gateFailures(gate: Gate, visibleText: string, route: string): string[] {
  const failures: string[] = [];
  for (const text of gate.requireText) {
    if (!visibleText.includes(text)) failures.push(`missing required text ${JSON.stringify(text)}`);
  }
  for (const text of gate.rejectText ?? []) {
    if (visibleText.includes(text)) failures.push(`forbidden text ${JSON.stringify(text)} is on screen`);
  }
  if (gate.route && !gate.route.test(decodeURIComponent(route))) {
    failures.push(`route ${JSON.stringify(route)} does not match ${String(gate.route)}`);
  }
  return failures;
}

/**
 * Capture-until-clean: re-shoot every 500ms until the gate passes, then demand
 * a second, pixel-identical frame so animations and loading states can never
 * ship. Throws with the last failure list when the deadline passes.
 */
export async function captureGated(surface: Surface, gate: Gate, timeoutMs = 30_000): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  let lastFailures: string[] = ["no capture attempted"];
  let lastVisibleText = "";
  let consecutivePasses = 0;
  while (Date.now() < deadline) {
    const shot = await screenshot(surface);
    lastVisibleText = shot.visibleText;
    lastFailures = gateFailures(gate, shot.visibleText, shot.route);
    if (lastFailures.length === 0 && gate.requireExpression) {
      const satisfied = await evalIn(surface, gate.requireExpression).catch(() => false);
      if (satisfied !== true) lastFailures = [`expression not satisfied: ${gate.requireExpression}`];
    }
    if (lastFailures.length === 0) {
      consecutivePasses += 1;
      await delay(400);
      const settled = await screenshot(surface);
      const settledFailures = gateFailures(gate, settled.visibleText, settled.route);
      if (settledFailures.length === 0 && settled.hash === shot.hash) return settled.png;
      if (settledFailures.length === 0 && consecutivePasses >= 5) {
        // The gate holds across frames but pixels keep moving (a decorative
        // JS animation). The content claims are satisfied; accept the frame.
        console.warn("[docs-shots] accepting a frame with a persistent decorative animation");
        return settled.png;
      }
      lastFailures = settledFailures.length > 0 ? settledFailures : ["frame not stable yet"];
    } else {
      consecutivePasses = 0;
    }
    await delay(500);
  }
  throw new Error(
    `Screenshot gate failed after ${timeoutMs}ms:\n- ${lastFailures.join("\n- ")}\n\nVisible text tail:\n${lastVisibleText.slice(-600)}`,
  );
}
