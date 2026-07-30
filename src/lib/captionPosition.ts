/**
 * CapCut-style caption placement: the caption CENTER is stored as X/Y
 * percentages of the preview/export canvas (0–100). Presets and drag both
 * write the same fields, and the burn-in maps those % → pixels with ASS
 * \an5\pos so preview and export share one coordinate system.
 */
export type CaptionPosition = 'top' | 'center' | 'bottom';

export interface CaptionAnchor {
  offsetX: number;
  offsetY: number;
}

/** Preset anchors — must stay in sync with server resolveAnchorPct. */
export const POSITION_PRESETS: Record<CaptionPosition, CaptionAnchor> = {
  top: { offsetX: 50, offsetY: 18 },
  center: { offsetX: 50, offsetY: 50 },
  bottom: { offsetX: 50, offsetY: 85 },
};

/** Resolve the live anchor from saved style (drag offsets win over presets). */
export function resolveCaptionAnchor(style: {
  position?: CaptionPosition | string | null;
  offsetX?: number | null;
  offsetY?: number | null;
}): CaptionAnchor {
  const preset =
    POSITION_PRESETS[
      (style.position === 'top' || style.position === 'center' || style.position === 'bottom'
        ? style.position
        : 'bottom') as CaptionPosition
    ];
  return {
    offsetX:
      typeof style.offsetX === 'number' && Number.isFinite(style.offsetX)
        ? style.offsetX
        : preset.offsetX,
    offsetY:
      typeof style.offsetY === 'number' && Number.isFinite(style.offsetY)
        ? style.offsetY
        : preset.offsetY,
  };
}

/** Which preset (if any) the current X/Y matches, else null = custom drag. */
export function matchPositionPreset(anchor: CaptionAnchor): CaptionPosition | null {
  for (const key of Object.keys(POSITION_PRESETS) as CaptionPosition[]) {
    const p = POSITION_PRESETS[key];
    if (Math.abs(p.offsetX - anchor.offsetX) < 0.6 && Math.abs(p.offsetY - anchor.offsetY) < 0.6) {
      return key;
    }
  }
  return null;
}
