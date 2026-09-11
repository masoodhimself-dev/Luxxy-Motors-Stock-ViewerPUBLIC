const fs = require('fs');
let code = fs.readFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', 'utf8');

const debugCode = `
    console.log("Document scrollWidth:", await page.evaluate(() => document.documentElement.scrollWidth));
    console.log(await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*'))
        .filter(el => el.scrollWidth > 375 || el.getBoundingClientRect().width > 375)
        .map(el => ({ tag: el.tagName, className: el.className, id: el.id, scrollWidth: el.scrollWidth, width: el.getBoundingClientRect().width }));
    }));
`;

code = code.replace(
  /await assertNoHorizontalOverflow\(page\);/g,
  `${debugCode}\n    await assertNoHorizontalOverflow(page);`
);
fs.writeFileSync('artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts', code);
