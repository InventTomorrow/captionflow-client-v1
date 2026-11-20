/**
 * Template catalog + apply rules: stable unique keys, a category and font
 * source for every card, and that applying a card gives the same look whatever
 * was applied before it (nothing leaks from the previous template), keeps the
 * user's position, and is reported as applied only while it really is.
 *
 *   npx tsx scripts/checks/templates.check.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPLATE_CATALOG,
  TEMPLATE_CATEGORIES,
  pickerTemplates,
  templateCategory,
} from '../../src/lib/templateCatalog';
import { appliedTemplateKey, styleWithTemplate, TEMPLATE_LOOK_DEFAULTS } from '../../src/lib/templateApply';
import { buildExportStyle } from '../../src/lib/export/styleSnapshot';
import { FONT_FILES } from '../../src/lib/render/fonts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  PASS  ${name}`);
};

const LOOK = [...Object.keys(TEMPLATE_LOOK_DEFAULTS), 'template', 'displayMode', 'templateKey'] as const;
const look = (s: Record<string, unknown>) => Object.fromEntries(LOOK.map((k) => [k, s[k]]));

check(`${TEMPLATE_CATALOG.length} cards, keys unique and non-empty`, () => {
  const keys = TEMPLATE_CATALOG.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const t of TEMPLATE_CATALOG) {
    assert.ok(t.key && t.name && t.preset.template && t.preset.displayMode, t.key);
  }
});

check('every card has a known category; every category has cards', () => {
  for (const t of TEMPLATE_CATALOG) assert.ok(TEMPLATE_CATEGORIES.includes(templateCategory(t.key)), t.key);
  for (const g of TEMPLATE_CATEGORIES) assert.ok(pickerTemplates(null).some((t) => templateCategory(t.key) === g), g);
});

check('every card font has a source the export can load (Google Fonts import or bundled TTF)', () => {
  const css = readFileSync(path.join(root, 'index.html'), 'utf8') + readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const bundled = new Set(Object.keys(FONT_FILES).map((k) => k.toLowerCase()));
  for (const t of TEMPLATE_CATALOG) {
    const fam = styleWithTemplate({}, t).fontFamily;
    const inGoogle = css.includes(`family=${fam.replace(/ /g, '+')}`);
    assert.ok(inGoogle || bundled.has(fam.toLowerCase()), `${t.key}: font "${fam}" has no source`);
  }
});

check('applying a card gives the same look whatever was applied before', () => {
  for (const card of TEMPLATE_CATALOG) {
    const fresh = look(styleWithTemplate({}, card));
    for (const prev of TEMPLATE_CATALOG) {
      const after = look(styleWithTemplate(styleWithTemplate({ position: 'bottom', offsetY: 72 }, prev), card));
      assert.deepEqual(after, fresh, `${prev.key} → ${card.key}`);
    }
  }
});

check('switching templates keeps position, aspect and other non-look settings', () => {
  const user = { position: 'top', offsetX: 30, offsetY: 18, aspectRatio: '9:16', behindPerson: true, kinetic: { x: 1 } };
  for (const card of TEMPLATE_CATALOG) {
    const s = styleWithTemplate(user, card);
    for (const [k, v] of Object.entries(user)) assert.deepEqual((s as Record<string, unknown>)[k], v, `${card.key}.${k}`);
  }
});

check('the export snapshot of an applied card keeps its look (preview = export)', () => {
  for (const card of TEMPLATE_CATALOG) {
    const s = styleWithTemplate({}, card);
    const snap = buildExportStyle(s as never, { defaultAspect: '9:16' });
    for (const k of ['template', 'displayMode', 'fontFamily', 'fontWeight', 'color', 'highlightColor', 'animation', 'displayWords', 'fontSize'] as const) {
      assert.deepEqual(snap[k], (s as Record<string, unknown>)[k], `${card.key}.${k}`);
    }
    assert.equal(snap.templateKey, card.key);
  }
});

check('stacked / Hero Word rules: forced display mode and Hero Word font', () => {
  const hw = styleWithTemplate({}, TEMPLATE_CATALOG.find((t) => t.key === 'hero-word')!);
  assert.equal(hw.displayMode, 'paintOn');
  assert.equal(hw.fontFamily, 'Montserrat');
  assert.equal(hw.fontWeight, 900);
  for (const t of TEMPLATE_CATALOG.filter((c) => ['hero', 'stack', 'mixed', 'mixed2'].includes(c.preset.template))) {
    assert.equal(styleWithTemplate({ displayMode: 'karaoke' }, t).displayMode, 'phrase', t.key);
  }
});

check('applied state: the card just applied, none after a renderer/mode change, colour tweaks keep it', () => {
  for (const card of TEMPLATE_CATALOG) {
    const s = styleWithTemplate({}, card);
    assert.equal(appliedTemplateKey(s), card.key, card.key);
    assert.equal(appliedTemplateKey({ ...s, highlightColor: '#123456' }), card.key, `${card.key} recolour`);
    const otherMode = s.displayMode === 'word' ? 'sentence' : 'word';
    assert.equal(appliedTemplateKey({ ...s, displayMode: otherMode }), undefined, `${card.key} mode change`);
  }
  assert.equal(appliedTemplateKey({ template: 'classic', displayMode: 'rolling' }), undefined);
});

console.log(`All template checks passed (${n})`);
