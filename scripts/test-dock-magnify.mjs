import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_METRICS,
  buildDockLayout,
  iconAt,
  magnifyLayout,
  scaledMetrics,
} from "../src/dock/magnify.ts";

const MAG = { range: 132, maxScale: 1.42 };

test("empty layout keeps padding only", () => {
  const r = buildDockLayout([], DEFAULT_METRICS);
  assert.equal(r.width, 2 * DEFAULT_METRICS.padding);
  assert.equal(r.height, DEFAULT_METRICS.icon + 2 * DEFAULT_METRICS.padding);
});

test("layout omits trailing gap after last icon", () => {
  const r = buildDockLayout(["icon", "icon", "icon"], DEFAULT_METRICS);
  const expected = 3 * DEFAULT_METRICS.icon + 2 * DEFAULT_METRICS.gap + 2 * DEFAULT_METRICS.padding;
  assert.equal(r.width, expected);
});

test("scaledMetrics keeps separator width >= 1px", () => {
  assert.equal(scaledMetrics(DEFAULT_METRICS, 0.3).separatorWidth, 1);
});

test("amount = 0 returns exact rest positions", () => {
  const layout = buildDockLayout(["icon", "icon", "separator", "icon", "icon"], DEFAULT_METRICS);
  const mag = magnifyLayout(layout, 90, 0, MAG);
  assert.deepEqual(mag.rects, layout.slots.map((s) => s.rect));
  assert.equal(mag.left, 0);
  assert.equal(mag.right, layout.width);
});

test("icon under cursor reaches exact maxScale and keeps bottom baseline", () => {
  const layout = buildDockLayout(["icon", "icon", "icon", "icon", "icon"], DEFAULT_METRICS);
  const r2 = layout.slots[2].rect;
  const cursor = r2.x + r2.width / 2;
  const mag = magnifyLayout(layout, cursor, 1, MAG);
  assert.ok(Math.abs(mag.rects[2].width - DEFAULT_METRICS.icon * MAG.maxScale) < 1e-3);
  const base = DEFAULT_METRICS.padding + DEFAULT_METRICS.icon;
  for (let i = 0; i < layout.slots.length; i++) {
    assert.ok(Math.abs(mag.rects[i].y + mag.rects[i].height - base) < 1e-3);
  }
});

test("icons outside range keep rest size and expansion is balanced around center", () => {
  const items = Array(12).fill("icon");
  const layout = buildDockLayout(items, DEFAULT_METRICS);
  const r0 = layout.slots[0].rect;
  const magFirst = magnifyLayout(layout, r0.x + r0.width / 2, 1, MAG);
  assert.equal(magFirst.rects[11].width, DEFAULT_METRICS.icon);

  const magCenter = magnifyLayout(layout, layout.width / 2, 1, MAG);
  assert.ok(Math.abs((magCenter.left + magCenter.right) / 2 - layout.width / 2) < 1e-3);
});

test("neighbouring slots never overlap across any cursor position", () => {
  const items = ["icon", "icon", "icon", "separator", "icon", "icon", "icon"];
  const layout = buildDockLayout(items, DEFAULT_METRICS);
  for (let cx = -20; cx <= layout.width + 20; cx += 3) {
    const mag = magnifyLayout(layout, cx, 1, MAG);
    for (let i = 0; i < mag.rects.length - 1; i++) {
      assert.ok(
        mag.rects[i].x + mag.rects[i].width <= mag.rects[i + 1].x + 1e-3,
        `overlap between ${i} and ${i + 1} at cx=${cx}`,
      );
    }
  }
});

test("iconAt resolves icons including half gaps and skips separators", () => {
  const layout = buildDockLayout(["icon", "separator", "icon"], DEFAULT_METRICS);
  const mag = magnifyLayout(layout, 50, 0.75, MAG);
  const r0 = mag.rects[0];
  const rSep = mag.rects[1];
  const r2 = mag.rects[2];
  assert.equal(iconAt(mag, layout, r0.x + r0.width / 2, DEFAULT_METRICS.gap), 0);
  assert.equal(iconAt(mag, layout, rSep.x + rSep.width / 2, DEFAULT_METRICS.gap), -1);
  assert.equal(iconAt(mag, layout, r2.x + r2.width / 2, DEFAULT_METRICS.gap), 2);
});
