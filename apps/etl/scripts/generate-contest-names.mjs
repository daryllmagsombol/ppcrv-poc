import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', '..', '..', 'sample-csv', 'contest.csv');
const outputPath = join(__dirname, '..', '..', '..', 'data', 'contest-names.json');

function parseCSVLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.trim().split('\n');
const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));

const codeIdx = headers.indexOf('CONTEST_CODE');
const nameIdx = headers.indexOf('CONTEST_NAME');

const map = {};
for (let i = 1; i < lines.length; i++) {
  const cols = parseCSVLine(lines[i]).map(s => s.replace(/^"|"$/g, ''));
  const code = cols[codeIdx]?.trim();
  const name = cols[nameIdx]?.trim();
  if (code && name) {
    map[code] = name;
  }
}

writeFileSync(outputPath, JSON.stringify(map, null, 2));
console.log(`Wrote ${Object.keys(map).length} contest names to ${outputPath}`);
