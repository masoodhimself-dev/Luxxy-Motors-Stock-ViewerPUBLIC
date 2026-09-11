const fs = require('fs');

// 1 & 2: Fix home.tsx (Heading casing and section ID)
const homePath = 'artifacts/luxxy-motors/src/pages/home.tsx';
let homeContent = fs.readFileSync(homePath, 'utf8');
homeContent = homeContent.replace(/>Recently Handed Over<\/h2>/g, '>Recently handed over</h2>');
homeContent = homeContent.replace(/id="stock"/g, 'id="search"');
fs.writeFileSync(homePath, homeContent, 'utf8');

// 3 & 4: Fix filters.tsx numeric parsing and gallery compact actions
const filtersPath = 'artifacts/luxxy-motors/src/components/filters.tsx';
let filtersContent = fs.readFileSync(filtersPath, 'utf8');
filtersContent = filtersContent.replace(
  /onChange=\{\(minPrice\) => setFilters\(\(current\) => \(\{ \.\.\.current, minPrice \}\)\)\}/g,
  'onChange={(minPrice) => setFilters((current) => ({ ...current, minPrice: minPrice ? Number(minPrice) : undefined }))}'
);
filtersContent = filtersContent.replace(
  /onChange=\{\(maxPrice\) => setFilters\(\(current\) => \(\{ \.\.\.current, maxPrice \}\)\)\}/g,
  'onChange={(maxPrice) => setFilters((current) => ({ ...current, maxPrice: maxPrice ? Number(maxPrice) : undefined }))}'
);
fs.writeFileSync(filtersPath, filtersContent, 'utf8');

const galleryPath = 'artifacts/luxxy-motors/src/components/gallery.tsx';
let galleryContent = fs.readFileSync(galleryPath, 'utf8');
if (!galleryContent.includes('data-testid={`compact-actions-${vehicle.id}`}')) {
  // Try to find the wrapper for the buttons in list view
  galleryContent = galleryContent.replace(
    /className="flex flex-col sm:flex-row gap-4"/g,
    'data-testid={`compact-actions-${vehicle.id}`} className="flex flex-col sm:flex-row gap-4"'
  );
  fs.writeFileSync(galleryPath, galleryContent, 'utf8');
}
