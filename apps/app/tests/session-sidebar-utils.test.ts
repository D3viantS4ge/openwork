import { describe, expect, test } from "bun:test";

import type { SidebarSessionItem } from "../src/app/types";
import {
  buildSessionTreeState,
  collectSessionDescendants,
  directChildPresenceBySessionId,
  flattenSessionRows,
  orderArchivedSessions,
  partitionArchivedSessions,
  sessionsNewlyWithChildren,
} from "../src/react-app/domains/session/sidebar/utils";

const sessions: SidebarSessionItem[] = [
  { id: "session-a", title: "Pinned root" },
  { id: "session-a-child", title: "Pinned child", parentID: "session-a" },
  { id: "session-b", title: "Regular root" },
];

describe("global session pinning", () => {
  test("selects a pinned root and its expanded descendants", () => {
    const tree = buildSessionTreeState(sessions, undefined);
    const rows = flattenSessionRows(
      sessions,
      1,
      tree,
      new Set(["session-a"]),
      new Set(),
      new Set(["session-a"]),
      [],
      { include: new Set(["session-a"]) },
    );

    expect(rows.map((row) => row.session.id)).toEqual(["session-a", "session-a-child"]);
  });

  test("removes pinned roots before applying the workspace preview limit", () => {
    const tree = buildSessionTreeState(sessions, undefined);
    const rows = flattenSessionRows(
      sessions,
      1,
      tree,
      new Set(),
      new Set(),
      new Set(),
      [],
      { exclude: new Set(["session-a"]) },
    );

    expect(rows.map((row) => row.session.id)).toEqual(["session-b"]);
  });
});

describe("archived session ordering", () => {
  test("orders archived sessions most-recently-archived first, regardless of input order", () => {
    const sessions: SidebarSessionItem[] = [
      { id: "older-archive", time: { created: 100, updated: 100, archived: 200 } },
      { id: "newest-archive", time: { created: 300, updated: 300, archived: 400 } },
      { id: "active-but-touched-later", time: { created: 500, updated: 600 } },
      { id: "mid-archive", time: { created: 50, updated: 50, archived: 300 } },
    ];
    const { archived } = partitionArchivedSessions(sessions);
    const ordered = orderArchivedSessions(archived, (session) => session.time?.archived);

    // Active sessions never join the archived section, and the archived ones
    // sort by archival time even though "active-but-touched-later" has the
    // newest time.updated on the server.
    expect(archived.map((session) => session.id).sort()).toEqual([
      "mid-archive",
      "newest-archive",
      "older-archive",
    ]);
    expect(ordered.map((session) => session.id)).toEqual([
      "newest-archive",
      "mid-archive",
      "older-archive",
    ]);
  });
});

describe("collectSessionDescendants", () => {
  test("returns no descendants for a leaf session", () => {
    const sessions: SidebarSessionItem[] = [
      { id: "root", title: "Root" },
    ];
    expect(collectSessionDescendants(sessions, "root")).toEqual([]);
  });

  test("collects direct and nested descendants recursively", () => {
    const sessions: SidebarSessionItem[] = [
      { id: "root", title: "Root" },
      { id: "child", title: "Child", parentID: "root" },
      { id: "grandchild", title: "Grandchild", parentID: "child" },
      { id: "other", title: "Other" },
    ];
    const descendants = collectSessionDescendants(sessions, "root");
    expect(descendants.sort()).toEqual(["child", "grandchild"]);
  });

  test("ignores archived and unrelated sessions", () => {
    const sessions: SidebarSessionItem[] = [
      { id: "root", title: "Root" },
      { id: "child", title: "Child", parentID: "root" },
      { id: "sibling", title: "Sibling", parentID: "other-root" },
      { id: "archived-child", title: "Archived child", parentID: "root", time: { archived: 1 } },
    ];
    expect(collectSessionDescendants(sessions, "root").sort()).toEqual([
      "archived-child",
      "child",
    ]);
  });
});

describe("directChildPresenceBySessionId", () => {
  test("marks parents with non-archived children and defaults others to false", () => {
    const sessions: SidebarSessionItem[] = [
      { id: "parent", title: "Parent" },
      { id: "child", title: "Child", parentID: "parent" },
      { id: "leaf", title: "Leaf" },
      { id: "archived-parent", title: "Archived parent", time: { archived: 1 } },
      { id: "orphan-child", title: "Orphan child", parentID: "archived-parent" },
    ];
    expect(directChildPresenceBySessionId(sessions)).toEqual(new Map([
      ["parent", true],
      ["child", false],
      ["leaf", false],
      ["orphan-child", false],
    ]));
  });
});

describe("sessionsNewlyWithChildren", () => {
  test("flags sessions crossing from false to true", () => {
    const previous = new Map<string, boolean>([
      ["a", false],
      ["b", true],
    ]);
    const current = new Map<string, boolean>([
      ["a", true],
      ["b", true],
    ]);
    expect(sessionsNewlyWithChildren(previous, current)).toEqual(["a"]);
  });

  test("does not flag sessions already parented or previously absent", () => {
    const previous = new Map<string, boolean>([
      ["a", true],
      ["c", false],
    ]);
    const current = new Map<string, boolean>([
      ["a", true], // already had children — no change
      ["b", true], // first appears already-parented — not a transition
    ]);
    expect(sessionsNewlyWithChildren(previous, current)).toEqual([]);
  });
});
