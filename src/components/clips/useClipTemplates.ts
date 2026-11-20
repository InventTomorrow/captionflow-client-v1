import { useMemo } from 'react';
import { isDeviceExportTemplate } from '../../lib/export/clientExport';
import { pickerTemplates } from '../../lib/templateCatalog';
import { useFlagsStore } from '../../stores/flagsStore';

/** The caption templates a clip can use (device export only), in catalogue order. */
export function useClipTemplates() {
  const layout = useFlagsStore((s) => s.templateLayout);
  return useMemo(() => pickerTemplates(layout).filter((t) => isDeviceExportTemplate(t.preset.template)), [layout]);
}
