/**
 * ClipGrid — a responsive grid of ClipCards. Exactly one card plays at a time
 * (hover, focus or tap); its project's source/captions/style load on first
 * use and are cached. Off-screen cards skip layout and paint
 * (content-visibility), so a feed of hundreds stays light without a
 * virtualizer fighting a responsive column count. With `selected` set the
 * grid is in selection mode: cards show checkboxes and nothing plays.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Clip } from '../../lib/clips/api';
import { clipStyle, cropTrackFor } from '../../lib/clips/clipMath';
import { loadProjectAssets, type ProjectAssets } from '../../lib/clips/projectAssets';
import type { RenderState } from '../../stores/clipsStore';
import { ClipCard } from './ClipCard';
import { ClipPreview } from './ClipPreview';

interface ClipGridProps {
  clips: Clip[];
  /** The project of every clip, when the grid shows a single project (clip set page). */
  project?: { _id: string; video?: { kind?: string } };
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

  const kindOf = useCallback((c: Clip) => c.project?.video?.kind ?? project?.video?.kind, [project]);

  const activate = useCallback(
    (id: string | null) => {
      setActive(id);
      const clip = id ? clips.find((c) => c._id === id) : undefined;
      if (!clip || assets[clip.projectId]) return;
      void loadProjectAssets(clip.projectId, kindOf(clip))
        .then((a) => setAssets((s) => ({ ...s, [clip.projectId]: a })))
        .catch(() => undefined);
    },
    [clips, assets, kindOf],
  );

  // Stop playback when the active clip leaves the list (filter change, delete) or selection starts.
  useEffect(() => {
    if (active && (selected || !clips.some((c) => c._id === active))) setActive(null);
  }, [clips, active, selected]);

  return (
    <ul className={`clip-grid${selected ? ' is-selecting' : ''}`}>
      {clips.map((clip) => {
        const a = assets[clip.projectId];
        const preview =
          !selected && active === clip._id && a?.url ? (
            <ClipPreview
              src={a.url}
              credentials={a.credentials}
              start={clip.start}
              end={clip.end}
              captions={a.captions}
              style={clipStyle(a.style, clip)}
              track={cropTrackFor(clip)}
              playing
            />
          ) : undefined;
        return (
          <ClipCard
            key={clip._id}
            clip={clip}
            projectId={clip.projectId}
            preview={preview}
            hasSource={a ? !!a.url : true}
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
