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
      archive: undefined,
    });
  });

  test("ignores empty override params", () => {
    expect(parseRunPromptRequest("?message=hi&model=&agent=&variant=")).toEqual({
      message: "hi",
      overrides: {},
      archive: undefined,
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

  describe("archive param", () => {
    test("returns archive=true for 'true'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=true")?.archive).toBe(true);
    });

    test("returns archive=true for '1'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=1")?.archive).toBe(true);
    });

    test("returns archive=true for 'yes'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=yes")?.archive).toBe(true);
    });

    test("returns archive=false for 'false'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=false")?.archive).toBe(false);
    });

    test("returns archive=false for '0'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=0")?.archive).toBe(false);
    });

    test("returns archive=false for 'no'", () => {
      expect(parseRunPromptRequest("?message=hi&archive=no")?.archive).toBe(false);
    });

    test("returns undefined when archive is absent", () => {
      expect(parseRunPromptRequest("?message=hi")?.archive).toBeUndefined();
    });

    test("returns undefined for unrecognised values", () => {
      expect(parseRunPromptRequest("?message=hi&archive=maybe")?.archive).toBeUndefined();
      expect(parseRunPromptRequest("?message=hi&archive=2")?.archive).toBeUndefined();
    });
  });
});
