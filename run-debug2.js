const fs = require('fs');
let code = fs.readFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', 'utf8');

const debugCode = `
    console.log("Document width:", await page.evaluate(() => document.documentElement.scrollWidth));
    console.log(await page.evaluate((w) => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => el.getBoundingClientRect().width > w)
        .map(el => ({ tag: el.tagName, className: el.className, id: el.id, width: el.getBoundingClientRect().width }));
    }, width));
`;

code = code.replace(
  /await assertNoHorizontalOverflow\(page\);/g,
  `${debugCode}\n    await assertNoHorizontalOverflow(page);`
);
fs.writeFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', code);
