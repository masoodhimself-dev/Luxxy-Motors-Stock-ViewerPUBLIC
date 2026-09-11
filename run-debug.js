const fs = require('fs');
let code = fs.readFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', 'utf8');

const debugCode = `
    console.log(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => el.getBoundingClientRect().width > 320)
        .map(el => ({ tag: el.tagName, className: el.className, width: el.getBoundingClientRect().width }));
    }));
`;

code = code.replace(
  /await assertNoHorizontalOverflow\(page\);/g,
  `${debugCode}\n    await assertNoHorizontalOverflow(page);`
);
fs.writeFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', code);
