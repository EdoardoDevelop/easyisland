// Pure responsive fit calculator for the Dock row (prevents horizontal clipping on crowded bars).

export const MIN_DOCK_ICON_PX = 24;

export interface DockFitInput {
  availableWidth: number;
  baseIconSize: number;
  gap: number;
  paddingX: number;
  entryCount: number;
  separatorCount: number;
  fixedHeadCount: number;
  widgetsFullWidth: number;
  widgetsCompactWidth: number;
  separatorWidth?: number;
}

export interface DockFitPlan {
  compactWidgets: boolean;
  iconSize: number;
  /** How many trailing entries spill into an overflow button at the end of the track. */
  overflowCount: number;
}

function trackWidth(entryCount: number, iconSize: number, gap: number, sepCount: number, sepW: number, paddingX: number): number {
  const totalSlots = entryCount + sepCount;
  const gaps = Math.max(0, totalSlots - 1) * gap;
  return paddingX * 2 + entryCount * iconSize + sepCount * sepW + gaps;
}

/** Computes a deterministic fit plan: compact widgets -> scale icons down to 24px -> overflow menu chip. */
export function planDockFit(input: DockFitInput): DockFitPlan {
  const sepW = input.separatorWidth ?? 2;
  const avail = Math.max(200, input.availableWidth);
  const fullTrack = trackWidth(
    input.entryCount,
    input.baseIconSize,
    input.gap,
    input.separatorCount,
    sepW,
    input.paddingX,
  );

  if (fullTrack + input.widgetsFullWidth <= avail) {
    return { compactWidgets: false, iconSize: input.baseIconSize, overflowCount: 0 };
  }

  const compactW = Math.min(input.widgetsFullWidth, input.widgetsCompactWidth);
  const compactWidgets = compactW < input.widgetsFullWidth;
  if (fullTrack + compactW <= avail) {
    return { compactWidgets, iconSize: input.baseIconSize, overflowCount: 0 };
  }

  // Proportionally shrink base icon size down toward MIN_DOCK_ICON_PX before spilling into overflow.
  const fixedTrackOverhead =
    input.paddingX * 2 +
    input.separatorCount * sepW +
    Math.max(0, input.entryCount + input.separatorCount - 1) * input.gap;
  const budgetForIcons = avail - compactW - fixedTrackOverhead;
  if (input.entryCount > 0) {
    const fittedIcon = Math.floor(budgetForIcons / input.entryCount);
    if (fittedIcon >= MIN_DOCK_ICON_PX) {
      return { compactWidgets, iconSize: Math.min(input.baseIconSize, fittedIcon), overflowCount: 0 };
    }
  }

  // Even at MIN_DOCK_ICON_PX it still overflows: keep head entries + overflow chip ("...").
  const minIcon = Math.min(input.baseIconSize, MIN_DOCK_ICON_PX);
  const maxMoveable = Math.max(0, input.entryCount - input.fixedHeadCount - 1);
  let overflowCount = 0;
  for (let k = 1; k <= maxMoveable; k++) {
    const keptEntries = input.entryCount - k + 1; // remaining entries + 1 overflow chip
    const w = trackWidth(keptEntries, minIcon, input.gap, input.separatorCount, sepW, input.paddingX) + compactW;
    overflowCount = k;
    if (w <= avail) break;
  }
  return { compactWidgets, iconSize: minIcon, overflowCount };
}
