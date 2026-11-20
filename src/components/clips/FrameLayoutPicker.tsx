/**
 * FrameLayoutPicker — the three framing layouts for the clip's video type
 * (Podcast: Single / Dual / Full shot; Gaming: Stacked / Facecam PiP /
 * Gameplay focus), each card drawn from the clip's own frame through the same
 * layout geometry the preview and export use. Without a frame on this device
 * the cards show neutral panels instead (never stock imagery).
 */
import { useEffect, useRef, useState } from 'react';
import {
  LAYOUTS_FOR,
  LAYOUT_LABEL,
  defaultFraming,
  type ClipFramingV1,
  type FramingLayout,
  type VideoType,
} from '../../lib/clips/framing';
import { drawLayout, panelDraw, panelsFor, type LayoutContext } from '../../lib/clips/layout';
import type { SourceFrame } from '../../lib/clips/thumbs';

const CARD_W = 90;
const CARD_H = 160;

function LayoutCard({
  layout,
  framing,
  frame,
  image,
}: {
  layout: FramingLayout;
  framing: ClipFramingV1;
  frame: SourceFrame | null;
  image: HTMLImageElement | null;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(CARD_W * dpr);
    const H = Math.round(CARD_H * dpr);
    canvas.width = W;
    canvas.height = H;
    if (image && frame) {
      drawLayout(ctx as unknown as LayoutContext, W, H, framing, frame.width, frame.height, (c, sx, sy, sw, sh, dx, dy, dw, dh) =>
        (c as unknown as CanvasRenderingContext2D).drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh),
      );
      return;
    }
    // No frame here yet: the layout's panels as plain blocks.
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, W, H);
    panelsFor(framing, W, H).forEach((p, i) => {
      const d = panelDraw(p, 16, 9);
      ctx.fillStyle = i === 0 ? '#2a2e33' : '#3b4047';
      ctx.fillRect(d.dx + 1, d.dy + 1, Math.max(1, d.dw - 2), Math.max(1, d.dh - 2));
    });
  }, [framing, frame, image, layout]);
  return <canvas ref={ref} className="frame-card-canvas" style={{ width: CARD_W, height: CARD_H }} aria-hidden="true" />;
}

interface FrameLayoutPickerProps {
  videoType: VideoType;
  /** The layout in use; 'single' also stands for the original crop (framing null); null = none of these. */
  active: FramingLayout | null;
  /** The clip's framing, so cards keep the boxes already placed. */
  framing: ClipFramingV1 | null;
  frame: SourceFrame | null;
  srcW?: number;
  srcH?: number;
  disabled?: boolean;
  onPick(layout: FramingLayout): void;
}

export function FrameLayoutPicker({ videoType, active, framing, frame, srcW, srcH, disabled, onPick }: FrameLayoutPickerProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImage(null);
    if (!frame) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setImage(img);
    img.src = frame.url;
    return () => {
      live = false;
    };
  }, [frame]);

  return (
    <div className="frame-cards" role="radiogroup" aria-label="Frame layout">
      {LAYOUTS_FOR[videoType].map((layout) => {
        const on = active === layout;
        const preview = framing && framing.layout === layout ? framing : defaultFraming(layout, srcW, srcH, framing);
        return (
          <button
            key={layout}
            type="button"
            role="radio"
            aria-checked={on}
            className={`frame-card${on ? ' is-on' : ''}`}
            disabled={disabled}
            onClick={() => !on && onPick(layout)}
          >
            <LayoutCard layout={layout} framing={preview} frame={frame} image={image} />
            <span className="frame-card-name">{LAYOUT_LABEL[layout]}</span>
          </button>
        );
      })}
    </div>
  );
}
