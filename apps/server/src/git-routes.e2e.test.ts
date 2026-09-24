import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const execFileAsync = promisify(execFile);

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const CLIENT_TOKEN = "owt_git_routes_client";
const HOST_TOKEN = "owt_git_routes_host";
const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const priorDataDir = process.env.OPENWORK_DATA_DIR;
const priorTokenStore = process.env.OPENWORK_TOKEN_STORE;

function clientAuth(token = CLIENT_TOKEN) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createTempRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function git(root: string, args: string[]) {
  await execFileAsync("git", args, { cwd: root });
}

async function gitOutput(root: string, args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: root })).stdout.trim();
}

async function initGitRepo(root: string) {
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
}

async function startGitServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    configPath: join(workspaceRoot, "server.json"),
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_git", name: "Git Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, config };
}

beforeEach(async () => {
  const envRoot = await createTempRoot("openwork-git-routes-env-");
  process.env.OPENWORK_DATA_DIR = join(envRoot, "data");
  process.env.OPENWORK_TOKEN_STORE = join(envRoot, "tokens.json");
});

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
  if (priorDataDir === undefined) {
    delete process.env.OPENWORK_DATA_DIR;
  } else {
    process.env.OPENWORK_DATA_DIR = priorDataDir;
  }
  if (priorTokenStore === undefined) {
    delete process.env.OPENWORK_TOKEN_STORE;
  } else {
    process.env.OPENWORK_TOKEN_STORE = priorTokenStore;
  }
});

describe("git history routes", () => {
  test("lists commits newest-first with metadata", async () => {
    const root = resolve(await createTempRoot("openwork-git-repo-"));
    await initGitRepo(root);
    await writeFile(join(root, "a.txt"), "one\n");
    await git(root, ["add", "a.txt"]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "first commit"]);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await git(root, ["add", "a.txt"]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "second commit"]);

    const { base } = await startGitServer(root);
    const response = await fetch(`${base}/workspace/ws_git/git/commits`, { headers: clientAuth() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.branch).toBe("main");
    const commits = body.commits as Array<Record<string, unknown>>;
    expect(commits.length).toBe(2);
    expect(commits[0]?.subject).toBe("second commit");
    expect(commits[1]?.subject).toBe("first commit");
    expect(commits[0]?.id).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof commits[0]?.short).toBe("string");
    expect(typeof commits[0]?.author).toBe("string");
    expect((commits[0]?.parents as unknown[]).length).toBe(1);

    // The limit query caps the returned history.
    const limitedResponse = await fetch(`${base}/workspace/ws_git/git/commits?limit=1`, { headers: clientAuth() });
    const limited = (await limitedResponse.json()) as Record<string, unknown>;
    expect((limited.commits as unknown[]).length).toBe(1);
  });

  test("returns empty commits for a fresh repo with no commits", async () => {
    const root = resolve(await createTempRoot("openwork-git-empty-"));
    await initGitRepo(root);
    const { base } = await startGitServer(root);
    const response = await fetch(`${base}/workspace/ws_git/git/commits`, { headers: clientAuth() });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.branch).toBe("main");
    expect(body.commits).toEqual([]);
  });

  test("returns not_a_repo for a non-git workspace", async () => {
    const root = resolve(await createTempRoot("openwork-git-nonrepo-"));
    const { base } = await startGitServer(root);
    const response = await fetch(`${base}/workspace/ws_git/git/commits`, { headers: clientAuth() });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("not_a_repo");
  });

  test("shows a commit's per-file diff, including root commits", async () => {
    const root = resolve(await createTempRoot("openwork-git-show-"));
    await initGitRepo(root);
    await writeFile(join(root, "a.txt"), "old line\n");
    await git(root, ["add", "a.txt"]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "root commit"]);
    const rootSha = await gitOutput(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "a.txt"), "old line\nnew line\n");
    await writeFile(join(root, "b.txt"), "brand new\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "second commit"]);
    const secondSha = await gitOutput(root, ["rev-parse", "HEAD"]);

    const { base } = await startGitServer(root);

    const secondResponse = await fetch(`${base}/workspace/ws_git/git/commit/${secondSha}`, { headers: clientAuth() });
    expect(secondResponse.status).toBe(200);
    const second = (await secondResponse.json()) as Record<string, unknown>;
    expect(second.ok).toBe(true);
    expect((second.commit as Record<string, unknown>).subject).toBe("second commit");
    const secondFiles = second.files as Array<Record<string, unknown>>;
    const a = secondFiles.find((file) => file.file === "a.txt");
    const b = secondFiles.find((file) => file.file === "b.txt");
    expect(a).toBeTruthy();
    expect(a?.status).toBe("modified");
    expect(a?.additions).toBe(1);
    expect(String(a?.patch)).toContain("diff --git");
    expect(b).toBeTruthy();
    expect(b?.status).toBe("added");
    expect(b?.additions).toBe(1);
    expect(String(b?.patch)).toContain("diff --git");

    const rootResponse = await fetch(`${base}/workspace/ws_git/git/commit/${rootSha}`, { headers: clientAuth() });
    const rootShow = (await rootResponse.json()) as Record<string, unknown>;
    expect(rootShow.ok).toBe(true);
    const rootFiles = rootShow.files as Array<Record<string, unknown>>;
    const rootA = rootFiles.find((file) => file.file === "a.txt");
    expect(rootA?.status).toBe("added");
    expect(String(rootA?.patch)).toContain("diff --git");

    const badResponse = await fetch(`${base}/workspace/ws_git/git/commit/deadbeef`, { headers: clientAuth() });
    const bad = (await badResponse.json()) as Record<string, unknown>;
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("invalid_ref");
  });

  test("rejects a non-hex ref", async () => {
    const root = resolve(await createTempRoot("openwork-git-badref-"));
    await initGitRepo(root);
    await writeFile(join(root, "a.txt"), "one\n");
    await git(root, ["add", "a.txt"]);
    await git(root, ["commit", "--no-gpg-sign", "-m", "first"]);
    const { base } = await startGitServer(root);
    const response = await fetch(`${base}/workspace/ws_git/git/commit/${encodeURIComponent("HEAD~1; rm -rf .")}`, { headers: clientAuth() });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_ref");
  });
});
