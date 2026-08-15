#!/usr/bin/env node
// Pull the latest release onto the current branch and rebuild the desktop app.
//
//   node scripts/update-build.mjs        (or: pnpm update:build)
//
// Fetch the base remote (upstream, else origin), then advance the `dev`
// branch to that remote's dev HEAD — fast-forward only, failing hard if
// `dev` holds local commits (it is a mirror and must never gain any).
// Then, when the current branch is not `dev`, rebase it onto the latest
// upstream release tag (vX.Y.Z — a tested snapshot; dev HEAD can be
// mid-flight, so updates land when a release drops instead of tracking
// every dev commit). If no release tag exists, fall back to origin/dev.
// If the rebase fails, abort it and fall back to a merge. If both fail,
// abort everything and leave the tree clean. On success run the full
// desktop build pipeline: pnpm install -> rebuild native modules for
// Electron -> package the unpacked win-unpacked app.
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

// 3. The tree must be clean before advancing dev / rebasing.
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if (status.status !== 0 || status.stdout.trim()) {
  fail("working tree is not clean — commit or stash your changes first");
}

const branch = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim();
const devRef = `${remote}/dev`;

// 4. Advance `dev` to the base remote's dev HEAD — one rule regardless of
//    the starting branch: fast-forward only, fail hard if `dev` holds local
//    commits (it is a mirror and must never gain any).
console.log(`[update-build] Advancing dev to ${devRef} (fast-forward)...`);
if (branch === "dev") {
  // dev is checked out: merge --ff-only advances it AND refreshes the
  // working tree so the build below compiles the new code. It inherently
  // fails when dev has diverged (local commits).
  if (git(["merge", "--ff-only", devRef]).status !== 0) {
    fail(`dev could not fast-forward to ${devRef} — it likely holds local commits; resolve manually`);
  }
} else {
  const devExists = spawnSync("git", ["rev-parse", "--verify", "--quiet", "dev"], { encoding: "utf8" }).status === 0;
  if (devExists) {
    // Fails (exit 1) when dev is not an ancestor of the target, i.e. it
    // holds commits the remote does not have.
    if (git(["merge-base", "--is-ancestor", "dev", devRef]).status !== 0) {
      fail(`dev could not fast-forward to ${devRef} — it likely holds local commits; resolve manually`);
    }
  }
  if (git(["branch", "-f", "dev", devRef]).status !== 0) {
    fail(`could not advance dev to ${devRef}`);
  }
}

// 5. On dev there is nothing to rebase — the advance already moved it; go
//    straight to the build pipeline.
if (branch === "dev") {
  console.log("[update-build] On dev — skipping rebase.");
}

// 6. Rebase target for non-dev branches: the latest release tag (vX.Y.Z)
//    when one exists, otherwise origin/dev. Snapshot tags like
//    v<githash>-dev are excluded.
let branchTarget = FALLBACK_TARGET;
if (branch !== "dev") {
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
        // Only the base remote was fetched so far; make sure origin/dev is
        // current.
        if (!fetchRemote(FALLBACK_REMOTE)) {
          fail(`git fetch ${FALLBACK_REMOTE} failed`);
        }
      }
    }
  }

  // 7. Try rebase; 8. fall back to merge; 9. abort everything if both fail.
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
}

// 10. Build pipeline.
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

// 11. Report.
const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
console.log(
  `[update-build] Done. HEAD=${head} artifact=apps/desktop/dist-electron/win-unpacked/OpenWork.exe`,
);
