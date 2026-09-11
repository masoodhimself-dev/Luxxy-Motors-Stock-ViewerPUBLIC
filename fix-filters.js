const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/filters.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/ \['noWriteOff', 'NO RECORDED WRITE-OFF'\],/g, " ['noWriteOff', 'No recorded write-off'],");
content = content.replace(/ \['catS', 'CATEGORY S'\],/g, " ['catS', 'Category S'],");
content = content.replace(/ \['catN', 'CATEGORY N'\],/g, " ['catN', 'Category N'],");

fs.writeFileSync(path, content, 'utf8');
