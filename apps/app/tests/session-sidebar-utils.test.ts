import { describe, expect, test } from "bun:test";

import type { SidebarSessionItem } from "../src/app/types";
import {
  buildSessionTreeState,
  flattenSessionRows,
  orderArchivedSessions,
  partitionArchivedSessions,
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
