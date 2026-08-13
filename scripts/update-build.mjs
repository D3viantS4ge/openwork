#!/usr/bin/env node
// Pull latest dev onto the current branch and rebuild the desktop app.
//
//   node scripts/update-build.mjs        (or: pnpm update:build)
//
// Fetch upstream, then rebase the current branch onto upstream/dev. If the
// upstream remote is missing (or its fetch fails), fall back to origin/dev.
// If the rebase fails, abort it and fall back to a merge. If both fail, abort
// everything and leave the tree clean. On success run the full desktop
// build pipeline: pnpm install -> rebuild native modules for Electron ->
// package the unpacked win-unpacked app.
import { spawnSync } from "node:child_process";

const REMOTE = "upstream";
const FALLBACK_REMOTE = "origin";
const BRANCH_TARGET = `${REMOTE}/dev`;
const FALLBACK_TARGET = `${FALLBACK_REMOTE}/dev`;
const BUILD_STEPS = [
  ["pnpm", ["install"]],
  ["pnpm", ["--filter", "@openwork/desktop", "rebuild:electron-native"]],
  ["pnpm", ["--filter", "@openwork/desktop", "package:electron:dir"]],
];

function quoteToken(token) {
  return /[\s"&|<>^]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}

// Spawn a command, inheriting stdio. On Windows, anything that is not a real
// executable (e.g. pnpm -> pnpm.cmd, or any extension-less PATH shim) must go
// through a shell; passing args with shell:true triggers node's DEP0190
// deprecation, so quote them into a single command line instead.
function run(command, args = []) {
  if (process.platform === "win32" && !/\.(exe|com)$/i.test(command)) {
    const line = [command, ...args].map(quoteToken).join(" ");
    return spawnSync(line, { stdio: "inherit", shell: true });
  }
  return spawnSync(command, args, { stdio: "inherit" });
}

function fail(message) {
  console.error(`update-build: ${message}`);
  process.exit(1);
}

const git = (args) => run("git", args);

// 1. Resolve the base remote: upstream when present (with its dev branch),
//    otherwise fall back to origin so the script still works for
//    contributors who only have a fork remote.
let remote = REMOTE;
let branchTarget = BRANCH_TARGET;
if (git(["remote", "get-url", REMOTE]).status !== 0) {
  console.warn(`[update-build] Remote '${REMOTE}' not found — falling back to ${FALLBACK_TARGET}`);
  remote = FALLBACK_REMOTE;
  branchTarget = FALLBACK_TARGET;
}

// 2. Fetch latest remote state.
console.log(`[update-build] Fetching ${remote}...`);
if (git(["fetch", remote]).status !== 0) {
  if (remote === REMOTE) {
    console.warn(`[update-build] git fetch ${remote} failed — falling back to ${FALLBACK_TARGET}`);
    remote = FALLBACK_REMOTE;
    branchTarget = FALLBACK_TARGET;
    if (git(["fetch", remote]).status !== 0) {
      fail(`git fetch ${remote} failed`);
    }
  } else {
    fail(`git fetch ${remote} failed`);
  }
}

// 3. The tree must be clean before rebasing/merging.
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (status.status !== 0 || status.stdout.trim()) {
  fail("working tree is not clean — commit or stash your changes first");
}

// 4. Try rebase; 5. fall back to merge; 6. abort everything if both fail.
const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
console.log(`[update-build] Rebasing ${branch || "current branch"} onto ${branchTarget}...`);
if (git(["rebase", branchTarget]).status !== 0) {
  console.warn("[update-build] Rebase failed, aborting and falling back to merge...");
  git(["rebase", "--abort"]);
  console.log(`[update-build] Merging ${branchTarget}...`);
  if (git(["merge", "--no-edit", branchTarget]).status !== 0) {
    git(["merge", "--abort"]);
    fail(`${branchTarget} could not be rebased or merged — resolve the conflicts manually`);
  }
  console.log("[update-build] Merge succeeded.");
} else {
  console.log("[update-build] Rebase succeeded.");
}

// 7. Build pipeline.
for (const [command, args] of BUILD_STEPS) {
  console.log(`[update-build] ${command} ${args.join(" ")}`);
  const result = run(command, args);
  if (result.error) {
    console.error(`update-build: spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed`);
  }
}

// 7. Report.
const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
console.log(
  `[update-build] Done. HEAD=${head} artifact=apps/desktop/dist-electron/win-unpacked/OpenWork.exe`,
);
