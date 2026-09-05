const fs = require('fs');

function readConfig(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return parseConfig(raw);
}

function parseConfig(raw) {
  return JSON.parse(raw);
}

function processRecords(records, config) {
  return records.map((r) => ({ ...r, source: config.source }));
}

function buildIndex(records) {
  const index = {};
  for (const r of records) index[r.id] = r;
  return index;
}

module.exports = { readConfig, processRecords, buildIndex };
