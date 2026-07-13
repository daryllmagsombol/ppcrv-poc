import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', 'sample-csv', 'contest.csv');
const outputPath = join(__dirname, '..', 'data', 'contest-names.json');

const csv = readFileSync(csvPath, 'utf-8');
const lines = csv.trim().split('\n');
const headers = lines[0].replace(/"/g, '').split(',');

const codeIdx = headers.indexOf('CONTEST_CODE');
const nameIdx = headers.indexOf('CONTEST_NAME');

const map = {};
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',').map(s => s.replace(/^"|"$/g, ''));
  const code = cols[codeIdx]?.trim();
  const name = cols[nameIdx]?.trim();
  if (code && name) {
    map[code] = name;
  }
}

writeFileSync(outputPath, JSON.stringify(map, null, 2));
console.log(`Wrote ${Object.keys(map).length} contest names to ${outputPath}`);
