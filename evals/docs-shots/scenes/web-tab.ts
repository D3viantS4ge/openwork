import { waitFor } from "@openwork/behaviors";
import type { Scene } from "../scene.ts";

export const openworkWebTab: Scene = {
  id: "openwork-web-tab",
  title: "OpenWork Web open in a browser tab",
  out: "packages/docs/images/openwork-web-browser-tab.png",
  run: async (stage) => {
    const browser = await stage.webTab();
    await waitFor(browser, "Boolean(window.__openworkControl)", {
      timeoutMs: 120_000,
      label: "OpenWork Web booted",
    });
    await waitFor(browser, `document.body.innerText.includes("acme-robotics")
      && document.body.innerText.includes("Describe your task")
      && !document.body.innerText.includes("Pulling in the latest messages")`, {
      timeoutMs: 120_000,
      label: "OpenWork Web settled on the demo workspace",
    });
    return browser;
  },
  gate: {
    requireText: ["acme-robotics", "What do you need done?"],
    rejectText: [
      "Something went wrong",
      "Unable to connect",
      "Pulling in the latest messages",
      "docs-3959-screenshots",
    ],
    requireExpression: "Boolean(window.__openworkControl)",
  },
};
