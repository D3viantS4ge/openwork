import { describe, expect, test } from "bun:test";

import {
  parseRunPromptRequest,
  resolveRunPromptAgentOverrides,
  withRunPromptAgentDefaults,
} from "../src/react-app/shell/run-prompt-params";

describe("parseRunPromptRequest", () => {
  test("returns null when no message is present", () => {
    expect(parseRunPromptRequest("")).toBeNull();
    expect(parseRunPromptRequest("?model=deepseek/deepseek-v4-pro")).toBeNull();
    expect(parseRunPromptRequest("?message=%20%20")).toBeNull();
  });

  test("decodes spaces in both %20 and + forms", () => {
    expect(parseRunPromptRequest("?message=hello%20world")?.message).toBe("hello world");
    expect(parseRunPromptRequest("?message=hello+world")?.message).toBe("hello world");
  });

  test("parses model, agent and variant overrides", () => {
    const result = parseRunPromptRequest(
      "?message=hi&model=deepseek/deepseek-v4-pro&agent=build&variant=high",
    );
    expect(result).toEqual({
      message: "hi",
      overrides: {
        model: { providerID: "deepseek", modelID: "deepseek-v4-pro" },
        agent: "build",
        variant: "high",
      },
    });
  });

  test("ignores empty override params", () => {
    expect(parseRunPromptRequest("?message=hi&model=&agent=&variant=")).toEqual({
      message: "hi",
      overrides: {},
    });
  });

  test("drops a model ref with no provider/model separator", () => {
    const result = parseRunPromptRequest("?message=hi&model=noprovider");
    expect(result?.overrides.model).toBeUndefined();
  });

  test("preserves a slash inside the model id", () => {
    const result = parseRunPromptRequest("?message=hi&model=openrouter/a/b");
    expect(result?.overrides.model).toEqual({ providerID: "openrouter", modelID: "a/b" });
  });

});

const buildAgent = {
  name: "build",
  model: { providerID: "anthropic", modelID: "claude-sonnet" },
  variant: "high",
};

describe("withRunPromptAgentDefaults", () => {
  test("fills model and variant from the agent when both are omitted", () => {
    expect(withRunPromptAgentDefaults({ agent: "build" }, buildAgent)).toEqual({
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "high",
    });
  });

  test("fills the agent variant when the explicit model equals the agent model", () => {
    expect(withRunPromptAgentDefaults(
      { agent: "build", model: { providerID: "anthropic", modelID: "claude-sonnet" } },
      buildAgent,
    )).toEqual({
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "high",
    });
  });

  test("keeps an explicit different model and skips the agent variant", () => {
    expect(withRunPromptAgentDefaults(
      { agent: "build", model: { providerID: "openai", modelID: "gpt-5" } },
      buildAgent,
    )).toEqual({
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    });
  });

  test("keeps explicit model and variant overrides", () => {
    expect(withRunPromptAgentDefaults(
      { agent: "build", model: { providerID: "openai", modelID: "gpt-5" }, variant: "low" },
      buildAgent,
    )).toEqual({
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "low",
    });
  });

  test("does not apply an agent variant without an agent model", () => {
    expect(withRunPromptAgentDefaults({ agent: "solo" }, { name: "solo", variant: "high" })).toEqual({
      agent: "solo",
    });
    expect(withRunPromptAgentDefaults(
      { agent: "solo", model: { providerID: "openai", modelID: "gpt-5" } },
      { name: "solo", variant: "high" },
    )).toEqual({
      agent: "solo",
      model: { providerID: "openai", modelID: "gpt-5" },
    });
  });

  test("keeps the agent variant when the query omits the model and variant", () => {
    expect(withRunPromptAgentDefaults({ agent: "build" }, {
      name: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "xhigh",
    })).toEqual({
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "xhigh",
    });
  });

  test("returns overrides unchanged when the agent is missing", () => {
    expect(withRunPromptAgentDefaults({ agent: "ghost", variant: "high" }, undefined)).toEqual({
      agent: "ghost",
      variant: "high",
    });
  });

  test("normalizes a v2-style agent model ref", () => {
    expect(withRunPromptAgentDefaults({ agent: "build" }, {
      id: "build",
      model: { providerID: "anthropic", id: "claude-sonnet", variant: "high" },
    })).toEqual({
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "high",
    });
  });
});

describe("resolveRunPromptAgentOverrides", () => {
  test("fills omitted model and variant from the agent list", async () => {
    const resolved = await resolveRunPromptAgentOverrides({ agent: "build" }, async () => [buildAgent]);
    expect(resolved).toEqual({
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet" },
      variant: "high",
    });
  });

  test("does not load agents without a name or when nothing is omitted", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return [buildAgent];
    };
    await resolveRunPromptAgentOverrides({ model: { providerID: "openai", modelID: "gpt-5" }, variant: "low" }, load);
    await resolveRunPromptAgentOverrides({ variant: "low" }, load);
    expect(loads).toBe(0);
  });

  test("returns parsed overrides when the agent list fails", async () => {
    const resolved = await resolveRunPromptAgentOverrides({ agent: "build" }, async () => {
      throw new Error("offline");
    });
    expect(resolved).toEqual({ agent: "build" });
  });

  test("returns parsed overrides when the agent is unknown", async () => {
    const resolved = await resolveRunPromptAgentOverrides({ agent: "ghost" }, async () => [buildAgent]);
    expect(resolved).toEqual({ agent: "ghost" });
  });
});
