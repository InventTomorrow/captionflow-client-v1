/**
 * ClipTemplatePicker — the caption templates as the editor draws them, plus
 * "Video's style" (the clip follows its video). A clip with a look made in the
 * captions editor shows that as the current choice; picking a card replaces it.
 *
 * With `max`, it is a compact strip (the clip page): the clip's choice first,
 * then the catalogue's own order, `max` tiles in all — the full picker opens
 * from "Browse all styles". Picking a tile does exactly what the full grid does,
 * and never reorders the strip under the cursor.
 */
import { FilmStrip, PencilLine } from '@phosphor-icons/react';
import { useState } from 'react';
import { TemplateCard } from '../TemplateCard';
import { useClipTemplates } from './useClipTemplates';

interface ClipTemplatePickerProps {
  /** Selected card; null = the video's style; undefined = none chosen (keep what each clip has). */
  templateKey: string | null | undefined;
  /** The clip has a look made in the captions editor (shown as the current choice). */
  custom?: boolean;
  disabled?: boolean;
  /** Offer "Video's style" (not on New clips, where the template becomes the video's style). */
  allowVideoStyle?: boolean;
  /** Compact strip: at most this many tiles, the current choice first. */
  max?: number;
  className?: string;
  onPick(templateKey: string | null): void;
}

export function ClipTemplatePicker({
  templateKey,
  custom,
  disabled,
  allowVideoStyle = true,
  max,
  className,
  onPick,
}: ClipTemplatePickerProps) {
  const all = useClipTemplates();
  const videoOn = !custom && templateKey === null;
  const room = Math.max(0, (max ?? 0) - (custom ? 1 : 0) - (allowVideoStyle ? 1 : 0));
  /** Strip only: the template that leads it — the clip's choice when the page opened, so a pick
   *  inside the strip never moves a tile from under the cursor; a pick from outside it takes over. */
  const [lead, setLead] = useState(templateKey);
  const strip = (leadKey: string | null | undefined) => {
    const first = all.find((t) => t.key === leadKey);
    return [...(first ? [first] : []), ...all.filter((t) => t !== first)].slice(0, room);
  };
  const selected = custom ? undefined : all.find((t) => t.key === templateKey);
  let leadKey = lead;
  let templates = max ? strip(leadKey) : all;
  if (max && selected && !templates.includes(selected) && lead !== templateKey) {
    leadKey = templateKey;
    setLead(templateKey);
    templates = strip(leadKey);
  }

  const videoCard = allowVideoStyle && (
    <button
      type="button"
      className={`display-card clip-tpl-video${videoOn ? ' active' : ''}`}
      onClick={() => onPick(null)}
      disabled={disabled}
      aria-pressed={videoOn}
    >
      <span className="clip-tpl-plain">
        <FilmStrip size={20} aria-hidden="true" />
        Video’s style
      </span>
      <span className="clip-tpl-name">Same as the full video</span>
    </button>
  );
  // The leading template sits ahead of "Video's style".
  const leadTemplate = max && templates[0] && templates[0].key === leadKey ? templates[0] : undefined;
  const listed = leadTemplate ? templates.slice(1) : templates;
  const card = (t: (typeof all)[number]) => (
    <TemplateCard key={t.key} t={t} isActive={!custom && templateKey === t.key} onApply={() => !disabled && onPick(t.key)} />
  );

  return (
    <div
      className={`clip-tpl-grid${max ? ' is-strip' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Caption templates"
    >
      {custom && (
        <div className="clip-tpl-custom display-card active" aria-current="true">
          <span className="clip-tpl-plain">
            <PencilLine size={20} aria-hidden="true" />
            Custom look
          </span>
          <span className="clip-tpl-name">Made in the captions editor</span>
        </div>
      )}
      {leadTemplate && card(leadTemplate)}
      {videoCard}
      {listed.map(card)}
    </div>
  );
}
