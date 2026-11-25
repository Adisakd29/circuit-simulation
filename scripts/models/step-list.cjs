const fs = require('fs'); const occt = require('occt-import-js');
(async () => { const o = await occt(); const r = o.ReadStepFile(new Uint8Array(fs.readFileSync(process.argv[2])), null);
 const pcb = r.meshes[0]; const X0=-465.11, Y0=84.30;
 r.meshes.forEach((m,i)=>{ const p=m.attributes.position.array; const b=[1e9,1e9,1e9,-1e9,-1e9,-1e9]; for(let k=0;k<p.length;k+=3)for(let a=0;a<3;a++){b[a]=Math.min(b[a],p[k+a]);b[a+3]=Math.max(b[a+3],p[k+a]);}
  if (i>=10 && i<=113 && (b[3]-b[0])<1.8) return; // led matrix
  console.log(i, 'x', (b[0]-X0).toFixed(2), (b[3]-X0).toFixed(2), 'y', (b[1]-Y0).toFixed(2), (b[4]-Y0).toFixed(2), 'z', (b[2]-16.93).toFixed(2), (b[5]-16.93).toFixed(2), 'tris', m.index.array.length/3); });
})();
