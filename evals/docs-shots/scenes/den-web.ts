import { fill, waitFor } from "@openwork/behaviors";
import type { Scene } from "../scene.ts";

export const denPluginDetail: Scene = {
  id: "den-plugin-detail",
  title: "Cloud dashboard: plugin detail with Add skill",
  out: "packages/docs/images/cloud-plugin-add-skill.png",
  run: async (stage) => {
    const { pluginIds } = await stage.cloud();
    const browser = await stage.denWeb(`/dashboard/plugins/${pluginIds[0]}`);
    await waitFor(browser, `document.body.innerText.includes("Add skill")`, {
      timeoutMs: 60_000,
      label: "plugin detail with Add skill",
    });
    return browser;
  },
  gate: {
    requireText: ["Customer Research", "Add skill"],
    rejectText: ["Checking workspace access"],
  },
};

export const denSkillEditor: Scene = {
  id: "den-skill-editor",
  title: "Cloud dashboard: SkillEditorScreen (Plugins > plugin > Add skill)",
  out: "packages/docs/images/cloud-skill-editor.png",
  run: async (stage) => {
    const { pluginIds } = await stage.cloud();
    const browser = await stage.denWeb(`/dashboard/plugins/${pluginIds[0]}/skills/new`);
    await waitFor(browser, `Boolean(document.querySelector('input[placeholder="e.g. customer-research"]'))`, {
      timeoutMs: 60_000,
      label: "skill editor form",
    });
    await fill(browser, 'input[placeholder="e.g. customer-research"]', "call-brief");
    await fill(browser, 'input[placeholder="When should an agent use this skill?"]', "Prepare a one-page brief before a customer call.");
    await fill(browser, 'textarea[placeholder^="# Instructions"]', "# Instructions\n\n1. Pull the account's recent activity.\n2. Summarize the goal of the call in two sentences.\n3. List the three questions to ask.");
    return browser;
  },
  viewport: { width: 1440, height: 1160, deviceScaleFactor: 2 },
  gate: {
    requireText: ["Name", "Description", "Skill body", "Create skill"],
  },
};

export const denOpenworkWeb: Scene = {
  id: "den-openwork-web",
  title: "Cloud dashboard: OpenWork Web page",
  out: "packages/docs/images/cloud-openwork-web.png",
  run: async (stage) => {
    const browser = await stage.denWeb("/dashboard/web");
    await waitFor(browser, `document.body.innerText.includes("Open OpenWork Web")`, {
      timeoutMs: 60_000,
      label: "OpenWork Web page",
    });
    return browser;
  },
  gate: {
    requireText: ["OpenWork Web", "Open OpenWork Web"],
    rejectText: ["Checking workspace access"],
  },
};
