const fs = require('fs');
const path = 'artifacts/luxxy-motors/src/components/ui/fields.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /return focusUtils\.filter\(\(utility\) => \/\^shadow-\\\\\[\/\.test\(utility\)\);/,
  "return focusUtils.filter((utility) => /^shadow-\\[/.test(utility));"
);
content = content.replace(
  /console.log\(field.label, "MERGED", className, "FOCUS", focus, "SHADOWS", brutalistShadowClasses\(focus\)\);\n    /,
  ""
);

fs.writeFileSync(path, content, 'utf8');
