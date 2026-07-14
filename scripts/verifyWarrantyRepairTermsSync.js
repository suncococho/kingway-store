const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sharedPath = path.join(rootDir, 'shared', 'warrantyRepairAdditionalTerms.json');
const frontendPath = path.join(rootDir, 'frontend', 'src', 'content', 'warrantyRepairAdditionalTerms.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const sharedTerms = readJson(sharedPath);
const frontendTerms = readJson(frontendPath);

if (JSON.stringify(sharedTerms) !== JSON.stringify(frontendTerms)) {
  console.error('Warranty repair terms are out of sync.');
  console.error(`Shared: ${sharedPath}`);
  console.error(`Frontend: ${frontendPath}`);
  process.exit(1);
}

console.log(`Warranty repair terms synced: ${sharedTerms.version} / ${sharedTerms.title}`);
