declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
};

import { resolveRequestTimeoutMs } from "./opencode";

const FALLBACK = 10_000;

describe("resolveRequestTimeoutMs", () => {
  test("shell (!) runs never time out at the transport layer", () => {
    expect(resolveRequestTimeoutMs("/session/ses_abc/shell", FALLBACK)).toEqual(0);
    expect(resolveRequestTimeoutMs("http://localhost:1234/opencode/session/ses_abc/shell", FALLBACK)).toEqual(0);
    expect(resolveRequestTimeoutMs("http://localhost:1234/workspace/w_1/opencode2/session/ses_abc/shell", FALLBACK)).toEqual(0);
  });

  test("other long-running session mutations never time out", () => {
    expect(resolveRequestTimeoutMs("/session/ses_abc/command", FALLBACK)).toEqual(0);
    expect(resolveRequestTimeoutMs("/session/ses_abc/summarize", FALLBACK)).toEqual(0);
  });

  test("prompt_async keeps its admission bound", () => {
    expect(resolveRequestTimeoutMs("/session/ses_abc/prompt_async", FALLBACK)).toEqual(30_000);
  });

  test("ordinary requests keep the caller's fallback timeout", () => {
    expect(resolveRequestTimeoutMs("/session/ses_abc/message", FALLBACK)).toEqual(FALLBACK);
    expect(resolveRequestTimeoutMs("/vcs/status", FALLBACK)).toEqual(FALLBACK);
  });
});
