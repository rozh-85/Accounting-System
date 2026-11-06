/**
 * Runs after every install (including on Vercel) and fixes a bug in
 * @react-pdf/layout: page relayout resolves styles a second time, so a resolved
 * lineHeight is taken for a unitless one and multiplied by the font size again
 * at every page break. Rows swell, and around page 12 the value overflows and
 * the PDF fails with "unsupported number". All versions tried so far have it.
 *
 * Fails the install if the code has changed, so upgrading the library can never
 * silently bring the bug back: check whether the new version still needs this.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../node_modules/@react-pdf/layout/lib/index.js', import.meta.url));

const replacements = [
  ['const style = computeStyle(container, node);\n    // Split fragments re-enter', 'const style = node.stylesResolved ? node.style : computeStyle(container, node);\n    // Split fragments re-enter'],
  ['return Object.assign({}, node, { style, wasSplit });', 'return Object.assign({}, node, { style, wasSplit, stylesResolved: true });'],
  ['return Object.assign({}, node, { style, wasSplit, children });', 'return Object.assign({}, node, { style, wasSplit, children, stylesResolved: true });'],
];

let source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
if (source.includes('node.stylesResolved')) process.exit(0);

for (const [from, to] of replacements) {
  if (!source.includes(from)) {
    console.error(`patch-react-pdf: expected code not found in ${file}. See the note at the top of scripts/patch-react-pdf.mjs.`);
    process.exit(1);
  }
  source = source.replace(from, to);
}
writeFileSync(file, source);
console.log('patch-react-pdf: applied');
