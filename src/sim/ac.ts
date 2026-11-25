import type { Netlist, NetlistElement } from './netlist';
import { GMIN, diodeSmallSignal, evalBJT, evalMOS, evalOpamp, solveDC, type SimResult } from './solver';

/**
 * การวิเคราะห์สัญญาณเล็กตามความถี่ (AC sweep)
 * 1) หาจุดทำงาน DC ของวงจร (เครื่องกำเนิดสัญญาณให้เฉพาะ DC offset, ตัวเก็บประจุเปิด, ตัวเหนี่ยวนำเป็น DCR)
 * 2) ทำให้อุปกรณ์ไม่เชิงเส้นเป็นเชิงเส้นรอบจุดนั้น (อนุพันธ์จากสมการเดียวกับ solver DC/ตามเวลา)
 * 3) แก้สมการโหนดแบบจำนวนเชิงซ้อน Y(jω)·V = I ที่แต่ละความถี่
 * แหล่งกระตุ้น: เครื่องกำเนิดสัญญาณตัวแรก ให้แรงดัน 1 V (ไม่มีโหลด) ผ่าน Rout — ผลจึงเป็น "อัตราส่วน" ไม่ขึ้นกับ Vpp ที่ตั้ง
 * แหล่งจ่าย DC ในโหมด CV = ลัดวงจรทาง AC ผ่าน Rint, ในโหมด CC = เปิดวงจร
 */

export interface Complex { re: number; im: number }

export interface AcProbe { key: string; a: number | undefined; b: number | undefined }

export interface AcRequest {
  netlist: Netlist;
  /** id ของเครื่องกำเนิดสัญญาณที่ใช้กระตุ้น — ไม่ระบุ = ตัวแรก */
  sourceId?: string;
  freqs: number[];
  probes: AcProbe[];
}

export interface AcResult {
  ok: boolean;
  error?: string;
  freqs: number[];
  /** แรงดันเชิงซ้อนของแต่ละ probe ที่แต่ละความถี่ (null = ลอย/คนละส่วนวงจร) */
  values: Record<string, Array<Complex | null>>;
  /** จุดทำงาน DC ที่ใช้ทำให้เป็นเชิงเส้น */
  op?: SimResult;
  /** ข้อสังเกต เช่น ออปแอมป์อิ่มตัวที่จุดทำงาน */
  notes: string[];
  ms: number;
}

/** ความถี่แบบลอการิทึม: pointsPerDecade จุดต่อทศวรรษ (รวมปลายทั้งสอง) */
export function logSweep(fStart: number, fStop: number, pointsPerDecade: number): number[] {
  const a = Math.log10(fStart), b = Math.log10(fStop);
  const n = Math.max(2, Math.round((b - a) * pointsPerDecade) + 1);
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
}

export const cabs = (z: Complex) => Math.hypot(z.re, z.im);
export const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const db = (z: Complex) => 20 * Math.log10(Math.max(cabs(z), 1e-300));
export const phaseDeg = (z: Complex) => (Math.atan2(z.im, z.re) * 180) / Math.PI;

function terminals(e: NetlistElement): number[] {
  if (e.type === 'R' || e.type === 'C' || e.type === 'L') return [e.a, e.b];
  if (e.type === 'LED' || e.type === 'D') return [e.a, e.k];
  if (e.type === 'BJT') return [e.c, e.b, e.e];
  if (e.type === 'MOS') return [e.d, e.g, e.s];
  if (e.type === 'OPAMP') return [e.inp, e.inn, e.out, e.vp, e.vn];
  return [e.p, e.n];
}

/**
 * แก้ระบบเชิงซ้อน (re + j·im) x = b ด้วยการกำจัดแบบเกาส์ + partial pivoting
 * ปรับสเกลแถว/คอลัมน์ด้วยรากของขนาดเส้นทแยงก่อน (เหมือน solver DC) เพื่อรองรับค่าที่ต่างกันมาก
 */
export function solveComplex(Are: Float64Array, Aim: Float64Array, bre: Float64Array, bim: Float64Array, n: number): { re: Float64Array; im: Float64Array } | null {
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(Are[i * n + i], Aim[i * n + i]);
    s[i] = d > 0 && isFinite(d) ? 1 / Math.sqrt(d) : 1;
  }
  const mr = new Float64Array(n * n), mi = new Float64Array(n * n);
  const xr = new Float64Array(n), xi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { const k = s[i] * s[j]; mr[i * n + j] = Are[i * n + j] * k; mi[i * n + j] = Aim[i * n + j] * k; }
    xr[i] = bre[i] * s[i]; xi[i] = bim[i] * s[i];
  }
  for (let c = 0; c < n; c++) {
    let p = c, best = 0;
    for (let r = c; r < n; r++) { const m = Math.hypot(mr[r * n + c], mi[r * n + c]); if (m > best) { best = m; p = r; } }
    if (!(best > 1e-300)) return null;
    if (p !== c) {
      for (let j = 0; j < n; j++) {
        let t = mr[c * n + j]; mr[c * n + j] = mr[p * n + j]; mr[p * n + j] = t;
        t = mi[c * n + j]; mi[c * n + j] = mi[p * n + j]; mi[p * n + j] = t;
      }
      let t = xr[c]; xr[c] = xr[p]; xr[p] = t;
      t = xi[c]; xi[c] = xi[p]; xi[p] = t;
    }
    const pr = mr[c * n + c], pi = mi[c * n + c], pd = pr * pr + pi * pi;
    for (let r = c + 1; r < n; r++) {
      const ar = mr[r * n + c], ai = mi[r * n + c];
      if (ar === 0 && ai === 0) continue;
      // f = a / pivot
      const fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;
      for (let j = c; j < n; j++) {
        const br = mr[c * n + j], bi = mi[c * n + j];
        mr[r * n + j] -= fr * br - fi * bi;
        mi[r * n + j] -= fr * bi + fi * br;
      }
      xr[r] -= fr * xr[c] - fi * xi[c];
      xi[r] -= fr * xi[c] + fi * xr[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sr = xr[r], si = xi[r];
    for (let j = r + 1; j < n; j++) {
      const ar = mr[r * n + j], ai = mi[r * n + j];
      sr -= ar * xr[j] - ai * xi[j];
      si -= ar * xi[j] + ai * xr[j];
    }
    const pr = mr[r * n + r], pi = mi[r * n + r], pd = pr * pr + pi * pi;
    xr[r] = (sr * pr + si * pi) / pd;
    xi[r] = (si * pr - sr * pi) / pd;
  }
  for (let i = 0; i < n; i++) { xr[i] *= s[i]; xi[i] *= s[i]; }
  return { re: xr, im: xi };
}

export function solveAC(req: AcRequest): AcResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { netlist: nl, freqs } = req;
  const fail = (error: string, op?: SimResult): AcResult => ({ ok: false, error, freqs, values: {}, op, notes: [], ms: 0 });
  const src = nl.elements.find((e): e is Extract<NetlistElement, { type: 'FGEN' }> => e.type === 'FGEN' && (req.sourceId === undefined || e.id === req.sourceId));
  if (!src) return fail('ไม่มีเครื่องกำเนิดสัญญาณที่เปิดเอาต์พุต — AC sweep ใช้เครื่องกำเนิดสัญญาณเป็นแหล่งกระตุ้น');
  if (src.p === src.n) return fail('ขั้ว OUT และ COM ของเครื่องกำเนิดสัญญาณต่อถึงกัน');

  // 1) จุดทำงาน DC: เครื่องกำเนิดสัญญาณให้เฉพาะ offset
  const dcNet: Netlist = { ...nl, elements: nl.elements.map((e) => (e.type === 'FGEN' ? { ...e, wave: 'dc' as const } : e)) };
  const op = solveDC(dcNet);
  if (!op.ok) return fail(`หาจุดทำงาน DC ไม่ได้: ${op.error?.message ?? ''}${op.error?.detail ? ' — ' + op.error.detail : ''}`, op);
  const Vop = (net: number) => (op.nodeVoltage[net] ?? 0) as number;

  // 2) โครงสร้างตัวแปร: ทุกเน็ตที่ใช้ เลือกโหนดอ้างอิงหนึ่งโหนดต่อหนึ่งส่วน (ตัวเก็บประจุนับเป็นการเชื่อม)
  const parent = new Int32Array(nl.nodeCount).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const used = new Uint8Array(nl.nodeCount), degree = new Int32Array(nl.nodeCount);
  for (const e of nl.elements) {
    const t = terminals(e);
    for (const v of t) { used[v] = 1; degree[v]++; }
    for (let k = 1; k < t.length; k++) { const a = find(t[0]), b = find(t[k]); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
  }
  const ref = new Map<number, number>();
  for (let i = 0; i < nl.nodeCount; i++) {
    if (!used[i]) continue;
    const r = find(i), cur = ref.get(r);
    // อ้างอิงที่ COM ของแหล่งกระตุ้นถ้าอยู่ในส่วนเดียวกัน ไม่เช่นนั้นโหนดที่มีขามากที่สุด
    if (cur === undefined || (cur !== src.n && (i === src.n || degree[i] > degree[cur]))) ref.set(r, i);
  }
  const varOf = new Int32Array(nl.nodeCount).fill(-1);
  let N = 0;
  for (let i = 0; i < nl.nodeCount; i++) if (used[i] && ref.get(find(i)) !== i) varOf[i] = N++;
  const values: Record<string, Array<Complex | null>> = Object.fromEntries(req.probes.map((p) => [p.key, []]));
  const notes: string[] = [];

  // 3) ส่วนจริงของ Y (ไม่ขึ้นกับความถี่) + รายการ C/L
  const G = new Float64Array(N * N);
  const addG = (a: number, b: number, g: number) => {
    const ia = varOf[a], ib = varOf[b];
    if (ia >= 0) G[ia * N + ia] += g;
    if (ib >= 0) G[ib * N + ib] += g;
    if (ia >= 0 && ib >= 0) { G[ia * N + ib] -= g; G[ib * N + ia] -= g; }
  };
  const stampJ = (nodes: number[], J: number[][]) => {
    nodes.forEach((ni, k) => {
      const r = varOf[ni];
      if (r < 0) return;
      nodes.forEach((nj, j) => { const c = varOf[nj]; if (c >= 0) G[r * N + c] += J[k][j]; });
    });
  };
  const caps: Array<{ a: number; b: number; C: number }> = [];
  const poles: Array<{ r: number; c: number; v: number; tau: number }> = [];
  const inds: Array<{ a: number; b: number; L: number; R: number }> = [];
  for (const e of nl.elements) {
    switch (e.type) {
      case 'R': addG(e.a, e.b, 1 / e.R); break;
      case 'C': caps.push(e); break;
      case 'L': inds.push(e); break;
      case 'SUPPLY': if (op.elements[e.id]?.mode !== 'CC') addG(e.p, e.n, 1 / e.Rint); break;
      case 'FGEN': addG(e.p, e.n, 1 / e.Rout); break;
      case 'LED': case 'D': {
        const er = op.elements[e.id];
        const g = diodeSmallSignal(e, er ? er.voltage : 0, er ? er.current : 0);
        addG(e.a, e.k, g);
        break;
      }
      case 'BJT': {
        const r = evalBJT(e, Vop(e.c), Vop(e.b), Vop(e.e));
        stampJ([e.c, e.b, e.e], r.J);
        break;
      }
      case 'MOS': {
        const r = evalMOS(e, Vop(e.d), Vop(e.g), Vop(e.s));
        stampJ([e.d, e.g, e.s], r.J);
        break;
      }
      case 'OPAMP': {
        const nodes = [e.inp, e.inn, e.out, e.vp, e.vn];
        const r = evalOpamp(e, nodes.map(Vop));
        // พจน์ที่ขาออกขึ้นกับ Vd (แถว OUT/V+/V− คอลัมน์ IN+/IN−) มีขั้วเดียว A(jω) = A/(1 + jωτ), τ = A/(2π·GBW)
        // จึงแยกไปประทับตามความถี่ ส่วนที่เหลือ (Rout, ไฟเลี้ยง, Rin) ไม่ขึ้นกับความถี่
        const tau = e.gbw > 0 ? e.A / (2 * Math.PI * e.gbw) : 0;
        const J = r.J.map((row) => row.slice());
        for (const k of [2, 3, 4]) for (const j of [0, 1]) {
          if (tau > 0 && J[k][j] !== 0 && varOf[nodes[k]] >= 0 && varOf[nodes[j]] >= 0) poles.push({ r: varOf[nodes[k]], c: varOf[nodes[j]], v: J[k][j], tau });
          if (tau > 0) J[k][j] = 0;
        }
        stampJ(nodes, J);
        if (r.saturated && Vop(e.vp) - Vop(e.vn) > 2 * e.headroom + 0.5) notes.push(`${e.id}: ขาออกอิ่มตัวที่จุดทำงาน DC อัตราขยายสัญญาณเล็กจึงต่ำมาก — ตรวจ offset และการป้อนกลับ`);
        break;
      }
    }
  }
  for (let i = 0; i < N; i++) G[i * N + i] += GMIN;

  // 4) กระแสกระตุ้น (Norton): 1 V / Rout จาก COM เข้า OUT
  const bre = new Float64Array(N), bim = new Float64Array(N);
  const iS = 1 / src.Rout;
  if (varOf[src.p] >= 0) bre[varOf[src.p]] += iS;
  if (varOf[src.n] >= 0) bre[varOf[src.n]] -= iS;

  const Are = new Float64Array(N * N), Aim = new Float64Array(N * N);
  for (const f of freqs) {
    const w = 2 * Math.PI * f;
    Are.set(G); Aim.fill(0);
    const addY = (a: number, b: number, yr: number, yi: number) => {
      const ia = varOf[a], ib = varOf[b];
      if (ia >= 0) { Are[ia * N + ia] += yr; Aim[ia * N + ia] += yi; }
      if (ib >= 0) { Are[ib * N + ib] += yr; Aim[ib * N + ib] += yi; }
      if (ia >= 0 && ib >= 0) { Are[ia * N + ib] -= yr; Aim[ia * N + ib] -= yi; Are[ib * N + ia] -= yr; Aim[ib * N + ia] -= yi; }
    };
    for (const c of caps) addY(c.a, c.b, 0, w * c.C);
    for (const p of poles) { const wt = w * p.tau, d = 1 + wt * wt; Are[p.r * N + p.c] += p.v / d; Aim[p.r * N + p.c] -= (p.v * wt) / d; }
    for (const l of inds) {
      // 1/(R + jωL)
      const d = l.R * l.R + w * w * l.L * l.L;
      if (d > 0) addY(l.a, l.b, l.R / d, (-w * l.L) / d);
      else addY(l.a, l.b, 1e3, 0);
    }
    const x = N ? solveComplex(Are, Aim, bre, bim, N) : { re: new Float64Array(0), im: new Float64Array(0) };
    if (!x) return fail('เมทริกซ์ singular ในการวิเคราะห์ AC', op);
    const V = (net: number): Complex => (varOf[net] >= 0 ? { re: x.re[varOf[net]], im: x.im[varOf[net]] } : { re: 0, im: 0 });
    for (const p of req.probes) {
      const ok = p.a !== undefined && p.b !== undefined && used[p.a] && used[p.b] && find(p.a) === find(p.b);
      if (!ok) { values[p.key].push(null); continue; }
      const va = V(p.a!), vb = V(p.b!);
      values[p.key].push({ re: va.re - vb.re, im: va.im - vb.im });
    }
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  delete op.x;
  return { ok: true, freqs, values, op, notes, ms };
}
