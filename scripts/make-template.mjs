// Builds template.pdf from sample.pdf: removes the signature stamp so the
// published template is blank. Run: node scripts/make-template.mjs sample.pdf template.pdf
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import fs from 'fs';
const [src, out] = process.argv.slice(2);
const doc = await PDFDocument.load(fs.readFileSync(src));
const page = doc.getPages()[0];
const annots = page.node.Annots();
const keep = [];
for (let i = 0; i < annots.size(); i++) {
  const a = doc.context.lookup(annots.get(i));
  if (a.get(PDFName.of('Subtype'))?.toString() !== '/Stamp') keep.push(annots.get(i));
}
page.node.set(PDFName.of('Annots'), doc.context.obj(keep));
fs.writeFileSync(out, await doc.save());
console.log('wrote', out, 'annots', keep.length);
