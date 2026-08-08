// Child-process spawn helpers for desktop build/dev scripts.
//
// Passing an args array together with `shell: true` triggers node's DEP0190
// deprecation (unquoted args are concatenated into the shell command line).
// On Windows, `.cmd`/`.bat` shims still need a shell, so when one is required
// we quote the tokens into a single command line first and then spawn that
// string with `shell: true` — no args array, no warning.
import { spawn, spawnSync } from "node:child_process";

export function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

// Quote a token for cmd.exe/sh: wrap tokens that contain spaces or shell
// metacharacters, doubling inner double quotes (cmd convention).
function quoteToken(token) {
  return /[\s"&|<>^]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}

export function spawnWith(command, args, options = {}) {
  if (needsShell(command)) {
    const commandLine = [command, ...args].map(quoteToken).join(" ");
    return spawn(commandLine, { ...options, shell: true });
  }
  return spawn(command, args, { ...options });
}

export function spawnSyncWith(command, args, options = {}) {
  if (needsShell(command)) {
    const commandLine = [command, ...args].map(quoteToken).join(" ");
    return spawnSync(commandLine, { ...options, shell: true });
  }
  return spawnSync(command, args, { ...options });
}
