import { clickButton, fill, go, waitFor } from "@openwork/behaviors";
import type { Surface } from "@openwork/cdp";
import type { Scene } from "../scene.ts";

/** Toast noise the capture loop must wait out (sonner auto-dismisses). */
const TOAST_REJECTS = ["new notifications", "opencode_unconfigured", "OpenCode base URL"];

/** Close any open dialog/popover so scenes stay order-independent. */
async function dismissOverlays(surface: Surface): Promise<void> {
  for (const type of ["keyDown", "keyUp"] as const) {
    await surface.client.send("Input.dispatchKeyEvent", {
      type,
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
  }
}

/**
 * Expand the Library "Advanced settings" section and keep it expanded: the
 * inventory refresh re-renders the section collapsed, so re-click until the
 * expansion survives two consecutive checks.
 */
async function expandAdvancedSettings(surface: Surface): Promise<void> {
  await waitFor(surface, `document.body.innerText.includes("Advanced settings")`, {
    timeoutMs: 120_000,
    label: "Advanced settings section",
  });
  const deadline = Date.now() + 60_000;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    const expanded = await waitFor(surface, `(() => {
      if (document.body.innerText.includes("Add workspace MCP")) return true;
      const toggle = [...document.querySelectorAll("button")]
        .find((button) => (button.textContent ?? "").includes("Advanced settings"));
      if (toggle) toggle.click();
      return document.body.innerText.includes("Add workspace MCP");
    })()`, { timeoutMs: 15_000, label: "Advanced settings expanded" }).then(() => true).catch(() => false);
    if (expanded) {
      stableChecks += 1;
      if (stableChecks >= 2) return;
    } else {
      stableChecks = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Advanced settings did not stay expanded.");
}

export const librarySkills: Scene = {
  id: "library-skills",
  title: "Settings > Library filtered to Skills, with Add skill",
  out: "packages/docs/images/library-skills-add-skill.png",
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/extensions/skills`);
    await waitFor(app, `[...document.querySelectorAll("button")]
      .some((button) => (button.textContent ?? "").trim() === "Add skill")`, {
      timeoutMs: 120_000,
      label: "Add skill button on the Skills filter",
    });
    return app;
  },
  gate: {
    requireText: ["Library", "Add skill", "customer-research"],
    rejectText: ["Your library is empty.", "Loading commands", ...TOAST_REJECTS],
    route: /\/extensions\/skills$/,
  },
};

export const libraryCreateSkillModal: Scene = {
  id: "library-create-skill-modal",
  title: "Create a skill modal from Library > Add skill",
  out: "packages/docs/images/library-create-skill-modal.png",
  viewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/extensions/skills`);
    await clickButton(app, "Add skill", { timeoutMs: 120_000 });
    await waitFor(app, `document.body.innerText.includes("Create a skill")`, {
      timeoutMs: 30_000,
      label: "Create a skill modal",
    });
    await fill(app, 'input[placeholder="e.g. customer-research"]', "call-brief");
    await fill(app, 'input[placeholder="When should an agent use this skill?"]', "Prepare a one-page brief before a customer call.");
    await fill(app, 'textarea[placeholder^="# Instructions"]', "# Instructions\n\n1. Pull the account's recent activity.\n2. Summarize the goal of the call in two sentences.\n3. List the three questions to ask.");
    return app;
  },
  gate: {
    requireText: ["Create a skill", "Name", "Description", "Create skill"],
    rejectText: ["Sign in to OpenWork Cloud", ...TOAST_REJECTS],
  },
};

export const libraryAdvancedSettings: Scene = {
  id: "library-advanced-settings",
  title: "Settings > Library with Advanced settings (workspace MCP) expanded",
  out: "packages/docs/images/library-advanced-settings.png",
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/settings/extensions`);
    await expandAdvancedSettings(app);
    await waitFor(app, `(() => {
      document.querySelector("[data-inventory-group]")?.scrollIntoView({ block: "start" });
      const toggle = [...document.querySelectorAll("button")]
        .find((button) => (button.textContent ?? "").includes("Advanced settings"));
      toggle?.scrollIntoView({ block: "center" });
      return true;
    })()`, { timeoutMs: 10_000, label: "Advanced settings in view" });
    return app;
  },
  gate: {
    requireText: ["Advanced settings", "Add workspace MCP"],
    rejectText: ["Your library is empty.", ...TOAST_REJECTS],
  },
};

export const libraryAddMcpModal: Scene = {
  id: "library-add-mcp-modal",
  title: "Add workspace MCP dialog",
  out: "packages/docs/images/library-add-mcp-modal.png",
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/settings/extensions`);
    await expandAdvancedSettings(app);
    await clickButton(app, "Add workspace MCP", { timeoutMs: 30_000 });
    await waitFor(app, `document.body.innerText.includes("App name") && document.body.innerText.includes("Server URL")`, {
      timeoutMs: 30_000,
      label: "Add workspace MCP dialog",
    });
    return app;
  },
  gate: {
    requireText: ["Add workspace MCP", "App name", "Server URL", "Add App"],
    rejectText: TOAST_REJECTS,
  },
};

export const libraryAddMcpSlack: Scene = {
  id: "library-add-mcp-slack",
  title: "Add workspace MCP dialog filled for Slack with OAuth expanded",
  out: "packages/docs/images/slack-mcp-advanced-oauth.png",
  viewport: { width: 1440, height: 1100, deviceScaleFactor: 2 },
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/settings/extensions`);
    await expandAdvancedSettings(app);
    await clickButton(app, "Add workspace MCP", { timeoutMs: 30_000 });
    await waitFor(app, `document.body.innerText.includes("App name") && document.body.innerText.includes("Server URL")`, {
      timeoutMs: 30_000,
      label: "Add workspace MCP dialog",
    });
    await fill(app, 'input[placeholder="github-copilot"]', "slack");
    await fill(app, 'input[placeholder="https://api.githubcopilot.com/mcp/"]', "https://mcp.slack.com/mcp");
    await waitFor(app, `(() => {
      if (document.body.innerText.includes("OAuth client ID")) return true;
      const toggle = [...document.querySelectorAll("button")]
        .find((button) => (button.textContent ?? "").includes("OAuth on this device"));
      if (toggle) toggle.click();
      return document.body.innerText.includes("OAuth client ID");
    })()`, { timeoutMs: 15_000, label: "OAuth on this device expanded" });
    return app;
  },
  gate: {
    requireText: ["Add workspace MCP", "App name", "Server URL", "OAuth client ID", "Add App"],
    rejectText: TOAST_REJECTS,
  },
};

export const librarySlackConnection: Scene = {
  id: "library-slack-connection",
  title: "Library showing the org-shared Slack connection",
  out: "packages/docs/images/library-slack-connection.png",
  run: async (stage) => {
    const app = await stage.desktop();
    await dismissOverlays(app);
    await go(app, `/workspace/${app.workspaceId}/extensions`);
    await waitFor(app, `document.body.innerText.includes("Slack")`, {
      timeoutMs: 120_000,
      label: "Slack connection row",
    });
    return app;
  },
  gate: {
    requireText: ["Library", "Slack"],
    rejectText: ["Your library is empty.", ...TOAST_REJECTS],
    route: /\/extensions$/,
  },
};
