import type { WordRole } from '../stores/captionStore';

/**
 * Ensure exactly one Hero + one Support (`small`) per phrase for the Phrases
 * panel. Fills gaps when older captions only had a hero from the previous agent.
 */
export function ensureOneHeroOneSupport(
  text: string,
  emphasis?: WordRole[] | null,
): WordRole[] {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (!n) return [];

  const roles: WordRole[] = Array.from({ length: n }, (_, i) => emphasis?.[i] ?? 'auto');

  // Preserve explicit 'normal', start from existing hero/support.
  let heroIdx = roles.findIndex((r) => r === 'hero');
  let supportIdx = roles.findIndex((r) => r === 'small');

  const len = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, '').length;
  const scored = words
    .map((t, i) => ({ i, n: len(t) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i);

  if (n === 1) {
    return ['hero'];
  }

  if (heroIdx < 0) heroIdx = scored[0]?.i ?? 0;
  if (supportIdx < 0 || supportIdx === heroIdx) {
    supportIdx = scored.find((x) => x.i !== heroIdx)?.i ?? (heroIdx === 0 ? 1 : 0);
  }
  if (supportIdx === heroIdx) supportIdx = heroIdx === 0 ? 1 : 0;

  // Clear duplicate heroes / supports, then set the single pair.
  for (let i = 0; i < n; i++) {
    if (roles[i] === 'hero' || roles[i] === 'small') roles[i] = 'auto';
  }
  roles[heroIdx] = 'hero';
  roles[supportIdx] = 'small';
  return roles;
}
