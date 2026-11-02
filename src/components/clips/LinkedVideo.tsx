/**
 * LinkedVideo — a video that came from a pasted link, played straight from
 * the link: nothing is downloaded. YouTube plays in its own (privacy-enhanced)
 * player, a direct media link in a <video>; other sites get a link out.
 * With `range` it plays one clip's span; `cropX` fills a vertical frame the
 * way the clip is framed (CSS only — the real crop happens at render).
 */
import { ExternalLink } from 'lucide-react';
import { isDirectMedia, youTubeId } from '../../lib/clips/linkSource';

/** Width of a 16:9 picture that fills a 9:16 frame's height, in % of the frame's width. */
const COVER_WIDTH = (16 / 9 / (9 / 16)) * 100;

interface Props {
  sourceUrl: string;
  /** Play only this span (source seconds), muted and from its start. */
  range?: { start: number; end: number };
  /** Fill a vertical frame, centred on this 0..1 point (a 9:16 clip's framing). */
  cropX?: number | null;
  title?: string;
  className?: string;
}

export function LinkedVideo({ sourceUrl, range, cropX, title = 'Source video', className }: Props) {
  const id = youTubeId(sourceUrl);
  const cover = typeof cropX === 'number';
  const fill = cover
    ? { width: `${COVER_WIDTH}%`, left: `${-(COVER_WIDTH - 100) * Math.max(0, Math.min(1, cropX))}%` }
    : undefined;

  if (id) {
    const params = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
    if (range) {
      params.set('start', String(Math.floor(range.start)));
      params.set('end', String(Math.ceil(range.end)));
      params.set('autoplay', '1');
      params.set('mute', '1');
      if (cover) params.set('controls', '0');
    }
    return (
      <div className={`linked-video${cover ? ' is-cover' : ''}${className ? ` ${className}` : ''}`}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
          title={title}
          style={fill}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  if (isDirectMedia(sourceUrl)) {
    const src = range ? `${sourceUrl}#t=${range.start.toFixed(2)},${range.end.toFixed(2)}` : sourceUrl;
    return (
      <div className={`linked-video${cover ? ' is-cover' : ''}${className ? ` ${className}` : ''}`}>
        <video
          src={src}
          title={title}
          controls={!range}
          autoPlay={!!range}
          muted={!!range}
          playsInline
          preload="metadata"
          style={cover ? { ...fill, objectFit: 'cover' } : undefined}
        />
      </div>
    );
  }

  return (
    <div className={`linked-video is-link${className ? ` ${className}` : ''}`}>
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="btn ghost">
        <ExternalLink size={16} aria-hidden="true" />
        Watch the original
      </a>
    </div>
  );
}
