// แผ่น PCB (mesh 0 ของ STEP) → สามเหลี่ยมหน้าบนในกรอบ IPC (mm): ipcX = stepY, ipcY = 68.58 − stepX
const fs = require('fs'); const occt = require('occt-import-js');
(async () => { const o = await occt(); const r = o.ReadStepFile(new Uint8Array(fs.readFileSync(process.argv[2])), { linearDeflection: 0.02, angularDeflection: 0.15 });
  const m = r.meshes[0]; const p = m.attributes.position.array, idx = m.index.array;
  let X0 = 1e9, Y0 = 1e9, Z1 = -1e9; for (let k = 0; k < p.length; k += 3) { X0 = Math.min(X0, p[k]); Y0 = Math.min(Y0, p[k + 1]); Z1 = Math.max(Z1, p[k + 2]); }
  const tri = []; for (let t = 0; t < idx.length; t += 3) { const v = [0, 1, 2].map((j) => [p[idx[t + j] * 3] - X0, p[idx[t + j] * 3 + 1] - Y0, p[idx[t + j] * 3 + 2] - Z1]); if (v.every((q) => Math.abs(q[2]) < 1e-3)) tri.push(v.map(([x, y]) => [+(y).toFixed(4), +(68.58 - x).toFixed(4)])); }
  // ขอบ (เส้นที่อยู่ในสามเหลี่ยมเดียว) = เส้นรอบนอก + รูยึด
  const ek = new Map(); const key = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? a.join() + '|' + b.join() : b.join() + '|' + a.join());
  for (const t of tri) for (let j = 0; j < 3; j++) { const k = key(t[j], t[(j + 1) % 3]); ek.set(k, (ek.get(k) ?? 0) + 1); }
  const edges = [...ek].filter(([, c]) => c === 1).map(([k]) => k.split('|').map((s) => s.split(',').map(Number)));
  fs.writeFileSync(process.argv[3], JSON.stringify({ tri, edges, meshes: r.meshes.length }));
  console.log('top tris', tri.length, 'boundary edges', edges.length);
})();
