/**
 * media/retentionRules.ts — what deleting a render takes with it (pure, so it
 * is checked without a browser; retention.ts applies it).
 */

/**
 * Deleting the last render of a video also forgets that video (its captions
 * and original, here and on the server) — but never for a clip's render: a
 * clip's render belongs to its clip, and its video (and every other clip of
 * it) must keep working.
 */
export function forgetsProject(item: { clipId?: string | null }, isLastOfProject: boolean): boolean {
  return isLastOfProject && !item.clipId;
}
