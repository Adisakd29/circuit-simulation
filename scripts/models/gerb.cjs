// แปลงชั้น Gerber ทีละชั้นเป็น SVG (gerber-to-svg) เพื่อดูเนื้อหา
const fs = require('fs'), path = require('path'), g2s = require('gerber-to-svg');
const dir = process.argv[2], out = process.argv[3]; fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /\.(art)$/.test(f));
let n = files.length;
for (const f of files) {
  const conv = g2s(fs.createReadStream(path.join(dir, f)), { id: f.replace(/\W/g, '_'), attributes: { color: '#000' } }, (err, svg) => {
    if (err) console.log(f, 'ERR', err.message); else { fs.writeFileSync(path.join(out, f + '.svg'), svg); console.log(f, 'viewBox', conv.viewBox.join(' '), 'units', conv.units, svg.length); }
    if (--n === 0) process.exit(0);
  });
}
