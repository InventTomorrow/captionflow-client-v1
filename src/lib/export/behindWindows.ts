/**
 * export/behindWindows.ts — WHEN "text behind person" applies, with no
 * segmenter code attached. The export (main thread and worker) decides from
 * these whether the person matte is needed at all; only then does it load
 * personMatte.ts (MediaPipe code, WASM and model).
 */

export interface BehindCaption {
  start: number;
  end: number;
  behindPerson?: boolean | null;
}

/**
 * Seconds ranges where the person is drawn over the captions — the preview's
 * rule (KineticCaptionLayer) and the server's enable= gate: a caption is
 * behind when `behindPerson ?? projectDefault` is true; each such caption
 * contributes [start − 0.25, end + 0.6] (a chunk still fading out must not have
 * the speaker pop in front of it). Every caption behind → one infinite window;
 * none → no windows.
 */
export function behindWindows(captions: readonly BehindCaption[], projectDefault: boolean): Array<[number, number]> {
  const on = captions.filter((c) => (c.behindPerson ?? projectDefault) === true);
  if (on.length === captions.length && captions.length > 0) return [[-Infinity, Infinity]];
  return on.map((c) => [c.start - 0.25, c.end + 0.6] as [number, number]);
}

export function isBehindAt(windows: ReadonlyArray<readonly [number, number]>, t: number): boolean {
  return windows.some(([a, b]) => t >= a && t <= b);
}
