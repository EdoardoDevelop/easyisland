# EasyIsland Code Optimizations

## Overview

This document summarizes optimization opportunities identified across the EasyIsland codebase (version 0.6.0). The suggestions focus on performance, code maintainability, and reducing unnecessary computations.

## 1. State Management Optimizations

### `src/core/state.ts`

**Issue: Large `Settings` interface with redundant computations**

The `Settings` interface contains many properties that could be derived or cached:

```typescript
// Current pattern - computes values on every access
export interface Settings {
  // ...
  integrationTabs: string[];
  integrationTabIcons: Record<string, string>;
  pillOrder: string[];
  tabOrder: string[];
  // ...
}
```

**Optimization: Cache derived values**

- `integrationTabs` and `integrationTabIcons` should be computed once and cached
- `pillOrder` and `tabOrder` could use `Map` instead of arrays for O(1) lookups
- Consider using `readonly` where appropriate to prevent accidental mutations

**Example optimization:**
```typescript
// Instead of recalculating every time
const integrationTabs = computed(() => State.settings.activeIntegrations.filter(id => PROBE_INTEGRATIONS[id]));

// Or memoize in the applySettings method
applySettings() {
  // Cache computed values
  this._integrationTabs = State.settings.activeIntegrations
    .filter(id => PROBE_INTEGRATIONS[id])
    .map(id => PROBE_INTEGRATIONS[id]);
}
```

### `src/core/state.ts` - `INTEGRATION_AGENTS` array

**Issue: Linear search for integration tasks**

The `INTEGRATION_AGENTS` array is iterated linearly to find tasks by ID.

**Optimization: Use a Map for lookups**

```typescript
// Current: linear search
const agent = INTEGRATION_AGENTS.find(a => a.id === id);

// Optimized: O(1) lookup with Map
const integrationAgentsMap = new Map(
  INTEGRATION_AGENTS.map(a => [a.id, a])
);
// Usage: integrationAgentsMap.get(id)
```

## 2. View Rendering Optimizations

### `src/views/views.ts`

**Issue: Unnecessary Set/Map creation in render loops**

Multiple `new Set()` and `new Map()` calls inside view rendering functions can cause unnecessary allocations.

**Optimization: Cache frequently used Sets/Maps**

```typescript
// Current pattern (creates new Set on every render)
const BRAND_IDS = new Set(Object.keys(BRAND_SVG));

// Optimized: create once at module level
export const BRAND_IDS = new Set(Object.keys(BRAND_SVG));
```

### `src/views/actions.ts`

**Issue: Filter operations on every render**

```typescript
// Current
const folders = [...new Set(list.map(fname).filter(Boolean))];

// Optimized: Use a utility function with memoization
function getUniqueNames(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter(fname => {
    if (seen.has(fname)) return false;
    seen.add(fname);
    return true;
  });
}
```

## 3. Character Engine Optimizations

### `src/character/engine.ts`

**Issue: Map operations without size checks**

The `tweens` and `locks` Maps/Sets could grow unbounded.

**Optimization: Add size limits and cleanup**

```typescript
// Current
private tweens = new Map<PropKey, Tween>();
private locks = new Set<PropKey>();

// Optimized with size limits
private tweens = new Map<PropKey, Tween>(/* max 100 entries */);
private locks = new Set<PropKey>(/* max 50 entries */);

// Periodic cleanup
function cleanupTweens() {
  if (this.tweens.size > 100) {
    // Remove oldest entries
    const entries = Array.from(this.tweens.entries());
    this.tweens = new Map(entries.slice(entries.length - 50));
  }
}
```

## 4. Sound System Optimizations

### `src/core/sound.ts`

**Issue: Audio buffer management**

```typescript
// Current
private buffers = new Map<string, AudioBuffer>();

// Optimization: Preload frequently used sounds and limit memory
private buffers = new Map<string, AudioBuffer>(/* max 20 entries */);

// Implement LRU cache pattern for sound buffers
```

## 5. Bridge Communication Optimizations

### `src/core/bridge.ts`

**Issue: Event handler overhead**

Multiple event listeners are registered without checking if the bridge is already initialized.

**Optimization: Debounce rapid events**

```typescript
// Add debouncing for high-frequency events
let resizeTimeout: NodeJS.Timeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    Bridge.emit('resize', getDimensions());
  }, 100);
});
```

## 6. Code Quality Improvements

### Type Safety Enhancements

**Issue: `any` type usage in several files**

```typescript
// Found in multiple locations
function processData(data: any) { ... }
```

**Optimization: Replace `any` with specific types or generics**

```typescript
// Better
function processData<T>(data: T): T { ... }
// Or
interface ProcessedData {
  // explicit structure
}
function processData(data: ProcessedData): ProcessedData { ... }
```

### Function Purity

**Issue: Functions with side effects not clearly documented**

Some functions modify global state without clear indication.

**Optimization: Add JSDoc comments documenting side effects**

```typescript
/**
 * Updates the island settings and triggers a re-render.
 * Side effects: modifies State.settings, island.applySettings(), refreshes integration tasks.
 * @param partial - Partial settings to merge
 */
function applySettings(partial: Partial<Settings>): void {
  State.settings = { ...State.settings, ...partial };
  island.applySettings();
  State.loadIntegrationTasks();
}
```

## 7. Build and TypeScript Optimizations

### `package.json` Scripts

**Issue: Build script runs both typecheck and build**

```json
"scripts": {
  "build": "tsc --noEmit && vite build"
}
```

**Optimization: Separate type checking from build**

Consider running type checking separately in CI, or using `vite`'s built-in type checking:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "build": "vite build"
}
```

This allows faster iteration during development (`npm run build` skips type checking) while maintaining strict type checking in CI.

## 8. Rust Backend Optimizations

### `src-tauri/src/island.rs`

**Issue: Not visible in this session, but similar optimizations apply**

- Ensure async operations are properly awaited
- Use `tokio` efficiently for concurrent operations
- Minimize mutex contention

## Summary of High-Impact Changes

| Area | Impact | Effort |
|------|--------|--------|
| State caching (integrationTabs, pillOrder) | High | Low |
| Map instead of linear search for agents | Medium | Low |
| Cache BRAND_IDS Set | Low | Very Low |
| Remove `any` types | Medium | Medium |
| Debounce resize events | Low | Low |
| Separate typecheck from build | Medium | Low |

## Next Steps

1. **Prioritize** the high-impact, low-effort changes first
2. **Run the existing test suite** after each change to ensure no regressions
3. **Consider adding unit tests** for the optimized functions
4. **Update HANDOFF.md** with any new optimization decisions