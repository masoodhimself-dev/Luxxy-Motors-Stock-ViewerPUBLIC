const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/filters.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/<span className="mb-2 block font-display text-\[11px\] font-black uppercase tracking-\[0.2em\] text-primary">Price from<\/span>/g, '<span className="mb-2 block font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary">Min budget</span>');
content = content.replace(/<span className="mb-2 block font-display text-\[11px\] font-black uppercase tracking-\[0.2em\] text-primary">Price to<\/span>/g, '<span className="mb-2 block font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary">Max budget</span>');

fs.writeFileSync(path, content, 'utf8');
