/**
 * ClipGrid — a responsive grid of ClipCards. Exactly one card plays at a time
 * (hover, focus or tap); its project's source/captions/style load on first
 * use and are cached. Off-screen cards skip layout and paint
 * (content-visibility), so a feed of hundreds stays light without a
 * virtualizer fighting a responsive column count. With `selected` set the
 * grid is in selection mode: cards show checkboxes and nothing plays.
 *
 * A clip of a video from a pasted link plays from its own part once this
 * device has fetched it (opened or rendered); until then its card shows the
 * video's poster and opens the clip.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clip } from '../../lib/clips/api';
import { localClipMedia } from '../../lib/clips/clipMedia';
import { clipAspect, clipStyle, cropTrackFor, deferredIn } from '../../lib/clips/clipMath';
import { linkPosters } from '../../lib/clips/linkSource';
import { loadProjectAssets, type ProjectAssets } from '../../lib/clips/projectAssets';
import { projectCaptions } from '../../lib/clips/renderClip';
import type { RenderState } from '../../stores/clipsStore';
import { ClipCard } from './ClipCard';
import { ClipPreview } from './ClipPreview';

interface ClipGridProps {
  clips: Clip[];
  /** The project of every clip, when the grid shows a single project (clip set page). */
  project?: { _id: string; sourceUrl?: string; video?: { kind?: string } };
  showProject?: boolean;
  showReason?: boolean;
  renders: Record<string, RenderState | undefined>;
  /** Selection mode: the ids picked so far (undefined = not selecting). */
  selected?: ReadonlySet<string>;
  onToggleSelect?(clip: Clip): void;
  onOpen(clip: Clip): void;
  onEditCaptions?(clip: Clip): void;
  onRender?(clip: Clip, assets: ProjectAssets | undefined): void;
  onDownload?(clip: Clip): void;
  onDelete?(clip: Clip): void;
}

/** A linked video's clip part on this device: object URL + the source time at its 0:00 (null = none here). */
type Part = { url: string; offset: number } | null;

export function ClipGrid({
  clips,
  project,
  showProject,
  showReason,
  renders,
  selected,
  onToggleSelect,
  onOpen,
  onEditCaptions,
  onRender,
  onDownload,
  onDelete,
}: ClipGridProps) {
  const [active, setActive] = useState<string | null>(null);
  const [assets, setAssets] = useState<Record<string, ProjectAssets | undefined>>({});
  const [parts, setParts] = useState<Record<string, Part | undefined>>({});
  const partUrls = useRef<string[]>([]);

  const kindOf = useCallback((c: Clip) => c.project?.video?.kind ?? project?.video?.kind, [project]);
  const linkOf = useCallback((c: Clip) => c.project?.sourceUrl ?? project?.sourceUrl, [project]);

  useEffect(() => () => partUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const activate = useCallback(
    (id: string | null) => {
      setActive(id);
      const clip = id ? clips.find((c) => c._id === id) : undefined;
      if (!clip) return;
      // A linked video's clip: its own part, if this device has fetched it (looked up again until
      // found — a render or the clip page may fetch it — and after a trim).
      const partKey = `${clip._id}:${clip.start}:${clip.end}`;
      if (linkOf(clip) && !parts[partKey]) {
        void localClipMedia(clip.projectId, clip)
          .then((m) => {
            const url = m ? URL.createObjectURL(m.file) : null;
            if (url) partUrls.current.push(url);
            setParts((s) => ({ ...s, [partKey]: url && m ? { url, offset: m.offset } : null }));
          })
          .catch(() => setParts((s) => ({ ...s, [partKey]: null })));
      }
      const have = assets[clip.projectId];
      if (have && !deferredIn(have.captions, [clip])) return;
      void (have ? Promise.resolve(have) : loadProjectAssets(clip.projectId, kindOf(clip)))
        .then(async (a) => {
          // A clip trimmed since its captions were loaded may reach captions not translated yet.
          const captions = deferredIn(a.captions, [clip])
            ? await projectCaptions(clip.projectId, [clip]).catch(() => a.captions)
            : a.captions;
          setAssets((s) => ({ ...s, [clip.projectId]: { ...a, captions } }));
        })
        .catch(() => undefined);
    },
    [clips, assets, parts, kindOf, linkOf],
  );

  // Stop playback when the active clip leaves the list (filter change, delete) or selection starts.
  useEffect(() => {
    if (active && (selected || !clips.some((c) => c._id === active))) setActive(null);
  }, [clips, active, selected]);

  return (
    <ul className={`clip-grid${selected ? ' is-selecting' : ''}`}>
      {clips.map((clip) => {
        const a = assets[clip.projectId];
        const link = linkOf(clip);
        const part = link ? parts[`${clip._id}:${clip.start}:${clip.end}`] : undefined;
        const src = link ? part?.url : a?.url;
        const preview =
          !selected && active === clip._id && src && a ? (
            <ClipPreview
              src={src}
              credentials={!link && a.credentials}
              start={clip.start}
              end={clip.end}
              offset={part?.offset ?? 0}
              captions={a.captions}
              style={clipStyle(a.style, clip)}
              track={cropTrackFor(clip)}
              aspect={clipAspect(clip)}
              playing
            />
          ) : undefined;
        return (
          <ClipCard
            key={clip._id}
            clip={clip}
            projectId={clip.projectId}
            videoKind={kindOf(clip)}
            preview={preview}
            hasSource={link ? part !== null : a ? !!a.url : true}
            canRender={link ? true : undefined}
            fallbackPosters={linkPosters(link)}
            showProject={showProject}
            showReason={showReason}
            render={renders[clip._id]}
            selected={selected ? selected.has(clip._id) : undefined}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(clip) : undefined}
            onActivate={activate}
            onOpen={() => onOpen(clip)}
            onEditCaptions={onEditCaptions ? () => onEditCaptions(clip) : undefined}
            onRender={onRender ? () => onRender(clip, a) : undefined}
            onDownload={onDownload ? () => onDownload(clip) : undefined}
            onDelete={onDelete ? () => onDelete(clip) : undefined}
          />
        );
      })}
    </ul>
  );
}
