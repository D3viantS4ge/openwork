// Unit tests for the cross-platform env-setter used by pnpm scripts.
// Run with: node --test cross-env.test.mjs (or pnpm test)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helper = resolve(__dirname, "cross-env.mjs");

function runHelper(assignments, commandArgs, options = {}) {
  return spawnSync(
    process.execPath,
    [helper, ...assignments, "--", ...commandArgs],
    { encoding: "utf8", ...options },
  );
}

test("applies a plain NAME=value assignment", () => {
  const { status, stdout } = runHelper(
    ["FOO=1"],
    ["node", "-e", "console.log(process.env.FOO)"],
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "1");
});

test("applies ${NAME:-default} when unset", () => {
  const { status, stdout } = runHelper(
    ["BAR=${BAR:-42}"],
    ["node", "-e", "console.log(process.env.BAR)"],
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "42");
});

test("keeps an inherited value over ${NAME:-default}", () => {
  const { status, stdout } = runHelper(
    ["BAR=${BAR:-42}"],
    ["node", "-e", "console.log(process.env.BAR)"],
    { env: { ...process.env, BAR: "99" } },
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "99");
});

test("plain NAME=value overrides an inherited value", () => {
  const { status, stdout } = runHelper(
    ["BAR=7"],
    ["node", "-e", "console.log(process.env.BAR)"],
    { env: { ...process.env, BAR: "99" } },
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "7");
});

test("NAME= forces an empty value", () => {
  const { status, stdout } = runHelper(
    ["EMPTY="],
    ["node", "-e", "console.log(JSON.stringify(process.env.EMPTY))"],
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), '""');
});

test("values may reference earlier assignments via $NAME", () => {
  const { status, stdout } = runHelper(
    ["HOST=localhost", "URL=http://$HOST:5173"],
    ["node", "-e", "console.log(process.env.URL)"],
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "http://localhost:5173");
});

test("defaults may reference earlier assignments (nested ${NAME:-default})", () => {
  const { status, stdout } = runHelper(
    ["DEN_WEB_PORT=3005", "URL=${URL:-http://localhost:${DEN_WEB_PORT:-3005}}"],
    ["node", "-e", "console.log(process.env.URL)"],
  );
  assert.equal(status, 0);
  assert.equal(stdout.trim(), "http://localhost:3005");
});

test("&& chains run sequentially with env on the first segment only", () => {
  const { status, stdout } = runHelper(
    ["A=1"],
    [
      "node",
      "-e",
      "console.log('first A=' + process.env.A)",
      "&&",
      "node",
      "-e",
      "console.log('second A=' + (process.env.A ?? 'unset'))",
    ],
  );
  assert.equal(status, 0);
  const lines = stdout.trim().split(/\r?\n/);
  assert.deepEqual(lines, ["first A=1", "second A=unset"]);
});

test("&& chains stop at the first failing segment", () => {
  const { status, stdout } = runHelper(
    ["X=1"],
    [
      "node",
      "-e",
      "process.exit(2)",
      "&&",
      "node",
      "-e",
      "console.log('should-not-run')",
    ],
  );
  assert.equal(status, 2);
  assert.equal(stdout.trim(), "");
});

test("propagates the child exit code", () => {
  const { status } = runHelper(["X=1"], ["node", "-e", "process.exit(3)"]);
  assert.equal(status, 3);
});

test("exits 2 when no command follows --", () => {
  const { status, stderr } = runHelper([], []);
  assert.equal(status, 2);
  assert.match(stderr, /no command after `--`/);
});

test("exits 2 on an invalid env name", () => {
  const { status, stderr } = runHelper(["1BAD=x"], ["node", "-e", "1"]);
  assert.equal(status, 2);
  assert.match(stderr, /invalid env name: 1BAD/);
});

test("exits 2 on a non-assignment token", () => {
  const { status, stderr } = runHelper(["nonsense"], ["node", "-e", "1"]);
  assert.equal(status, 2);
  assert.match(stderr, /expected NAME=value/);
});
