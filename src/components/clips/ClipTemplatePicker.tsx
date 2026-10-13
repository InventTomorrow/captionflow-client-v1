/**
 * ClipTemplatePicker — the caption templates as the editor draws them, plus
 * "Video's style" (the clip follows its video). A clip with a look made in the
 * captions editor shows that as the current choice; picking a card replaces it.
 */
import { Film, PenLine } from 'lucide-react';
import { useMemo } from 'react';
import { isDeviceExportTemplate } from '../../lib/export/clientExport';
import { pickerTemplates } from '../../lib/templateCatalog';
import { useFlagsStore } from '../../stores/flagsStore';
import { TemplateCard } from '../TemplateCard';

interface ClipTemplatePickerProps {
  /** Selected card; null = the video's style. */
  templateKey: string | null;
  /** The clip has a look made in the captions editor (shown as the current choice). */
  custom?: boolean;
  disabled?: boolean;
  onPick(templateKey: string | null): void;
}

export function ClipTemplatePicker({ templateKey, custom, disabled, onPick }: ClipTemplatePickerProps) {
  const layout = useFlagsStore((s) => s.templateLayout);
  const templates = useMemo(
    () => pickerTemplates(layout).filter((t) => isDeviceExportTemplate(t.preset.template)),
    [layout],
  );
  return (
    <div className={`clip-tpl-grid${disabled ? ' is-disabled' : ''}`} role="group" aria-label="Caption templates">
      {custom && (
        <div className="clip-tpl-custom display-card active" aria-current="true">
          <span className="clip-tpl-plain">
            <PenLine size={20} aria-hidden="true" />
            Custom look
          </span>
          <span className="clip-tpl-name">Made in the captions editor</span>
        </div>
      )}
      <button
        type="button"
        className={`display-card clip-tpl-video${!custom && !templateKey ? ' active' : ''}`}
        onClick={() => onPick(null)}
        disabled={disabled}
        aria-pressed={!custom && !templateKey}
      >
        <span className="clip-tpl-plain">
          <Film size={20} aria-hidden="true" />
          Video’s style
        </span>
        <span className="clip-tpl-name">Same as the full video</span>
      </button>
      {templates.map((t) => (
        <TemplateCard key={t.key} t={t} isActive={!custom && templateKey === t.key} onApply={() => !disabled && onPick(t.key)} />
      ))}
    </div>
  );
}
