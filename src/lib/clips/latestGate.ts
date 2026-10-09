/**
 * clips/latestGate.ts — "only the newest request wins". Each request takes a
 * ticket; a response whose ticket is no longer current is dropped, so a slow
 * reply for an old filter can never overwrite the list for the new one.
 */
export function createLatestGate() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (ticket: number) => ticket === current,
  };
}
