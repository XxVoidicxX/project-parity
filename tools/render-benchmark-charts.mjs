import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const results = JSON.parse(readFileSync(join(root, 'benchmarks/results.json'), 'utf8'));
const chartDir = join(root, 'benchmarks', 'charts'); mkdirSync(chartDir, { recursive: true });
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function chart(name, title, yLabel, series) {
  const width = 960, height = 510, left = 100, bottom = 80, top = 60, right = 35;
  const items = series.flatMap(s => s.values); const max = Math.max(...items.map(x => x.value), 1); const groups = [...new Set(items.map(x => x.label))];
  const colors = ['#2563eb','#dc2626','#059669','#7c3aed','#d97706','#0891b2'];
  const x = index => left + ((width-left-right) * (index + .5) / groups.length); const y = value => height-bottom - ((height-top-bottom) * value / max);
  let body = `<rect width="100%" height="100%" fill="white"/><text x="${width/2}" y="30" text-anchor="middle" font-size="20" font-family="Arial" font-weight="bold">${esc(title)}</text><text x="20" y="${height/2}" transform="rotate(-90 20 ${height/2})" text-anchor="middle" font-size="13" font-family="Arial">${esc(yLabel)}</text><line x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}" stroke="#333"/><line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" stroke="#333"/>`;
  for (let tick=0; tick<=4; tick++) { const value=max*tick/4, yy=y(value); body += `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="#ddd"/><text x="${left-8}" y="${yy+4}" text-anchor="end" font-size="11" font-family="Arial">${value.toFixed(value < 10 ? 2 : 0)}</text>`; }
  series.forEach((seriesItem, seriesIndex) => seriesItem.values.forEach((item, index) => { const offset = (seriesIndex-(series.length-1)/2)*14; const xx=x(index)+offset, yy=y(item.value); body += `<circle cx="${xx}" cy="${yy}" r="5" fill="${colors[seriesIndex]}"/><text x="${xx}" y="${yy-9}" text-anchor="middle" font-size="10" font-family="Arial">${item.value.toFixed(item.value < 10 ? 2 : 0)}</text>`; }));
  groups.forEach((group,index) => body += `<text x="${x(index)}" y="${height-bottom+22}" text-anchor="middle" font-size="12" font-family="Arial">${esc(group)}</text>`);
  series.forEach((s,index) => body += `<rect x="${left+index*180}" y="${height-28}" width="12" height="12" fill="${colors[index]}"/><text x="${left+18+index*180}" y="${height-18}" font-size="12" font-family="Arial">${esc(s.name)}</text>`);
  writeFileSync(join(chartDir, name), `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`, 'utf8');
}
const metric = (field, subfield) => results.measurements.map(m => ({ name: m.language, values: m.sizes.map(s => ({ label: `${s.size}`, value: subfield ? s[field][subfield] : s[field] })) }));
chart('latency-percentiles.svg', 'Reconcile latency percentiles', 'milliseconds', ['p50','p90','p99'].flatMap(p => results.measurements.map(m => ({ name: `${m.language} ${p}`, values: m.sizes.map(s => ({ label: `${s.size}`, value: s.reconcileLatencyMs[p] })) }))));
chart('throughput-by-size.svg', 'Record and burst reconcile throughput', 'entries per second', [...metric('recordEntriesPerSecond'), ...metric('reconcileBurstEntriesPerSecond').map(s => ({ ...s, name: `${s.name} burst` }))]);
chart('ledger-memory.svg', 'Ledger heap growth after recording', 'bytes', metric('ledger', 'heapGrowthBytes'));
console.log('Wrote benchmarks/charts/*.svg');
