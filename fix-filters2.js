const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/filters.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /onChange=\{\(minPrice\) => setFilters\(\(current\) => \(\{ \.\.\.current, minPrice: minPrice \? Number\(minPrice\) : undefined \}\)\)\}/g,
  'onChange={(minPrice) => setFilters((current) => ({ ...current, minPrice }))}'
);
content = content.replace(
  /onChange=\{\(maxPrice\) => setFilters\(\(current\) => \(\{ \.\.\.current, maxPrice: maxPrice \? Number\(maxPrice\) : undefined \}\)\)\}/g,
  'onChange={(maxPrice) => setFilters((current) => ({ ...current, maxPrice }))}'
);

fs.writeFileSync(path, content, 'utf8');
