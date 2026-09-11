const fs = require('fs');

const path = 'artifacts/luxxy-motors/src/components/ui/fields.test.tsx';
let content = fs.readFileSync(path, 'utf8');

// Change expectBrassFocusEdge to expectBrutalistFocus
content = content.replace(/expectBrassFocusEdge/g, 'expectBrutalistFocus');

// Update expectBrutalistFocus implementation
content = content.replace(
  /function expectBrutalistFocus\(className: string, label: string\) \{\s+const focus = focusUtilities\(className\);\s+expect\(focus, \`\$\{label\} focus border\`\)\.toContain\('border-accent'\);\s+expect\(focus, \`\$\{label\} focus ring\`\)\.toContain\('ring-2'\);\s+expect\(haloClasses\(focus\), \`\$\{label\} focus halo\`\)\.toHaveLength\(1\);\s+expect\(utilities\(className\), \`\$\{label\} native outline\`\)\.toContain\('outline-none'\);\s+\}/m,
  `function expectBrutalistFocus(className: string, label: string) {
  const focus = focusUtilities(className);

  expect(focus, \`\${label} focus border\`).toContain('border-accent');
  expect(focus, \`\${label} focus ring\`).toContain('ring-0');
  const shadows = focus.filter(f => f.startsWith('shadow-['));
  expect(shadows.length, \`\${label} focus shadow\`).toBeGreaterThan(0);
  expect(utilities(className), \`\${label} native outline\`).toContain('outline-none');
}`
);

// Update test names and checks
content = content.replace(/keeps the brass focus edge/g, 'keeps the brutalist focus edge');
content = content.replace(/expect\(focusUtilities\(className\), \`\$\{field\.label\} default halo\`\)\.toContain\('ring-accent\/25'\);/g, `expect(focusUtilities(className), \`\${field.label} default shadow\`).toContain('shadow-[4px_4px_0px_#E51D34]');`);
content = content.replace(/haloClasses/g, 'brutalistShadowClasses');
content = content.replace(/function brutalistShadowClasses\(focusUtils: string\[\]\) \{\s+return focusUtils\.filter\(\(utility\) => \/\^ring-accent\\\/\d\+\$\/\.test\(utility\)\);\s+\}/m, `function brutalistShadowClasses(focusUtils: string[]) {
  return focusUtils.filter((utility) => /^shadow-\\[/.test(utility));
}`);
content = content.replace(/expect\(brutalistShadowClasses\(focus\), \`\$\{field\.label\} on-ink halo\`\)\.toEqual\(\['ring-accent\/30'\]\);/g, `expect(brutalistShadowClasses(focus), \`\${field.label} on-ink shadow\`).toEqual(['shadow-[4px_4px_0px_#E51D34]']);`);

// Update failing mock tests at the end
content = content.replace(/fails a field that lost the brass edge or kept the browser outline/g, 'fails a field that lost the brutalist edge or kept the browser outline');
content = content.replace(
  /const brass = 'outline-none focus:border-accent focus:ring-2 focus:ring-accent\/25';/,
  "const brass = 'outline-none focus:border-accent focus:ring-0 focus:shadow-[4px_4px_0px_#E51D34]';"
);
content = content.replace(
  /expect\(\(\) =>\s+expectBrutalistFocus\('outline-none focus:ring-2 focus:ring-accent\/25', 'field'\),\s+\)\.toThrow\(\);/m,
  `expect(() =>
      expectBrutalistFocus('outline-none focus:ring-0 focus:shadow-[4px_4px_0px_#E51D34]', 'field'),
    ).toThrow();`
);
content = content.replace(
  /expect\(\(\) => expectBrutalistFocus\('outline-none focus:border-accent focus:ring-2', 'field'\)\)\.toThrow\(\);/,
  `expect(() => expectBrutalistFocus('outline-none focus:border-accent focus:ring-0', 'field')).toThrow();`
);
content = content.replace(
  /expect\(\(\) =>\s+expectBrutalistFocus\('focus:border-accent focus:ring-2 focus:ring-accent\/25', 'field'\),\s+\)\.toThrow\(\);/m,
  `expect(() =>
      expectBrutalistFocus('focus:border-accent focus:ring-0 focus:shadow-[4px_4px_0px_#E51D34]', 'field'),
    ).toThrow();`
);
content = content.replace(
  /expect\(\(\) =>\s+expectBrutalistFocus\('outline-none border-accent ring-2 ring-accent\/25', 'field'\),\s+\)\.toThrow\(\);/m,
  `expect(() =>
      expectBrutalistFocus('outline-none border-accent ring-0 shadow-[4px_4px_0px_#E51D34]', 'field'),
    ).toThrow();`
);

// Fix the base classes expected in fields.test.tsx since I changed them
// Input base class is now border-2 border-primary bg-background px-4 font-bold text-foreground shadow-[2px_2px_0px_#111]
content = content.replace(
  /const surrendered of \['border-border', 'bg-background', 'text-foreground'\]/g,
  "const surrendered of ['border-primary', 'bg-background', 'text-foreground']"
);
content = content.replace(
  /\[\n\s+'px-3',/m,
  "[\n    'px-4',"
);

// And update expected height if it changed from h-10 to h-12
content = content.replace(/height of heightClasses\(field\.base\)/, 'height of heightClasses(field.base)');

fs.writeFileSync(path, content, 'utf8');
