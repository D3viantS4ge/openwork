#!/usr/bin/env node
// Pull the latest stable release onto the current branch and rebuild the
// desktop app.
//
//   node scripts/update-build.mjs        (or: pnpm update:build)
//
// Fetch the base remote (upstream, else origin). When the current branch is
// `dev`, fast-forward it to that remote's dev HEAD and build — dev only
// advances from this path. When the current branch is anything else
// (dev-local), resolve the latest published GitHub release tag from the
// GitHub REST API (no gh dependency; unreleased tags are deliberately
// ignored — stability over freshness), and rebase the current branch onto
// that release's merge base with the base remote's dev branch: the commit
// the release was cut from, i.e. the released commit that also exists on dev.
// Unreleased commits are never ingested: no published release means the
// script fails loudly instead of falling back to dev HEAD. If the rebase
// fails, abort it and fall back to a merge. If both fail, abort everything
// and leave the tree clean. On success run the full desktop build pipeline:
// pnpm install -> rebuild native modules for Electron -> package the
// unpacked win-unpacked app.
import { spawnSync } from "node:child_process";

const REMOTE = "upstream";
const FALLBACK_REMOTE = "origin";
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
  // Tags included: the rebase target is the release tag, which may point at
  // a commit not reachable from any branch.
  return git(["fetch", "--tags", target]).status === 0;
};

// The GitHub owner/repo for the given remote, used to build the release
// lookup URL.
function remoteRepoSlug(target) {
  const result = capture("git", ["remote", "get-url", target]);
  if (result.status !== 0) return null;
  const url = result.stdout.trim();
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

// The latest published release tag (vX.Y.Z) via the GitHub REST API. gh is
// not required: /releases/latest is public for public repos, so a plain
// HTTPS GET works unauthenticated (subject to GitHub's per-IP rate limit).
// Unreleased tags are deliberately ignored in favor of stability.
// /releases/latest returns the newest non-draft, non-prerelease release by
// contract. Returns null when the lookup fails, the repo has no releases,
// or the tag does not match the strict vX.Y.Z pattern.
async function latestPublishedReleaseTag() {
  const repo = remoteRepoSlug(remote);
  if (!repo) {
    console.warn("[update-build] Could not determine GitHub repo for release lookup");
    return null;
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub rejects requests without a User-Agent header.
        "User-Agent": "openwork-update-build",
      },
    });
    if (!response.ok) {
      console.warn(`[update-build] GitHub release lookup failed (HTTP ${response.status})`);
      return null;
    }
    const payload = await response.json();
    const tag = typeof payload?.tag_name === "string" ? payload.tag_name.trim() : "";
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
      console.warn(`[update-build] GitHub returned unexpected release tag '${tag}'`);
      return null;
    }
    return tag;
  } catch (error) {
    console.warn(`[update-build] GitHub release lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

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

// 4. On dev: fast-forward to the base remote's dev HEAD (this also
//    refreshes the working tree so the build compiles the new code).
//    dev only ever advances from this path — never from other branches —
//    and it fails hard when dev holds local commits.
if (branch === "dev") {
  console.log(`[update-build] Advancing dev to ${devRef} (fast-forward)...`);
  if (git(["merge", "--ff-only", devRef]).status !== 0) {
    fail(`dev could not fast-forward to ${devRef} — it likely holds local commits; resolve manually`);
  }
  console.log("[update-build] On dev — skipping rebase.");
} else {
  console.log(`[update-build] On ${branch || "current branch"} — leaving dev untouched.`);
}

// 5. Rebase target for non-dev branches: the merge base of the base
//    remote's dev branch and the latest published release tag — the
//    commit the release was cut from, i.e. the released commit that also
//    exists on dev. Unreleased commits are never ingested: no published
//    release means no update (fail loudly), never a fallback to dev HEAD.
if (branch !== "dev") {
  const releaseTag = await latestPublishedReleaseTag();
  if (!releaseTag) {
    fail(
      "no published release found — update:build only lands on published releases; " +
        "re-run when one publishes",
    );
  }
  const tagRef = `refs/tags/${releaseTag}`;
  const baseResult = capture("git", ["merge-base", devRef, tagRef]);
  if (baseResult.status !== 0 || !baseResult.stdout.trim()) {
    fail(`could not find the merge base of ${devRef} and ${tagRef}`);
  }
  const branchTarget = baseResult.stdout.trim();

  // 6. Try rebase; 7. fall back to merge; 8. abort everything if both fail.
  const shortBase = branchTarget.slice(0, 9);
  console.log(
    `[update-build] Rebasing ${branch || "current branch"} onto ${shortBase} ` +
      `(merge base of ${devRef} and ${releaseTag})...`,
  );
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

// 9. Build pipeline.
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
