// font-data.js — the hardcoded in-memory font the harness serves to the
// embedded editor. Two masters ("Light" default at wght=300, "Bold" at
// wght=700) on a single wght axis.
//
// Glyph "n": one closed contour of 11 points, mixing on-curve and cubic
// off-curve nodes so curve editing is exercised. VarPackedPath pointTypes
// (fontra-core/src/var-path.js): on-curve=0x00, off-curve cubic=0x02,
// smooth flag=0x08.
const ON = 0x00;
const ON_SMOOTH = 0x08;
const CUBIC_OFF = 0x02;

function makeNPath(widthScale, heightScale) {
  // an arch ("n-like", single closed contour, no counter)
  const pts = [
    [60, 0, ON_SMOOTH],
    [60, 320, CUBIC_OFF],
    [90, 560, CUBIC_OFF],
    [250, 700, ON_SMOOTH],
    [410, 560, CUBIC_OFF],
    [440, 320, CUBIC_OFF],
    [440, 0, ON_SMOOTH],
    [380, 0, ON],
    [300, 0, CUBIC_OFF],
    [200, 0, CUBIC_OFF],
    [120, 0, ON],
  ];
  const cx = 250;
  return {
    coordinates: pts.flatMap(([x, y]) => [
      Math.round(cx + (x - cx) * widthScale),
      Math.round(y * heightScale),
    ]),
    pointTypes: pts.map(([, , t]) => t),
    contourInfo: [{ endPoint: pts.length - 1, isClosed: true }],
  };
}

function makePeriodPath(offset) {
  // small square blob
  const pts = [
    [200, 0, ON],
    [300, 0, ON],
    [300, 100, ON],
    [200, 100, ON],
  ];
  return {
    coordinates: pts.flatMap(([x, y]) => [x + offset, y]),
    pointTypes: pts.map(([, , t]) => t),
    contourInfo: [{ endPoint: pts.length - 1, isClosed: true }],
  };
}

function makeGlyph(xAdvanceLight, xAdvanceBold, lightPath, boldPath) {
  return {
    name: null, // filled in below
    axes: [],
    sources: [
      { name: "Light", layerName: "Light", location: { wght: 300 } },
      { name: "Bold", layerName: "Bold", location: { wght: 700 } },
    ],
    layers: {
      Light: { glyph: { path: lightPath, components: [], xAdvance: xAdvanceLight } },
      Bold: { glyph: { path: boldPath, components: [], xAdvance: xAdvanceBold } },
    },
  };
}

const glyphN = makeGlyph(500, 520, makeNPath(1, 1), makeNPath(1.1, 1.02));
glyphN.name = "n";
const glyphPeriod = makeGlyph(500, 500, makePeriodPath(0), makePeriodPath(10));
glyphPeriod.name = "period";

export const FONT_DATA = {
  glyphMap: {
    n: [0x6e],
    period: [0x2e],
  },
  axes: {
    axes: [
      {
        name: "wght",
        label: "Weight",
        tag: "wght",
        minValue: 300,
        defaultValue: 300,
        maxValue: 700,
        hidden: false,
      },
    ],
    mappings: [],
  },
  sources: {
    light: {
      name: "Light",
      location: { wght: 300 },
      lineMetricsHorizontalLayout: {
        ascender: { value: 750 },
        descender: { value: -250 },
      },
    },
    bold: {
      name: "Bold",
      location: { wght: 700 },
      lineMetricsHorizontalLayout: {
        ascender: { value: 750 },
        descender: { value: -250 },
      },
    },
  },
  unitsPerEm: 1000,
  customData: {},
  backEndInfo: { features: {}, projectManagerFeatures: {} },
  readOnly: false,
  glyphs: {
    n: glyphN,
    period: glyphPeriod,
  },
};
