import { describe, expect, test } from "bun:test";

import { parseRunPromptRequest } from "../src/react-app/shell/run-prompt-params";

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
