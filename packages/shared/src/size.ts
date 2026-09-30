/**
 * Size-string parser (plan 2.2). Keep behaviour in sync with
 * services/ingest/src/qarib_ingest/sizes.py - both are tested against
 * packages/shared/fixtures/size-cases.json.
 */
import { normalizeDigits } from './normalize';

export type SizeUnit = 'g' | 'kg' | 'ml' | 'l' | 'pc';
export type BaseUnit = 'kg' | 'l' | 'pc';

export interface ParsedSize {
  /** Size of ONE pack, in `size_unit`. */
  size_value: number;
  size_unit: SizeUnit;
  pack_count: number;
  /** Total quantity in base units (kg / L / piece). */
  base_quantity: number;
  base_unit: BaseUnit;
}

interface UnitDef {
  unit: SizeUnit;
  factor: number; // multiplier to convert the written value into `unit`
}

const u = (unit: SizeUnit, factor = 1): UnitDef => ({ unit, factor });

const UNITS: Record<string, UnitDef> = {};
const add = (def: UnitDef, ...names: string[]) => names.forEach((n) => (UNITS[n] = def));

add(u('g'), 'g', 'gm', 'gms', 'gr', 'gram', 'grams', 'غ', 'غم', 'جم', 'جرام', 'غرام');
add(
  u('kg'),
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'كجم',
  'كغ',
  'كغم',
  'كيلو',
  'كيلوجرام',
  'كيلوغرام',
);
add(u('ml'), 'ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'مل', 'ملل');
add(u('ml', 10), 'cl');
add(u('l'), 'l', 'lt', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres', 'ل', 'لتر');
add(
  u('pc'),
  'pc',
  'pcs',
  'pce',
  'piece',
  'pieces',
  'pack',
  'packs',
  'ct',
  'count',
  'قطعة',
  'قطع',
  'حبة',
  'حبات',
);
add(u('g', 28.3495), 'oz', 'ounce', 'ounces');
add(u('g', 453.592), 'lb', 'lbs', 'pound', 'pounds');
const DOZEN = new Set(['dozen', 'doz', 'دزينة']);

const round4 = (n: number) => Math.round(n * 10000) / 10000;

function parseNumber(raw: string): number | null {
  let s = raw;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (s.includes(','))
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d+(?:[.,]\d+)*)`;
const WORD = String.raw`([a-z؀-ۿ]+)`;
const SEP = String.raw`\s*`;
// 2 x 500g | 6x330 ml
const PACK_X_SIZE = new RegExp(String.raw`^(\d+)${SEP}x${SEP}${NUM}${SEP}${WORD}$`);
// 500g x 2
const SIZE_X_PACK = new RegExp(String.raw`^${NUM}${SEP}${WORD}${SEP}x${SEP}(\d+)$`);
// 500 g | 12 pcs | 1.5l
const SIZE_ONLY = new RegExp(String.raw`^${NUM}${SEP}${WORD}$`);
// kg | per kg
const UNIT_ONLY = new RegExp(String.raw`^(?:per\s+)?${WORD}$`);
// pack of 6
const PACK_OF = new RegExp(String.raw`^pack\s+of\s+(\d+)$`);

function build(value: number, def: UnitDef, packCount: number): ParsedSize | null {
  if (!(value > 0) || !Number.isInteger(packCount) || packCount < 1) return null;
  const sizeValue = round4(value * def.factor);
  const base_unit: BaseUnit =
    def.unit === 'g' || def.unit === 'kg' ? 'kg' : def.unit === 'pc' ? 'pc' : 'l';
  const perBase = def.unit === 'g' || def.unit === 'ml' ? 1000 : 1;
  return {
    size_value: sizeValue,
    size_unit: def.unit,
    pack_count: packCount,
    base_quantity: round4((sizeValue * packCount) / perBase),
    base_unit,
  };
}

/** Parse a retailer size string. Returns null when it cannot be understood. */
export function parseSize(input: string): ParsedSize | null {
  const s = normalizeDigits(input.normalize('NFKC'))
    .toLowerCase()
    .replace(/[×✕✖*]/g, 'x')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  let m = PACK_OF.exec(s);
  if (m) return build(1, UNITS.pc!, Number(m[1]));

  m = PACK_X_SIZE.exec(s);
  if (m) {
    const def = lookup(m[3]!);
    const v = parseNumber(m[2]!);
    return def && v !== null ? build(v, def.def, Number(m[1]) * def.mult) : null;
  }

  m = SIZE_X_PACK.exec(s);
  if (m) {
    const def = lookup(m[2]!);
    const v = parseNumber(m[1]!);
    return def && v !== null ? build(v, def.def, Number(m[3]) * def.mult) : null;
  }

  m = SIZE_ONLY.exec(s);
  if (m) {
    const def = lookup(m[2]!);
    const v = parseNumber(m[1]!);
    return def && v !== null ? build(v, def.def, def.mult) : null;
  }

  m = UNIT_ONLY.exec(s);
  if (m) {
    const def = lookup(m[1]!);
    // A bare unit means "per 1 <unit>" (loose produce, per-kg pricing). Only meaningful for
    // kg / l / pc; a bare "g" or "ml" is not a real size.
    const bareOk = def && ['kg', 'l', 'pc'].includes(def.def.unit) && def.def.factor === 1;
    return bareOk ? build(1, def.def, def.mult) : null;
  }
  return null;
}

/** Resolve a unit word; dozens become 12 pieces. */
function lookup(word: string): { def: UnitDef; mult: number } | null {
  if (DOZEN.has(word)) return { def: UNITS.pc!, mult: 12 };
  const def = UNITS[word];
  return def ? { def, mult: 1 } : null;
}
