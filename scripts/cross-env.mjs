#!/usr/bin/env node
// Cross-platform env-setter for pnpm scripts.
//
// Bash-style env prefixes (`FOO=1 cmd`) don't run under cmd.exe, which pnpm
// uses to execute scripts on Windows. This helper replicates the bash
// semantics those scripts rely on:
//
//   node scripts/with-env.mjs FOO=1 BAR=${BAR:-2} 'BAZ=http://$FOO' -- <command...>
//
// - Tokens before `--` are env assignments, applied in order. The command
//   after `--` runs with those vars added to the inherited environment.
// - `NAME=${NAME:-default}` applies only when unset/empty; plain `NAME=value`
//   always applies (like bash), and `NAME=` forces an empty value.
// - Values and command args may reference earlier vars: `$NAME`, `${NAME}`,
//   `${NAME:-default}` (nested defaults included).
// - Surrounding single/double quotes on a token are stripped, so bash on unix
//   does not expand inner `$REF`s before we do (cmd.exe passes them through).
// - `&&` chains are shell-native on both platforms, so only the command that
//   carried the env prefix needs wrapping, e.g.
//   `pnpm run a && node scripts/with-env.mjs FOO=1 -- cmd b`.
import { spawnSync } from "node:child_process";

const stripQuotes = (value) => {
  const first = value[0];
  if (value.length >= 2 && (first === "'" || first === '"') && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
};

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const assignTokens = sep === -1 ? argv : argv.slice(0, sep);
const commandTokens = (sep === -1 ? [] : argv.slice(sep + 1)).map((token) => stripQuotes(token));

const env = { ...process.env };

// Expand $NAME / ${NAME} / ${NAME:-default} against the accumulated env.
// Iterates over nested defaults so refs may reference other vars.
const expandRefs = (value, depth = 0) => {
  if (depth > 8) return "";
  let out = "";
  let rest = String(value);
  while (rest.length > 0) {
    const dollar = rest.indexOf("$");
    if (dollar === -1) return out + rest;
    out += rest.slice(0, dollar);
    rest = rest.slice(dollar + 1);
    if (rest.startsWith("{")) {
      let braces = 0;
      let end = -1;
      for (let i = 1; i < rest.length; i++) {
        if (rest[i] === "{") braces++;
        else if (rest[i] === "}") {
          if (braces === 0) {
            end = i;
            break;
          }
          braces--;
        }
      }
      if (end === -1) return out + "${" + rest;
      const inner = rest.slice(1, end);
      rest = rest.slice(end + 1);
      const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)(.*)$/s.exec(inner);
      if (!nameMatch) {
        out += "${" + inner + "}";
        continue;
      }
      const name = nameMatch[1];
      const tail = nameMatch[2];
      const current = env[name];
      if (tail === "") {
        out += current ?? "";
      } else if (tail.startsWith(":-")) {
        out += current ? current : expandRefs(tail.slice(2), depth + 1);
      } else if (tail.startsWith("-")) {
        out += current === undefined ? expandRefs(tail.slice(1), depth + 1) : current;
      } else {
        out += current ?? "";
      }
    } else {
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      if (!nameMatch) {
        out += "$";
        continue;
      }
      rest = rest.slice(nameMatch[0].length);
      out += env[nameMatch[0]] ?? "";
    }
  }
  return out;
};

for (const token of assignTokens) {
  // Tolerate bash-style `;` separators, which cmd.exe passes through as-is.
  for (const part of token.split(";")) {
    const assignment = part.trim();
    if (!assignment) continue;
    const eq = assignment.indexOf("=");
    if (eq <= 0) {
      console.error(`with-env: expected NAME=value, got: ${assignment}`);
      process.exit(2);
    }
    const name = assignment.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      console.error(`with-env: invalid env name: ${name}`);
      process.exit(2);
    }
    const raw = stripQuotes(assignment.slice(eq + 1));
    const conditional = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:-?)(.*)\}$/s.exec(raw);
    if (conditional && conditional[1] === name) {
      const [, , mode, defRaw] = conditional;
      const missing = env[name] === undefined || env[name] === "";
      if (mode === ":-" ? missing : env[name] === undefined) {
        env[name] = expandRefs(defRaw);
      }
    } else {
      env[name] = expandRefs(raw);
    }
  }
}

if (commandTokens.length === 0) {
  console.error("with-env: no command after `--`");
  process.exit(2);
}

// On unix, avoid a shell round-trip unless the command needs one, so glob
// patterns stay literal (matching the original single-quoted bash behavior)
// and tokens with spaces survive as single argv entries. On Windows, go
// through cmd.exe so .cmd shims resolve; cmd does not glob.
const needsShell = /[&|<>;`]/.test(commandTokens.join(" "));
let result;
if (needsShell || process.platform === "win32") {
  const commandLine = commandTokens
    .map((token) => (/[\s"&|<>^]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token))
    .join(" ");
  result = spawnSync(commandLine, { env, shell: true, stdio: "inherit" });
} else {
  const [command, ...args] = commandTokens;
  result = spawnSync(command, args, { env, stdio: "inherit" });
}
if (result.error) {
  console.error(`with-env: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 0);
