/**
 * Site job workflow — tools checklist (month grid) + machinery category mapping.
 * Marks length = calendar days 1–31 (two UI blocks: 01–15 and 16–31).
 */

export const TOOL_MARK_DAYS = 31;

/** Block 0 = days 1–15, block 1 = days 16–31 (matches paper “second half” sheet). */
export const TOOL_DAY_BLOCK_COUNT = 2;

export function toolDayBlockStartCol(blockIndex) {
  return blockIndex <= 0 ? 0 : 15;
}

export function toolDayBlockLength(blockIndex) {
  return blockIndex <= 0 ? 15 : 16;
}

export function calendarDayForCell(blockIndex, colIndex) {
  return toolDayBlockStartCol(blockIndex) + colIndex + 1;
}

export function padMarksForMonth(marks) {
  const a = Array.isArray(marks) ? marks.slice(0, TOOL_MARK_DAYS) : [];
  while (a.length < TOOL_MARK_DAYS) a.push("");
  return a;
}

/** Same family as attendance register: present / absent / sick / HQ / leave / injury; ✓ = “available” tick like paper form. */
export const TOOL_DAY_STATUS_CODES = ["", "✓", "P", "A", "S", "HQ", "LS", "INJ"];

export const TOOL_DAY_STATUS_LEGEND = [
  { code: "✓", text: "Tick / available on site (paper checklist style)." },
  { code: "P", text: "Present (on site / in use)." },
  { code: "A", text: "Absent / not available that day." },
  { code: "S", text: "Sick / stood down." },
  { code: "HQ", text: "HQ duty (not on site)." },
  { code: "LS", text: "Leave / shift off." },
  { code: "INJ", text: "Injury / restricted." },
];

export const CHECKLIST_CATEGORY_KEYS = ["A", "B", "C", "I", "J", "K"];

export const CHECKLIST_CATEGORY_OPTIONS = [
  { key: "", label: "— Not linked to tools checklist —" },
  { key: "A", label: "A — Measuring instruments" },
  { key: "B", label: "B — Drilling machine tools" },
  { key: "C", label: "C — Hand tools" },
  { key: "I", label: "I — Lifting tools" },
  { key: "J", label: "J — Safety items" },
  { key: "K", label: "K — Spares" },
];

export const CHECKLIST_KEY_TO_LABEL = Object.fromEntries(
  CHECKLIST_CATEGORY_OPTIONS.filter((o) => o.key).map((o) => [o.key, o.label.replace(/^.\s—\s/, "")]),
);

export function emptyItem(slNo) {
  return { slNo, description: "", uom: "", qty: "", itemDate: "", marks: Array(TOOL_MARK_DAYS).fill("") };
}

/** Default wizard: six sections (A–C paper + I–K second sheet), one blank row each. */
export function defaultToolCategories() {
  return [
    { key: "A", label: "Measuring instruments", items: [emptyItem(1)] },
    { key: "B", label: "Drilling machine tools", items: [emptyItem(1)] },
    { key: "C", label: "Hand tools", items: [emptyItem(1)] },
    { key: "I", label: "Lifting tools", items: [emptyItem(1)] },
    { key: "J", label: "Safety items", items: [emptyItem(1)] },
    { key: "K", label: "Spares", items: [emptyItem(1)] },
  ];
}

function seeded(desc, uom, qty, slNo) {
  return { slNo, description: desc, uom, qty, itemDate: "", marks: Array(TOOL_MARK_DAYS).fill("") };
}

/** Full default rows from site paper forms (client-side seed; persist via wizard save). */
export function getSeededToolChecklistCategories() {
  const A = [
    ["Dial Gauge with Magnetic Stand 0-10mm", "Nos", "2"],
    ["Master Level 150x150", "Nos", "1"],
    ["Vernier Caliper - 300mm", "Nos", "1"],
    ["Hamar Laser", "Set", "1"],
    ["ID Micrometer 1000-5000mm", "Set", "1"],
    ["Straight Edge 5Mtrs", "Nos", "1"],
    ["Measuring Tape - 5mtr & 10mtr", "Each", "1"],
    ["Feeler Gauge", "Set", "1"],
    ["Feeler Gauge (0.03, 0.04 & 0.05)", "Set", "1"],
    ["Try Square 12 in & 6 in", "Nos", "1 Each"],
    ["Steel rule - 300 & 1000mm", "Nos", "1 Each"],
    ["Trammel", "No", "1"],
    ["Surface Roughness Tester Analog", "No", "1"],
    ["Surface finish Tester digital", "No", "1"],
    ["Divider", "No", "1"],
    ["Tester", "No", "1"],
    ["Multimeter", "No", "1"],
    ["Potentiometre", "Nos", "2"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  const B = [
    ["Chamfering cutter with adaptor Dia 80", "Set", "1"],
    ["M80X6mm Tap", "Nos", "2"],
    ["Tapping adaptor suitable for MT4", "Nos", "2"],
    ["Drill Bits 3, 5, 4, 2, 5, 6, 8, 8.5, 10, 2, 12, 14, 17.5, 22 & 25mm", "Each", "1"],
    ["Tap sets M4, M5, M6, M8, M10, M12, M14, M16 & M20", "Each", "1"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  const C = [
    ["Grinding Machine", "Nos", "2"],
    ["Screw Jacks - 5 tons", "Nos", "2"],
    ["Hammer - Iron", "Nos", "1"],
    ["Mallet", "Nos", "1"],
    ["Screw Driver - Long", "Nos", "1"],
    ["Cutting Plier", "Nos", "1"],
    ["Double End Spanner 6-32", "Set", "1"],
    ["Ring spanner 6-32", "Set", "1"],
    ["Ring spanner 30-32", "Nos", "1"],
    ["Hex Head with Ratchet", "Set", "1"],
    ["Allen keys", "Set", "1"],
    ['Adjustable spanner 12"', "Nos", "1"],
    ["Double End Spanner 24-27", "Nos", "2"],
    ["Double End Spanner 20-22", "Nos", "1"],
    ["Single End spanner sz-46", "Nos", "2"],
    ["Force Kit", "Set", "1"],
    ['C-Clamps 12"', "Nos", "2"],
    ['C-Clamps 8"', "Nos", "2"],
    ['C-Clamps 4"', "Nos", "2"],
    ["Flat file & Round file", "Nos", "1 each"],
    ["Needle File", "Set", "1"],
    ["Oil Stone", "Nos", "1"],
    ["Emery sheet", "Each", "5"],
    ["Deburring Tool", "Nos", "1"],
    ["Centre punch", "Nos", "1"],
    ["Adopter Drop Bolt Locking Key - 19mm", "Nos", "1"],
    ["Bur cleaning brush", "Nos", "2"],
    ["Air Hose and fitting Set", "Set", "1"],
    ["Chalk", "Box", "1"],
    ["Knife", "Nos", "1"],
    ["Permanent Marker Pen", "Nos", "2"],
    ["Paint Marker Pen", "Nos", "2"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  const I = [
    ["Nylon Slings-3tons", "Nos", "4"],
    ["Nylon Slings-1 ton", "Nos", "2"],
    ["Nylon Slings-5tons", "Nos", "2"],
    ["D-shackles Forged -5ton", "Nos", "4"],
    ["M20 Swivel I - Bolts", "Nos", "4"],
    ["I - Bolts M20", "Nos", "4"],
    ["I - Bolts M16", "Nos", "6"],
    ["Ratchetbelt-4mtrs", "Nos", "2"],
    ["Ratchetbelt-3mtrs", "Nos", "6"],
    ["Ratchet belt-2mtrs", "Nos", "2"],
    ["Ratchet Belt - 12 mtrs", "Nos", "1"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  const J = [
    ["Hand Gloves", "Pair", "50"],
    ["Nose Mask", "Nos", "20"],
    ["Ear Plug", "Nos", "20"],
    ["Goggle", "Nos", "5"],
    ["Safety Harness", "Nos", "5"],
    ["Leather Gloves", "Pair", "2"],
    ["First aid kit", "Nos", "1"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  const K = [
    ["20 Ton Dshackles", "Nos", "4"],
    ["Allen key small 17mm", "NO", "1"],
    ["Spanner 41mm", "No", "1"],
  ].map((r, i) => seeded(r[0], r[1], r[2], i + 1));

  return [
    { key: "A", label: "Measuring instruments", items: A },
    { key: "B", label: "Drilling machine tools", items: B },
    { key: "C", label: "Hand tools", items: C },
    { key: "I", label: "Lifting tools", items: I },
    { key: "J", label: "Safety items", items: J },
    { key: "K", label: "Spares", items: K },
  ];
}

export function normalizeToolChecklistFromWizard(toolChecklist) {
  const skeleton = defaultToolCategories();
  let categories = Array.isArray(toolChecklist?.categories) ? [...toolChecklist.categories] : [...skeleton];
  const keys = new Set(categories.map((c) => c.key));
  for (const cat of skeleton) {
    if (!keys.has(cat.key)) {
      categories.push({ ...cat, items: cat.items.map((it) => ({ ...it, marks: padMarksForMonth(it.marks) })) });
      keys.add(cat.key);
    }
  }
  categories = categories.map((cat) => ({
    ...cat,
    items: (cat.items || []).map((it, idx) => ({
      ...it,
      slNo: idx + 1,
      itemDate: it.itemDate != null ? String(it.itemDate) : "",
      marks: padMarksForMonth(it.marks),
    })),
  }));
  return { categories };
}

/** True when every row is still blank — safe to replace with the standard paper template on first load. */
export function isToolChecklistEmptyForAutoSeed(toolChecklist) {
  const cats = toolChecklist?.categories;
  if (!Array.isArray(cats) || cats.length === 0) return true;
  for (const cat of cats) {
    for (const it of cat.items || []) {
      if (String(it.description ?? "").trim() !== "") return false;
      if (String(it.itemDate ?? "").trim() !== "") return false;
      if (it.machineryCatalogId != null) return false;
      const marks = padMarksForMonth(it.marks);
      if (marks.some((m) => String(m ?? "").trim() !== "")) return false;
    }
  }
  return true;
}

/** Format YYYY-MM for display; returns null if invalid. */
export function formatYearMonthHeading(yyyyMm) {
  const m = String(yyyyMm ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return new Date(y, mo - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/** Read checklist key from API machinery row (supports several possible field names). */
export function getMachineryChecklistKey(m) {
  const raw = m?.checklistCategoryKey ?? m?.toolChecklistCategoryKey ?? m?.checklistKey ?? "";
  const k = String(raw).toUpperCase().trim();
  return CHECKLIST_CATEGORY_KEYS.includes(k) ? k : "";
}
