import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayCaption } from '../lib/displayCaptions';
import { resolveMove, type BlockSpan } from '../lib/timelineEdit';

/** Pointer travel (px) before a press on a block becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** Dragging within this many px of the timeline's edge scrolls it… */
const EDGE_PX = 56;
/** …by up to this many px per frame, faster the closer to the edge. */
const EDGE_SPEED_PX = 22;

interface Drag {
  id: string;
  /** Where the dragged block's left edge is being held, in seconds (may be out of range). */
  desiredStart: number;
}

/**
 * The caption blocks on the editor's timeline track.
 *
 *   click          seek to the block
 *   double-click   edit its text in place
 *   drag           move it to another time — see resolveMove for where it
 *                  lands and which neighbours slide to make room. While
 *                  dragging, the block follows the pointer, a dashed ghost
 *                  marks where it will land, and the neighbours already show
 *                  their new places. Escape cancels.
 */
export const TimelineBlocks = memo(function TimelineBlocks({
  captions,
  activeId,
  pps,
  maxEnd,
  contentRef,
  scrollerRef,
  draggingRef,
  editSourceId,
  onEditOpened,
  onSeek,
  onEdit,
  onMove,
}: {
  captions: DisplayCaption[];
  activeId?: string;
  /** Timeline zoom: pixels per second. */
  pps: number;
  /** End of the timeline in seconds — a block is never dropped past it. */
  maxEnd: number;
  /** The full-width timeline content; its left edge is t = 0. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** The horizontal scroll container, scrolled when a drag nears its edge. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Set while a drag is in progress, so playback's follow-the-playhead scroll stays out of the way. */
  draggingRef: React.MutableRefObject<boolean>;
  /** Stored-caption id whose block should open for editing (a chunk just added). */
  editSourceId?: string | null;
  onEditOpened?: () => void;
  onSeek: (seconds: number) => void;
  onEdit: (caption: DisplayCaption, text: string) => void;
  /** Block id → new start (seconds) for every block the drop changes. */
  onMove: (moves: Map<string, number>) => void;
}) {
  // Caption being edited in place after a double-click, or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Live mirrors for the window listeners, which outlive a render.
  const live = useRef({ captions, pps, maxEnd, onMove });
  live.current = { captions, pps, maxEnd, onMove };
  /** Ends the press in progress (listeners, scroll loop), if there is one. */
  const endPress = useRef<(() => void) | null>(null);
  useEffect(() => () => endPress.current?.(), []);

  useEffect(() => {
    if (!editSourceId) return;
    const block = captions.find((c) => c.sourceIds?.includes(editSourceId));
    if (!block?._id) return;
    setEditingId(block._id);
    onEditOpened?.();
  }, [editSourceId, captions, onEditOpened]);

  const spans = useMemo<BlockSpan[]>(
    () => captions.filter((c) => c._id).map((c) => ({ id: c._id as string, start: c.start, end: c.end })),
    [captions],
  );
  /** Where every displaced block sits right now, while a drag is in progress. */
  const layout = useMemo(
    () => (drag ? resolveMove(spans, drag.id, drag.desiredStart, maxEnd) : null),
    [drag, spans, maxEnd],
  );

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, c: DisplayCaption) {
    if (e.button !== 0 || !c._id || editingId === c._id) return;
    // A finger on the timeline scrolls it; dragging blocks is for mouse and pen.
    if (e.pointerType === 'touch') return;
    const content = contentRef.current;
    if (!content) return;
    endPress.current?.();

    const id = c._id;
    const downX = e.clientX;
    // Keep hold of the block at the point it was grabbed, not by its left edge.
    const grabOffset = (downX - content.getBoundingClientRect().left) / live.current.pps - c.start;
    let pointerX = downX;
    let dragging = false;
    let raf = 0;

    const desiredStart = () => {
      const left = contentRef.current?.getBoundingClientRect().left ?? 0;
      return (pointerX - left) / live.current.pps - grabOffset;
    };

    // One update per frame: follows the pointer, and keeps scrolling while the
    // pointer rests near an edge (no pointermove arrives for a still pointer).
    const frame = () => {
      raf = 0;
      if (!dragging) return;
      const scroller = scrollerRef.current;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        const intoLeft = box.left + EDGE_PX - pointerX;
        const intoRight = pointerX - (box.right - EDGE_PX);
        const push = intoLeft > 0 ? -intoLeft : intoRight > 0 ? intoRight : 0;
        if (push) {
          const before = scroller.scrollLeft;
          scroller.scrollLeft += Math.sign(push) * Math.min(1, Math.abs(push) / EDGE_PX) * EDGE_SPEED_PX;
          if (scroller.scrollLeft !== before) raf = requestAnimationFrame(frame);
        }
      }
      setDrag({ id, desiredStart: desiredStart() });
    };

    const onPointerMove = (ev: PointerEvent) => {
      pointerX = ev.clientX;
      if (!dragging) {
        if (Math.abs(pointerX - downX) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        draggingRef.current = true;
        // A drag that leaves the track must not sweep a text selection across the page.
        document.body.style.userSelect = 'none';
      }
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      if (raf) cancelAnimationFrame(raf);
      endPress.current = null;
      if (!dragging) return;
      dragging = false;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      setDrag(null);
      if (!commit) return;
      const { captions: blocks, maxEnd: end, onMove: move } = live.current;
      const moves = resolveMove(
        blocks.filter((b) => b._id).map((b) => ({ id: b._id as string, start: b.start, end: b.end })),
        id,
        desiredStart(),
        end,
      );
      if (moves.size) move(moves);
    };

    const onPointerUp = (ev: PointerEvent) => {
      pointerX = ev.clientX;
      if (dragging) {
        // The click that follows a drag would seek (on the block, or on the
        // track under it). Swallow exactly that one; if none comes, stand down.
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      finish(true);
    };
    const onPointerCancel = () => finish(false);
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !dragging) return;
      ev.stopPropagation();
      finish(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    endPress.current = () => finish(false);
  }

  const dragged = drag ? captions.find((c) => c._id === drag.id) : undefined;
  const widthOf = (c: DisplayCaption) => Math.max(30, (c.end - c.start) * pps - 3);

  return (
    <>
      {dragged && drag && (
        // Where it will land. The block itself follows the pointer.
        <div
          className="timeline-drop-ghost"
          style={{ left: (layout?.get(drag.id) ?? dragged.start) * pps + 1, width: widthOf(dragged) }}
        />
      )}
      {captions.map((c) => {
        const editing = editingId != null && editingId === c._id;
        const isDragged = drag != null && drag.id === c._id;
        const start = isDragged
          ? Math.min(Math.max(drag.desiredStart, 0), Math.max(0, maxEnd - (c.end - c.start)))
          : ((c._id ? layout?.get(c._id) : undefined) ?? c.start);
        return (
          <div
            key={c._id || c.sequence}
            role="button"
            className={`timeline-block ${activeId === c._id ? 'active' : ''} ${editing ? 'editing' : ''} ${
              isDragged ? 'dragging' : drag ? 'shifting' : ''
            }`}
            style={{ left: start * pps + 1, width: widthOf(c) }}
            title={editing || drag ? undefined : `${c.text} - drag to move, double-click to edit`}
            onPointerDown={(e) => onPointerDown(e, c)}
            onClick={(e) => {
              e.stopPropagation();
              if (!editing) onSeek(c.start);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingId(c._id || null);
            }}
          >
            {editing ? (
              <input
                autoFocus
                defaultValue={c.text}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = c.text;
                    e.currentTarget.blur();
                  }
                }}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  setEditingId(null);
                  if (text && text !== c.text) onEdit(c, text);
                }}
              />
            ) : (
              c.text
            )}
          </div>
        );
      })}
    </>
  );
});
