/** clips/linkSource.ts — what the device can tell about a pasted video link without fetching it. */

const YT_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
const MEDIA_EXT = /\.(mp4|m4v|mov|webm)$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function youTubeId(url: string): string | null {
  const host = hostOf(url);
  if (!YT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  try {
    const u = new URL(url);
    const id =
      u.searchParams.get('v') ??
      (host === 'youtu.be' ? u.pathname.slice(1) : /\/(?:shorts|live|embed)\/([\w-]+)/.exec(u.pathname)?.[1]);
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A direct media file (not a site page). */
export function isDirectMedia(url: string): boolean {
  try {
    return MEDIA_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Poster candidates for a linked video, best first (YouTube only). */
export function linkPosters(url: string | undefined | null): string[] | undefined {
  const id = url ? youTubeId(url) : null;
  return id ? [`https://i.ytimg.com/vi/${id}/hq720.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`] : undefined;
}
