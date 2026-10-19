# Provenance and redistribution

## Plate font

Forecourt Plate UK is the dedicated digital plate font approved in the HTML review. The production WOFF and TTF are unchanged from that reviewed artwork. It is a new drawing of the published UK character style commonly called Charles Wright, not a K-Type or Gareth Attrill font. No purchased or personal-use-only font files were converted or included.

**Attribution:** Contains public sector information licensed under the Open Government Licence v3.0.

Character-shape reference: *The Road Vehicles (Display of Registration Marks) Regulations 2001*, Schedule 4, Part 1, page 23. Crown copyright.

Source: https://www.legislation.gov.uk/uksi/2001/561/pdfs/uksi_20010561_en.pdf

Licence: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/

The full licence, source attribution and scope of the digital adaptation are included in `licences/FONT-LICENCE.txt`. OGL v3.0 permits commercial reuse subject to its terms, including attribution. Retain this notice and the font licence with redistribution. Neither the source attribution nor the use of UK symbols implies official endorsement or physical-plate certification.

## Flag

The Union Flag is an editable vector drawing created for the approved review, repeated without redrawing in the standalone SVG and React markup. It is not downloaded from an icon library. No brand assets or other dealership icons are included in this package.

## Review runtime and tools

The standalone HTML bundles React 19.2.0 and React DOM 19.2.0, both MIT licensed. Their notices are included in `licences/REACT-MIT.txt` and `licences/REACT-DOM-MIT.txt`, and retained in the HTML. Production JavaScript imports the host application's React rather than bundling it.

Existing ink/gold review styling and review button source were carried forward from the previously approved dealership component review. They are isolated under `review/` and are not imported by the production exports.

TypeScript, esbuild, Playwright, axe-core and fontTools are development or verification tools. Their binaries are not bundled in the delivery. No external font, image or SVG network dependency is required by the review.
