#!/usr/bin/env node
// Pull the latest release onto the current branch and rebuild the desktop app.
//
//   node scripts/update-build.mjs        (or: pnpm update:build)
//
// Fetch upstream, then rebase the current branch onto the latest upstream
// release tag (vX.Y.Z — a tested snapshot; dev HEAD can be mid-flight, so
// updates land when a release drops instead of tracking every dev commit).
// If no release tag exists, fall back to origin/dev. If the upstream remote
// is missing (or its fetch fails), fall back to origin/dev. If the rebase
// fails, abort it and fall back to a merge. If both fail, abort everything
// and leave the tree clean. On success run the full desktop build pipeline:
// pnpm install -> rebuild native modules for Electron -> package the
// unpacked win-unpacked app.
import { spawnSync } from "node:child_process";

const REMOTE = "upstream";
const FALLBACK_REMOTE = "origin";
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

// Capture command output (unlike run(), which inherits stdio).
function capture(command, args = []) {
  if (process.platform === "win32" && !/\.(exe|com)$/i.test(command)) {
    const line = [command, ...args].map(quoteToken).join(" ");
    return spawnSync(line, { encoding: "utf8", shell: true });
  }
  return spawnSync(command, args, { encoding: "utf8" });
}

const git = (args) => run("git", args);

const fetchRemote = (target) => {
  console.log(`[update-build] Fetching ${target}...`);
  // Tags included: the rebase target is the latest release tag, which may
  // point at a commit not reachable from any branch.
  return git(["fetch", "--tags", target]).status === 0;
};

// 1. Resolve the base remote: upstream when present, otherwise fall back to
//    origin so the script still works for contributors who only have a fork
//    remote.
let remote = REMOTE;
if (git(["remote", "get-url", REMOTE]).status !== 0) {
  console.warn(`[update-build] Remote '${REMOTE}' not found — falling back to ${FALLBACK_REMOTE}`);
  remote = FALLBACK_REMOTE;
}

// 2. Fetch latest remote state; on failure fall back to origin.
if (!fetchRemote(remote)) {
  if (remote === REMOTE) {
    console.warn(`[update-build] git fetch ${remote} failed — falling back to ${FALLBACK_REMOTE}`);
    remote = FALLBACK_REMOTE;
    if (!fetchRemote(remote)) {
      fail(`git fetch ${remote} failed`);
    }
  } else {
    fail(`git fetch ${remote} failed`);
  }
}

// 3. Rebase target: the latest release tag (vX.Y.Z) when one exists,
//    otherwise origin/dev. Snapshot tags like v<githash>-dev are excluded.
let branchTarget = FALLBACK_TARGET;
const tagResult = capture("git", ["tag", "-l", "--sort=-v:refname"]);
if (tagResult.status === 0) {
  const releaseTag = tagResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (releaseTag) {
    branchTarget = `refs/tags/${releaseTag}`;
  } else {
    console.warn(`[update-build] No release tag (vX.Y.Z) found — falling back to ${FALLBACK_TARGET}`);
    if (remote !== FALLBACK_REMOTE) {
      // Only upstream was fetched so far; make sure origin/dev is current.
      if (!fetchRemote(FALLBACK_REMOTE)) {
        fail(`git fetch ${FALLBACK_REMOTE} failed`);
      }
    }
  }
}

// 4. The tree must be clean before rebasing/merging.
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (status.status !== 0 || status.stdout.trim()) {
  fail("working tree is not clean — commit or stash your changes first");
}

// 5. Try rebase; 6. fall back to merge; 7. abort everything if both fail.
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

// 8. Build pipeline.
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
