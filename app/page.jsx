'use client';
import './globals.css';
import React, { useMemo, useState, useEffect, useRef } from "react";

/**
 * Packaging Box Designer (single-file JSX, WebGL‑safe + dynamic imports)
 *
 * This update wires pricing to the **YunExpress sheet you shared** (CNY):
 * - Line types: **No Battery** vs **Built-in Battery**
 * - Weight brackets with **fee per kg** + **item fee per parcel**
 * - Min. billed weight = 0.03 kg, rounding step = 0.001 kg (carry-over)
 * - Country selector (currently USA table inline)
 * - Pricing mode: **Sheet (US)** or **Manual per-kg** (fallback)
 * - Breakdown shown (fee × billedWeight + item)
 * - Download: JSON (current), CSV (saved), PNG/SVG (preview)
 *
 * NOTE: Extend the inline table below if you have more countries/lanes.
 */

// -----------------------------
// Options & Constants
// -----------------------------
const STYLE_OPTIONS = [
  { id: "ttm", name: "Tuck Top Mailer (TTM)", note: "Common mailer with hinged lid" },
  { id: "rett", name: "Roll End Tuck Top (RETT)", note: "Sturdy mailer, roll-over sides" },
  { id: "reft", name: "Roll End Front Tuck (REFT)", note: "Front locking tabs" },
  { id: "rsc", name: "Regular Slotted Carton (RSC)", note: "Standard shipping carton" },
  { id: "rigid", name: "Rigid Mailer / Envelope", note: "Flat document mailer" },
];

const DIVISORS = {
  metric: [
    { id: "cm5000", label: "Express (5000 cm³/kg)", divisor: 5000, vwUnit: "kg" },
    { id: "cm6000", label: "Some carriers (6000 cm³/kg)", divisor: 6000, vwUnit: "kg" },
    { id: "cm8000", label: "Economy (8000 cm³/kg)", divisor: 8000, vwUnit: "kg" },
    { id: "cm9000", label: "Economy (9000 cm³/kg)", divisor: 9000, vwUnit: "kg" },
    { id: "cm4000", label: "Bulky freight (4000 cm³/kg)", divisor: 4000, vwUnit: "kg" },
  ],
  imperial: [
    { id: "in139", label: "UPS/FedEx (139 in³/lb)", divisor: 139, vwUnit: "lb" },
    { id: "in166", label: "Alt/older (166 in³/lb)", divisor: 166, vwUnit: "lb" },
  ],
};

const PRESETS_CM = [
  { name: "Mailer – Small", L: 20, W: 15, H: 7 },
  { name: "Mailer – Medium", L: 30, W: 22, H: 10 },
  { name: "Mailer – Large", L: 40, W: 30, H: 12 },
];

const ABS_FALLBACK_DIVISOR = { id: "cm5000", label: "Express (5000 cm³/kg)", divisor: 5000, vwUnit: "kg" };
const SAVED_KEY = "box_setups_v3"; // bump schema version

// -----------------------------
// YunExpress US Sheet (inline) – derived from your XLSX
// Units: CNY, weights in kg
// -----------------------------
const YUNEXPRESS_US_TABLE = {
  country: 'United States',
  minWeightKg: 0.03,
  roundStepKg: 0.001,
  lines: {
    'No Battery': [
      { lo: 0.00, hi: 0.10, feePerKg: 102, itemFee: 24 },
      { lo: 0.10, hi: 0.20, feePerKg: 96,  itemFee: 22 },
      { lo: 0.20, hi: 0.30, feePerKg: 94,  itemFee: 20 },
      { lo: 0.30, hi: 0.45, feePerKg: 93,  itemFee: 20 },
      { lo: 0.45, hi: 0.70, feePerKg: 92,  itemFee: 20 },
      { lo: 0.70, hi: 2.00, feePerKg: 91,  itemFee: 13 },
      { lo: 2.00, hi: 30.00, feePerKg: 85, itemFee: 13 },
    ],
    'Built-in Battery': [
      { lo: 0.00, hi: 0.10, feePerKg: 108, itemFee: 24 },
      { lo: 0.10, hi: 0.20, feePerKg: 101, itemFee: 22 },
      { lo: 0.20, hi: 0.30, feePerKg: 102, itemFee: 20 },
      { lo: 0.30, hi: 0.45, feePerKg: 101, itemFee: 20 },
      { lo: 0.45, hi: 0.70, feePerKg: 98,  itemFee: 20 },
      { lo: 0.70, hi: 2.00, feePerKg: 97,  itemFee: 13 },
      { lo: 2.00, hi: 30.00, feePerKg: 97, itemFee: 13 },
    ],
  },
};

// Default editable fallback (Manual per-kg)
const DEFAULT_RATES = {
  perKgCNY: 50,              // price per started kg (ceil weight)
  minChargeCNY: 0,
  cnyPerUSD: 7.20,
};

// -----------------------------
// Utilities
// -----------------------------
function clampNumber(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

function normalizeUnits(units) {
  return units === "in" ? "in" : "cm"; // default to cm on any unexpected value
}

function getDivisorListFor(units) {
  const u = normalizeUnits(units);
  return u === "in" ? DIVISORS.imperial : DIVISORS.metric;
}

function safeGetDivisor(units, divisorId) {
  const list = getDivisorListFor(units);
  if (!Array.isArray(list) || list.length === 0) return ABS_FALLBACK_DIVISOR;
  const found = list.find((d) => d && d.id === divisorId);
  return found || list[0] || ABS_FALLBACK_DIVISOR;
}

function safeDivisorNumber(divisorObj, units) {
  const d = Number(divisorObj && divisorObj.divisor);
  if (Number.isFinite(d) && d > 0) return d;
  return normalizeUnits(units) === "in" ? 139 : 5000;
}

function lbToKg(lb) { return lb * 0.45359237; }

function useBoxCalculations({ L, W, H, units, boardMM, divisor, actualWeight }) {
  const u = normalizeUnits(units);
  // Convert board thickness to same unit as dims
  const board = u === "cm" ? boardMM / 10 : boardMM / 25.4; // cm or in

  const outer = { L, W, H };
  const inner = {
    L: Math.max(0, L - 2 * board),
    W: Math.max(0, W - 2 * board),
    H: Math.max(0, H - 2 * board),
  };

  const volume = L * W * H; // cm^3 or in^3
  const innerVolume = inner.L * inner.W * inner.H;

  const divisorSafe = Math.max(1, Number(divisor) || 1);
  const volWeight = volume / divisorSafe; // kg or lb depending on profile

  // Chargeable weight: max(actual, volumetric). If actualWeight is missing, just use volumetric.
  const chargeable = actualWeight > 0 ? Math.max(actualWeight, volWeight) : volWeight;

  // Surface area estimate for material (outer). 2(LW + LH + WH)
  const surfaceArea = 2 * (L * W + L * H + W * H);

  return { outer, inner, volume, innerVolume, volWeight, chargeable, surfaceArea };
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <strong>Heads up:</strong> {message}
    </div>
  );
}

class RenderBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { /* eslint-disable no-console */ console.error("3D render error:", err, info); }
  render() {
    if (this.state.err) return typeof this.props.fallback === 'function' ? this.props.fallback(this.state.err) : null;
    return this.props.children;
  }
}

// -----------------------------
// WebGL detection
// -----------------------------
function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (_) { return false; }
}

// -----------------------------
// Dynamic R3F loader (no static imports)
// -----------------------------
function useR3FLibs(enable) {
  const [libs, setLibs] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!enable) return;
        const [fiber, drei] = await Promise.all([
          import(/* webpackChunkName: "r3f-fiber" */ '@react-three/fiber'),
          import(/* webpackChunkName: "r3f-drei" */ '@react-three/drei'),
        ]);
        if (!cancelled) setLibs({ fiber, drei });
      } catch (e) {
        console.warn('R3F dynamic import failed; falling back to SVG.', e);
        if (!cancelled) setLibs(null);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [enable]);
  return libs; // { fiber, drei } | null
}

// -----------------------------
// SVG Isometric Fallback (no WebGL required)
// -----------------------------
function IsoBoxSVG({ L, W, H, styleId }) {
  const iso = (x, y, z) => { const X = (x - z) * 0.8660254037844386; const Y = y + (x + z) * 0.5; return [X, -Y]; };
  const data = useMemo(() => {
    const c = { a: [0,0,0], b: [L,0,0], c: [L,H,0], d: [0,H,0], e: [0,0,W], f: [L,0,W], g: [L,H,W], h: [0,H,W] };
    const p = {}; Object.keys(c).forEach((k) => { const [x,y] = iso(...c[k]); p[k] = { x, y }; });
    const vals = Object.values(p);
    const minX = Math.min(...vals.map(v=>v.x)); const maxX = Math.max(...vals.map(v=>v.x));
    const minY = Math.min(...vals.map(v=>v.y)); const maxY = Math.max(...vals.map(v=>v.y));
    return { p, minX, maxX, minY, maxY };
  }, [L,W,H]);
  const pad = 10, width = 420, height = 300;
  const scale = Math.min((width-2*pad)/Math.max(1e-6, data.maxX-data.minX), (height-2*pad)/Math.max(1e-6, data.maxY-data.minY));
  const tx = -data.minX*scale+pad, ty=-data.minY*scale+pad;
  const P = (k) => { const v = data.p[k]; return `${(v.x*scale+tx).toFixed(2)},${(v.y*scale+ty).toFixed(2)}`; };
  const top = `${P('d')} ${P('c')} ${P('g')} ${P('h')}`; const side = `${P('a')} ${P('d')} ${P('h')} ${P('e')}`; const front = `${P('a')} ${P('b')} ${P('c')} ${P('d')}`;
  const hasLid = styleId === 'ttm' || styleId === 'rett' || styleId === 'reft';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" role="img" aria-label="Isometric box preview">
      <defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15" /></filter></defs>
      <g filter="url(#shadow)">
        <polygon points={side} fill="#DCD7F2" stroke="#A8A3C8" strokeWidth="1" />
        <polygon points={front} fill="#EEEAFB" stroke="#B7B2D3" strokeWidth="1" />
        <polygon points={top} fill="#E9E7F7" stroke="#B7B2D3" strokeWidth="1" />
        {hasLid && (<polygon points={top} fill="rgba(137,120,217,0.12)" stroke="none" />)}
      </g>
      <polyline points={`${P('a')} ${P('b')} ${P('c')} ${P('d')} ${P('a')}`} fill="none" stroke="#8E88B5" strokeWidth="1.2" />
      <polyline points={`${P('a')} ${P('e')} ${P('h')} ${P('d')}`} fill="none" stroke="#8E88B5" strokeWidth="1.2" />
      <polyline points={`${P('b')} ${P('f')} ${P('g')} ${P('c')}`} fill="none" stroke="#8E88B5" strokeWidth="1.2" />
    </svg>
  );
}

// -----------------------------
// 3D Component (only if libs + WebGL available)
// -----------------------------
function R3FBox({ L, W, H, styleId, libs }) {
  const { fiber, drei } = libs || {}; if (!fiber || !drei) return null;
  const { Canvas } = fiber; const { OrbitControls, Edges } = drei;
  const maxDim = Math.max(L, W, H) || 1; const scale = 1.6 / maxDim; const dims = { x: L*scale, y: H*scale, z: W*scale };
  const hasLid = styleId === "ttm" || styleId === "rett" || styleId === "reft"; const lidThickness = Math.min(0.05, dims.y*0.1);
  return (
    <Canvas dpr={[1,1.5]} camera={{ position: [2.2,1.6,2.2], fov: 50 }} className="h-full w-full rounded-2xl">
      {React.createElement('ambientLight', { intensity: 0.8 })}
      {React.createElement('directionalLight', { intensity: 0.6, position: [3, 5, 2] })}
      {React.createElement('mesh', { position: [0, dims.y / 2, 0], castShadow: true, receiveShadow: true },
        React.createElement('boxGeometry', { args: [dims.x, dims.y, dims.z] }),
        React.createElement('meshStandardMaterial', { color: '#e6e1f4', roughness: 0.6, metalness: 0.05 }),
        React.createElement(Edges)
      )}
      {hasLid && React.createElement('mesh', { position: [0, dims.y + lidThickness / 2, 0] },
        React.createElement('boxGeometry', { args: [dims.x * 0.98, lidThickness, dims.z * 0.98] }),
        React.createElement('meshStandardMaterial', { color: '#d2cbed', roughness: 0.5, metalness: 0.1 }),
        React.createElement(Edges)
      )}
      {React.createElement('mesh', { rotation: [-Math.PI / 2, 0, 0], position: [0, 0, 0], receiveShadow: true },
        React.createElement('planeGeometry', { args: [10, 10] }),
        React.createElement('meshStandardMaterial', { color: '#fafafa' })
      )}
      {React.createElement('gridHelper', { args: [10, 10], position: [0, 0.001, 0] })}
      {React.createElement(OrbitControls, { enableDamping: true, dampingFactor: 0.1 })}
    </Canvas>
  );
}

// -----------------------------
// Shipping – Sheet (CNY) vs Manual per-kg
// -----------------------------
function chargeableToKg(units, chargeable) {
  return normalizeUnits(units) === 'cm' ? chargeable : lbToKg(chargeable);
}

function roundUp(value, step) {
  const s = Math.max(1e-6, step || 0.001);
  return Math.ceil(value / s) * s;
}

function computeSheetCNY({ weightKg, battery, country, table }) {
  const t = table || YUNEXPRESS_US_TABLE;
  if (!t || country !== t.country) return null; // unsupported
  const line = battery ? 'Built-in Battery' : 'No Battery';
  const brackets = t.lines[line] || [];
  const w = Math.max(t.minWeightKg, roundUp(Math.max(0, Number(weightKg) || 0), t.roundStepKg));
  const br = brackets.find(b => w > b.lo && w <= b.hi) || brackets[brackets.length - 1];
  if (!br) return null;
  const fee = br.feePerKg * w + br.itemFee;
  return { totalCNY: fee, usedKg: w, bracket: br };
}

function computeManualCNY({ weightKg, rates }) {
  const w = Math.max(0, Number(weightKg) || 0);
  const perKg = Math.max(0, Number(rates.perKgCNY) || 0);
  const minCharge = Math.max(0, Number(rates.minChargeCNY) || 0);
  const startedKg = Math.ceil(w <= 0 ? 0 : w);
  const total = Math.max(perKg * startedKg, minCharge);
  return { totalCNY: total, usedKg: startedKg, bracket: null };
}

function cnyToUsd(cny, cnyPerUSD) {
  const fx = Math.max(0.0001, Number(cnyPerUSD) || DEFAULT_RATES.cnyPerUSD);
  return cny / fx;
}

// -----------------------------
// Download helpers
// -----------------------------
function downloadBlob(filename, mime, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCSV(rows) {
  const headers = [
    'name','country','pricingMode','units','styleId','L','W','H','boardMM','divisorId','battery','qty','priceUSD','productCostUSD','variableFeePct','refundFeePct',
    'chargeableKg','shippingCNY','shippingUSD','shippingPerUnitUSD','costPerUnitUSD','totalCostUSD','breakdown'
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const d = r.derived || {}; // guard
    lines.push([
      csvEscape(r.name), r.country, r.pricingMode, r.units, r.styleId, r.L, r.W, r.H, r.boardMM, r.divisorId, r.battery, r.qty,
      r.priceUSD, r.productCostUSD, r.variableFeePct, r.refundFeePct,
      (d.chargeableKg ?? ''), (d.shippingCNY ?? ''), (d.shippingUSD ?? ''), (d.shippingPerUnitUSD ?? ''), (d.costPerUnitUSD ?? ''), (d.totalCostUSD ?? ''), csvEscape(d.breakdown || '')
    ].join(','));
  }
  return lines.join('\n');
}

function dataURLToBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/data:([^;]+)/) || [,'application/octet-stream'])[1];
  const bin = atob(b64); const len = bin.length; const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// -----------------------------
// Main Component
// -----------------------------
export default function PackagingBoxDesigner() {
  const [units, setUnits] = useState("cm");
  const [styleId, setStyleId] = useState("ttm");
  const [L, setL] = useState(30);
  const [W, setW] = useState(22);
  const [H, setH] = useState(10);
  const [boardMM, setBoardMM] = useState(2);
  const [battery, setBattery] = useState(false);

  // Country & pricing mode
  const [country, setCountry] = useState('United States');
  const [pricingMode, setPricingMode] = useState('sheet'); // 'sheet' | 'manual'

  // Commercial inputs
  const [qty, setQty] = useState(1);
  const [priceUSD, setPriceUSD] = useState(0);         // selling price per unit
  const [productCostUSD, setProductCostUSD] = useState(0); // COGS per unit
  const [variableFeePct, setVariableFeePct] = useState(0); // % of price
  const [refundFeePct, setRefundFeePct] = useState(0);     // % of price

  // Rates (manual fallback)
  const [rates, setRates] = useState({ ...DEFAULT_RATES });

  // Mount & WebGL detection
  const [mounted, setMounted] = useState(false);
  const [hasWebGL, setHasWebGL] = useState(false);
  useEffect(() => { setMounted(true); setHasWebGL(webglAvailable()); }, []);

  // Dynamically load R3F libs only if mounted + WebGL present
  const canUseR3F = mounted && hasWebGL;
  const r3fLibs = useR3FLibs(canUseR3F);

  // Divisors
  const divisorList = useMemo(() => getDivisorListFor(units), [units]);
  const [divisorId, setDivisorId] = useState(divisorList[0]?.id || ABS_FALLBACK_DIVISOR.id);
  const [actualW, setActualW] = useState(0); // kg for cm, lb for in

  useEffect(() => {
    const u = normalizeUnits(units);
    const list = getDivisorListFor(u);
    if (!Array.isArray(list) || list.length === 0) { setDivisorId(ABS_FALLBACK_DIVISOR.id); return; }
    const shouldBePrefix = u === "in" ? "in" : "cm";
    if (!String(divisorId || "").startsWith(shouldBePrefix)) setDivisorId(list[0].id);
  }, [units]);

  const divisorObj = useMemo(() => safeGetDivisor(units, divisorId), [units, divisorId]);
  const divisorNumeric = safeDivisorNumber(divisorObj, units);

  const parsed = {
    L: clampNumber(L, 0.01, 10000),
    W: clampNumber(W, 0.01, 10000),
    H: clampNumber(H, 0.01, 10000),
    boardMM: clampNumber(boardMM, 0, 25),
    actualW: clampNumber(actualW, 0, 1000),
    qty: Math.max(1, Math.floor(clampNumber(qty, 1, 1000000)))
  };

  const calc = useBoxCalculations({
    L: parsed.L, W: parsed.W, H: parsed.H, units,
    boardMM: parsed.boardMM, divisor: divisorNumeric, actualWeight: parsed.actualW,
  });

  // Shipping (CNY + USD), based on mode
  const chargeableKg = chargeableToKg(units, calc.chargeable);
  const sheetRes = pricingMode === 'sheet' ? computeSheetCNY({ weightKg: chargeableKg, battery, country, table: YUNEXPRESS_US_TABLE }) : null;
  const manualRes = pricingMode === 'manual' ? computeManualCNY({ weightKg: chargeableKg, rates }) : null;
  const useRes = sheetRes || manualRes || { totalCNY: 0, usedKg: 0, bracket: null };

  const shippingCNY = useRes.totalCNY;
  const shippingUSD = cnyToUsd(shippingCNY, rates.cnyPerUSD);
  const shippingPerUnitUSD = parsed.qty > 0 ? shippingUSD / parsed.qty : 0;

  const variableFeeUSD = (Number(priceUSD)||0) * (Number(variableFeePct)||0) / 100;
  const refundFeeUSD = (Number(priceUSD)||0) * (Number(refundFeePct)||0) / 100;
  const costPerUnitUSD = (Number(productCostUSD)||0) + variableFeeUSD + refundFeeUSD + shippingPerUnitUSD;
  const totalCostUSD = costPerUnitUSD * parsed.qty;

  const breakdown = useMemo(() => {
    if (pricingMode === 'sheet' && sheetRes && sheetRes.bracket) {
      const b = sheetRes.bracket;
      return `Sheet(${country}, ${battery ? 'Battery' : 'No Battery'}): fee ${b.feePerKg}×${sheetRes.usedKg.toFixed(3)} + item ${b.itemFee} = ${sheetRes.totalCNY.toFixed(2)} CNY`;
    }
    if (pricingMode === 'manual') {
      return `Manual: perKg ${rates.perKgCNY} × ceil(${chargeableKg.toFixed(3)}) = ${Math.ceil(chargeableKg)} kg → ${shippingCNY.toFixed(2)} CNY`;
    }
    return '';
  }, [pricingMode, sheetRes, manualRes, rates.perKgCNY, country, battery, chargeableKg, shippingCNY]);

  const crossProfiles = useMemo(() => {
    const list = getDivisorListFor(units);
    return list.map((d) => ({ label: d.label, value: (calc.volume / Math.max(1, d.divisor)).toFixed(2) + " " + d.vwUnit }));
  }, [calc.volume, units]);

  const volUnit = normalizeUnits(units) === "cm" ? "cm³" : "in³";
  const dimUnit = normalizeUnits(units) === "cm" ? "cm" : "in";
  const weightUnit = (divisorObj && divisorObj.vwUnit) || (normalizeUnits(units) === "cm" ? "kg" : "lb");
  const actualWeightUnit = normalizeUnits(units) === "cm" ? "kg" : "lb";

  function applyPreset(p) { setL(p.L); setW(p.W); setH(p.H); }
  function swapLW() { setL(parsed.W); setW(parsed.L); }
  function swapLH() { setL(parsed.H); setH(parsed.L); }
  function swapWH() { setW(parsed.H); setH(parsed.W); }

  const repaired = divisorNumeric !== Number(divisorObj?.divisor);
  const styleName = (STYLE_OPTIONS.find((s) => s.id === styleId) || STYLE_OPTIONS[0]).name;

  // -----------------------------
  // Save / Load (localStorage)
  // -----------------------------
  const [setupName, setSetupName] = useState("");
  const [saved, setSaved] = useState([]);
  useEffect(() => {
    try { const raw = typeof window !== 'undefined' ? window.localStorage.getItem(SAVED_KEY) : null; if (raw) setSaved(JSON.parse(raw)); } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch (e) { /* ignore */ }
  }, [saved]);

  function buildRow() {
    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      name: setupName.trim() || `Setup ${saved.length + 1}`,
      country, pricingMode,
      units, styleId, L: parsed.L, W: parsed.W, H: parsed.H, boardMM: parsed.boardMM,
      divisorId, battery, actualW: parsed.actualW,
      qty: parsed.qty, priceUSD, productCostUSD, variableFeePct, refundFeePct,
      rates,
      derived: {
        volWeight: calc.volWeight, chargeable: calc.chargeable, chargeableKg,
        shippingCNY, shippingUSD,
        shippingPerUnitUSD, costPerUnitUSD, totalCostUSD,
        breakdown,
      }
    };
  }

  function saveCurrent() { setSaved((arr) => [buildRow(), ...arr]); setSetupName(""); }
  function loadRow(row) {
    setCountry(row.country || 'United States'); setPricingMode(row.pricingMode || 'sheet');
    setUnits(row.units); setStyleId(row.styleId);
    setL(row.L); setW(row.W); setH(row.H); setBoardMM(row.boardMM);
    setDivisorId(row.divisorId); setBattery(row.battery); setActualW(row.actualW);
    setQty(row.qty); setPriceUSD(row.priceUSD || 0); setProductCostUSD(row.productCostUSD || 0);
    setVariableFeePct(row.variableFeePct || 0); setRefundFeePct(row.refundFeePct || 0);
    setRates(row.rates || DEFAULT_RATES);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function deleteRow(id) { setSaved((arr) => arr.filter((r) => r.id !== id)); }
  function renameRow(id, newName) { setSaved((arr) => arr.map((r) => r.id === id ? { ...r, name: newName } : r)); }

  // -----------------------------
  // Downloads (JSON/CSV/Preview)
  // -----------------------------
  function downloadCurrentJSON() {
    const row = buildRow();
    downloadBlob(`${row.name.replace(/\s+/g,'_')}.json`, 'application/json', JSON.stringify(row, null, 2));
  }
  function downloadSavedCSV() {
    if (!saved.length) { alert('No saved setups yet.'); return; }
    const csv = rowsToCSV(saved);
    downloadBlob('box_setups.csv', 'text/csv;charset=utf-8', csv);
  }

  const previewRef = useRef(null);
  function downloadPreview() {
    try {
      const root = previewRef.current;
      if (!root) throw new Error('preview not ready');
      const canvas = root.querySelector('canvas');
      if (canvas && canvas.toDataURL) {
        const dataUrl = canvas.toDataURL('image/png');
        const blob = dataURLToBlob(dataUrl);
        downloadBlob('box-preview.png', 'image/png', blob);
        return;
      }
      const svg = root.querySelector('svg');
      if (svg) {
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML;
        downloadBlob('box-preview.svg', 'image/svg+xml;charset=utf-8', xml);
        return;
      }
      alert('Preview is not available yet.');
    } catch (e) {
      alert('Could not download preview.');
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-white to-slate-50 text-slate-800">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Packaging / Mailer Box Designer</h1>
            <p className="text-sm text-slate-500">Dimensional (volumetric) weight calculator + live 3D/SVG preview.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Units:</span>
            <div className="inline-flex overflow-hidden rounded-xl border border-slate-200">
              <button className={`px-3 py-1.5 text-sm ${normalizeUnits(units) === "cm" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => setUnits("cm")}>
                cm
              </button>
              <button className={`px-3 py-1.5 text-sm ${normalizeUnits(units) === "in" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => setUnits("in")}>
                in
              </button>
            </div>
            <div className="mx-2 hidden h-6 w-px bg-slate-200 sm:block" />
            <button onClick={downloadCurrentJSON} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">Download setup (JSON)</button>
            <button onClick={downloadSavedCSV} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">Download saved (CSV)</button>
            <button onClick={downloadPreview} className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs text-white hover:opacity-90">Download preview</button>
          </div>
        </header>

        {repaired && (
          <ErrorBanner message={`Your divisor selection didn't match the current unit system. I auto-corrected it to a valid profile.`} />
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left column: controls */}
          <section className="lg:col-span-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-medium">Box Setup</h2>

              {/* Style */}
              <label className="mb-2 block text-sm font-medium">Box style</label>
              <select className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                {STYLE_OPTIONS.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
              </select>

              {/* Battery classification */}
              <label className="mb-2 block text-sm font-medium">Battery classification</label>
              <div className="mb-4 inline-flex overflow-hidden rounded-xl border border-slate-200" role="group" aria-label="Battery classification">
                <button type="button" aria-pressed={!battery} className={`px-3 py-1.5 text-sm ${!battery ? 'bg-slate-900 text-white' : 'bg-white'}`} onClick={() => setBattery(false)}>No Battery</button>
                <button type="button" aria-pressed={battery} className={`px-3 py-1.5 text-sm ${battery ? 'bg-slate-900 text-white' : 'bg-white'}`} onClick={() => setBattery(true)}>Built-in Battery</button>
              </div>

              {/* Country & Pricing mode */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs text-slate-500">Country</div>
                  <select value={country} onChange={(e)=>setCountry(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option>United States</option>
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-500">Pricing mode</div>
                  <select value={pricingMode} onChange={(e)=>setPricingMode(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="sheet">Sheet (US)</option>
                    <option value="manual">Manual per-kg</option>
                  </select>
                </div>
              </div>

              {/* Presets */}
              <div className="mt-4">
                <div className="mb-1 text-xs text-slate-500">Quick presets</div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS_CM.map(p => (
                    <button key={p.name} onClick={() => applyPreset(p)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimensions */}
              <div className="mt-4 mb-2 flex items-end justify-between">
                <label className="text-sm font-medium">Outer dimensions</label>
                <div className="flex gap-2 text-xs">
                  <button onClick={swapLW} className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50">Swap L↔W</button>
                  <button onClick={swapLH} className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50">Swap L↔H</button>
                  <button onClick={swapWH} className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50">Swap W↔H</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><div className="mb-1 text-xs text-slate-500">Length ({dimUnit})</div><input type="number" value={L} onChange={(e) => setL(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" step="0.1" min={0} /></div>
                <div><div className="mb-1 text-xs text-slate-500">Width ({dimUnit})</div><input type="number" value={W} onChange={(e) => setW(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" step="0.1" min={0} /></div>
                <div><div className="mb-1 text-xs text-slate-500">Height ({dimUnit})</div><input type="number" value={H} onChange={(e) => setH(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" step="0.1" min={0} /></div>
              </div>

              {/* Board thickness & actual weight */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div><div className="mb-1 text-xs text-slate-500">Board thickness (mm)</div><input type="number" value={boardMM} onChange={(e) => setBoardMM(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" step="0.1" min={0} /></div>
                <div><div className="mb-1 text-xs text-slate-500">Actual scale weight ({actualWeightUnit})</div><input type="number" value={actualW} onChange={(e) => setActualW(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" step="0.01" min={0} /></div>
              </div>

              {/* Divisor */}
              <label className="mt-4 mb-2 block text-sm font-medium">Dimensional weight divisor</label>
              <select className="mb-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" value={divisorId} onChange={(e) => setDivisorId(e.target.value)}>
                {divisorList.map((d) => (<option key={d.id} value={d.id}>{d.label}</option>))}
              </select>

              {/* Commercial inputs */}
              <h3 className="mt-6 mb-2 text-sm font-medium">Commercial inputs</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="mb-1 text-xs text-slate-500">Quantity (units in this shipment)</div><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" min={1} step={1} /></div>
                <div><div className="mb-1 text-xs text-slate-500">Selling price per unit (USD)</div><input type="number" value={priceUSD} onChange={(e) => setPriceUSD(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" min={0} step="0.01" /></div>
                <div><div className="mb-1 text-xs text-slate-500">Product cost per unit (USD)</div><input type="number" value={productCostUSD} onChange={(e) => setProductCostUSD(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" min={0} step="0.01" /></div>
                <div><div className="mb-1 text-xs text-slate-500">Variable fee (% of price)</div><input type="number" value={variableFeePct} onChange={(e) => setVariableFeePct(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" min={0} step="0.01" /></div>
                <div><div className="mb-1 text-xs text-slate-500">Refund fee (% of price)</div><input type="number" value={refundFeePct} onChange={(e) => setRefundFeePct(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" min={0} step="0.01" /></div>
              </div>

              {/* Rates – Manual (only when pricingMode==='manual') */}
              {pricingMode === 'manual' && (
                <div>
                  <h3 className="mt-6 mb-2 text-sm font-medium">Manual rates (CNY)</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="mb-1 text-xs text-slate-500">Per started kg (CNY)</div><input type="number" value={rates.perKgCNY} onChange={(e) => setRates({ ...rates, perKgCNY: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></div>
                    <div><div className="mb-1 text-xs text-slate-500">Minimum charge (CNY)</div><input type="number" value={rates.minChargeCNY} onChange={(e) => setRates({ ...rates, minChargeCNY: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" /></div>
                    <div><div className="mb-1 text-xs text-slate-500">FX: CNY per USD</div><input type="number" value={rates.cnyPerUSD} onChange={(e) => setRates({ ...rates, cnyPerUSD: Number(e.target.value) })} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" step="0.01" /></div>
                  </div>
                </div>
              )}
            </div>

            {/* Calculations card */}
            <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-medium">Calculated</h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><div className="text-slate-500">Outer volume</div><div className="text-base font-semibold">{(calc.volume).toFixed(0)} {volUnit}</div></div>
                <div><div className="text-slate-500">Inner volume (board-adjusted)</div><div className="text-base font-semibold">{(calc.innerVolume).toFixed(0)} {volUnit}</div></div>
                <div><div className="text-slate-500">Volumetric weight</div><div className="text-base font-semibold">{calc.volWeight.toFixed(2)} {weightUnit}</div></div>
                <div><div className="text-slate-500">Chargeable weight</div><div className="text-base font-semibold">{calc.chargeable.toFixed(2)} {weightUnit} ({chargeableKg.toFixed(2)} kg)</div></div>
                <div><div className="text-slate-500">Surface area (outer)</div><div className="text-base font-semibold">{calc.surfaceArea.toFixed(0)} {normalizeUnits(units) === "cm" ? "cm²" : "in²"}</div></div>
                <div><div className="text-slate-500">Inner dims</div><div className="text-base font-semibold">{calc.inner.L.toFixed(1)} × {calc.inner.W.toFixed(1)} × {calc.inner.H.toFixed(1)} {dimUnit}</div></div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-slate-500">Shipping (YunExpress)</div>
                    <div className="text-base font-semibold">{shippingCNY.toFixed(2)} CNY · ${shippingUSD.toFixed(2)} USD</div>
                  </div>
                  <div className="text-xs text-slate-600">{pricingMode === 'sheet' ? 'Sheet pricing' : 'Manual'} · {country} · Battery: <span className="font-medium">{battery ? 'Built-in' : 'No'}</span> · FX: {rates.cnyPerUSD} CNY/USD</div>
                </div>
                {breakdown && <div className="text-xs text-slate-600">{breakdown}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="text-slate-500">Variable fee per unit</div><div className="font-semibold">${variableFeeUSD.toFixed(2)} ({variableFeePct||0}%)</div></div>
                  <div><div className="text-slate-500">Refund fee per unit</div><div className="font-semibold">${refundFeeUSD.toFixed(2)} ({refundFeePct||0}%)</div></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="text-slate-500">Shipping per unit (USD)</div><div className="font-semibold">${shippingPerUnitUSD.toFixed(2)}</div></div>
                  <div><div className="text-slate-500">Cost per unit (USD)</div><div className="font-semibold">${costPerUnitUSD.toFixed(2)}</div></div>
                </div>
                <div><div className="text-slate-500">Total cost for quantity (USD)</div><div className="text-base font-semibold">${totalCostUSD.toFixed(2)} <span className="text-xs text-slate-400">({parsed.qty} units)</span></div></div>

                <div className="mt-2">
                  <div className="mb-1 font-medium">Cross-carrier check</div>
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 text-xs">
                    {crossProfiles.map((row) => (
                      <li key={row.label} className="flex justify-between gap-2">
                        <span className="text-slate-600">{row.label}</span>
                        <span className="font-semibold">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Notes: Sheet pricing uses fee-per-kg × billed weight (rounded up to 0.001 kg, min 0.03 kg) + item fee per parcel.
                Confirm surcharges or lane-specific adjustments with your account manager if needed.
              </p>
            </div>
          </section>

          {/* Right column: 3D/SVG preview + summary */}
          <section className="lg:col-span-3">
            <div className="grid grid-rows-[1fr_auto] gap-4">
              <div ref={previewRef} className="h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="flex items-center justify-between px-3 pt-2">
                  <div>
                    <div className="text-sm font-medium">{canUseR3F && r3fLibs ? '3D Preview' : 'Isometric Preview (SVG)'} </div>
                    <div className="text-xs text-slate-500">True proportions · orbit+zoom (WebGL) or static SVG</div>
                  </div>
                  <div className="text-xs text-slate-500">Style: <span className="font-medium">{styleName}</span></div>
                </div>
                <div className="h-[460px]">
                  {canUseR3F && r3fLibs ? (
                    <RenderBoundary fallback={() => (
                      <IsoBoxSVG L={parsed.L} W={parsed.W} H={parsed.H} styleId={styleId} />
                    )}>
                      <R3FBox L={parsed.L} W={parsed.W} H={parsed.H} styleId={styleId} libs={r3fLibs} />
                    </RenderBoundary>
                  ) : (
                    <IsoBoxSVG L={parsed.L} W={parsed.W} H={parsed.H} styleId={styleId} />
                  )}
                </div>
              </div>

              {/* Saved Setups */}
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm text-slate-600">Name this setup</label>
                    <input value={setupName} onChange={(e)=>setSetupName(e.target.value)} placeholder="e.g., Olive Vine – Small – No Battery" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                  </div>
                  <button onClick={saveCurrent} className="h-10 rounded-xl bg-slate-900 px-4 text-sm text-white hover:opacity-90">Save current setup</button>
                </div>
                {saved.length === 0 ? (
                  <div className="text-sm text-slate-500">No saved setups yet.</div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {saved.map((row) => (
                      <li key={row.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1">
                          <input
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                            value={row.name}
                            onChange={(e)=>renameRow(row.id, e.target.value)}
                          />
                          <div className="mt-1 text-xs text-slate-500">
                            {row.units}, {row.styleId} · {row.L}×{row.W}×{row.H} · {row.battery ? 'Battery' : 'No Battery'} · {row.pricingMode}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={()=>loadRow(row)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">Load</button>
                          <button onClick={()=>deleteRow(row.id)} className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
