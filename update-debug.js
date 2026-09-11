const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/ui/fields.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /expect\(brutalistShadowClasses\(focus\), \`\$\{field\.label\} on-ink shadow\`\)\.toEqual\(\['shadow-\[4px_4px_0px_#E51D34\]'\]\);/,
  `console.log(field.label, "MERGED", className, "FOCUS", focus, "SHADOWS", brutalistShadowClasses(focus));\n    expect(brutalistShadowClasses(focus), \`\${field.label} on-ink shadow\`).toEqual(['shadow-[4px_4px_0px_#E51D34]']);`
);
fs.writeFileSync(path, content, 'utf8');
