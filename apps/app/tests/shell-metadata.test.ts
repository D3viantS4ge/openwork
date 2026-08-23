import { describe, expect, test } from "bun:test";

import { parseShellMetadata } from "../src/app/lib/shell-metadata";

describe("parseShellMetadata", () => {
  test("strips an abort note and returns it as a styled note", () => {
    const output = "partial output\n\n<shell_metadata>\nUser aborted the command\n</shell_metadata>";
    const parsed = parseShellMetadata(output);
    expect(parsed.notes).toEqual(["User aborted the command"]);
    expect(parsed.body).toBe("partial output");
  });

  test("handles multiple notes (abort + timeout) in one block", () => {
    const output =
      "out\n\n<shell_metadata>\nUser aborted the command\nshell tool terminated command after exceeding timeout 100 ms.\n</shell_metadata>";
    const parsed = parseShellMetadata(output);
    expect(parsed.notes).toEqual([
      "User aborted the command",
      "shell tool terminated command after exceeding timeout 100 ms.",
    ]);
    expect(parsed.body).toBe("out");
  });

  test("leaves plain output untouched", () => {
    const parsed = parseShellMetadata("hello\nworld\n");
    expect(parsed.notes).toEqual([]);
    expect(parsed.body).toBe("hello\nworld");
  });

  test("handles empty output", () => {
    const parsed = parseShellMetadata("");
    expect(parsed.notes).toEqual([]);
    expect(parsed.body).toBe("");
  });
});
