const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/layout-colour.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/.toBe\('188 50% 10%'\)/g, ".toBe('0 0% 8%')");
content = content.replace(/.toBe\('42 33% 96%'\)/g, ".toBe('0 0% 100%')");

fs.writeFileSync(path, content, 'utf8');
