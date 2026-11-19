import test from "node:test";
import assert from "node:assert/strict";
import { appBadgeCount, formatBadgeCount, isBrowserHostApp, unreadBadgeFromTitle } from "../src/dock/badges.ts";
import { MIN_DOCK_ICON_PX, planDockFit } from "../src/dock/fit.ts";
import { contrastInkOn, dissolveGroup, extractChildFromGroup, filterGroupChildren, groupStyleOf } from "../src/dock/groups.ts";
import { effectiveSurfaceAlpha, isSurfaceOpaque } from "../src/dock/surface.ts";

test("unreadBadgeFromTitle parses (N) and (99+) prefixes cleanly", () => {
  assert.equal(unreadBadgeFromTitle("(12) Inbox — Mail"), 12);
  assert.equal(unreadBadgeFromTitle("(99+) Chats"), 99);
  assert.equal(unreadBadgeFromTitle("(1)\tNotification"), 1);
  assert.equal(unreadBadgeFromTitle("(12345) Too long"), 0);
  assert.equal(unreadBadgeFromTitle("Notes (2).txt"), 0);
  assert.equal(formatBadgeCount(142), "99+");
  assert.equal(formatBadgeCount(0), "");
});

test("appBadgeCount combines window badge and title count", () => {
  const n = appBadgeCount([
    { title: "(3) Mail", badge: 0 },
    { title: "Compose", badge: 7 },
  ]);
  assert.equal(n, 7);
  assert.equal(isBrowserHostApp("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"), true);
  assert.equal(isBrowserHostApp("code.exe"), false);
});

test("planDockFit compacts widgets first, then shrinks icons down to 24px, then overflows", () => {
  const plenty = planDockFit({
    availableWidth: 1200,
    baseIconSize: 44,
    gap: 10,
    paddingX: 10,
    entryCount: 6,
    separatorCount: 1,
    fixedHeadCount: 4,
    widgetsFullWidth: 180,
    widgetsCompactWidth: 90,
  });
  assert.deepEqual(plenty, { compactWidgets: false, iconSize: 44, overflowCount: 0 });

  const compactOnly = planDockFit({
    availableWidth: 460,
    baseIconSize: 44,
    gap: 10,
    paddingX: 10,
    entryCount: 6,
    separatorCount: 1,
    fixedHeadCount: 4,
    widgetsFullWidth: 180,
    widgetsCompactWidth: 70,
  });
  assert.equal(compactOnly.compactWidgets, true);
  assert.equal(compactOnly.iconSize, 44);
  assert.equal(compactOnly.overflowCount, 0);

  const shrunk = planDockFit({
    availableWidth: 340,
    baseIconSize: 44,
    gap: 8,
    paddingX: 10,
    entryCount: 6,
    separatorCount: 1,
    fixedHeadCount: 4,
    widgetsFullWidth: 140,
    widgetsCompactWidth: 80,
  });
  assert.equal(shrunk.compactWidgets, true);
  assert.ok(shrunk.iconSize >= MIN_DOCK_ICON_PX && shrunk.iconSize < 44);
  assert.equal(shrunk.overflowCount, 0);

  const overflowed = planDockFit({
    availableWidth: 320,
    baseIconSize: 44,
    gap: 8,
    paddingX: 10,
    entryCount: 12,
    separatorCount: 1,
    fixedHeadCount: 4,
    widgetsFullWidth: 120,
    widgetsCompactWidth: 80,
  });
  assert.equal(overflowed.iconSize, MIN_DOCK_ICON_PX);
  assert.ok(overflowed.overflowCount > 0);
});

test("group helpers filter diacritic-insensitively and preserve/dissolve cleanly", () => {
  assert.equal(contrastInkOn("#ffffff"), "#181a1f");
  assert.equal(contrastInkOn("#101010"), "#ffffff");
  assert.deepEqual(groupStyleOf({ color: "#0078D4", glyph: "code" }), {
    color: "#0078d4",
    ink: "#ffffff",
    glyph: "code",
  });

  const children = [
    { id: "c1", name: "Terminale", path: "wt.exe" },
    { id: "c2", name: "Visual Studio Code", path: "Code.exe" },
    { id: "c3", name: "Posta", path: "olk.exe" },
  ];
  assert.equal(filterGroupChildren(children, "code").length, 1);
  assert.equal(filterGroupChildren(children, "WT").length, 1);

  const pins = [{ id: "g1", name: "Work", children }];
  const afterExtract = extractChildFromGroup(pins, "g1", "c3");
  assert.equal(afterExtract.length, 2);
  assert.equal(afterExtract[0].children?.length, 2);
  assert.equal(afterExtract[1].id, "c3");

  const afterDissolve = dissolveGroup(afterExtract, "g1");
  assert.deepEqual(afterDissolve.map((p) => p.id), ["c1", "c2", "c3"]);
});

test("surface policy switches to solid high-contrast opacity when reduceTransparency is on", () => {
  assert.equal(isSurfaceOpaque(true), true);
  assert.equal(effectiveSurfaceAlpha({ opacity: 60 }, true), 1);
  assert.equal(effectiveSurfaceAlpha({ opacity: 60 }, false), 0.6);
});
