# sub statement

Mobile web app (installable PWA) that fills in the NSW **Subcontractor's Statement** (workers comp /
payroll tax / remuneration) and saves it as a PDF on the phone.

- Stack: plain static HTML/JS, no build step. `pdf-lib` (vendored in `vendor/`) fills the official
  form's AcroForm fields in the browser, flattens them, stamps the drawn signature, and can append a
  Certificate of Currency (PDF or photo) as extra pages. Filled text is Helvetica-Bold, centred.
  Nothing is uploaded. Multiple accounts (one per person): list in `substatement.accounts` [{id,name}];
  each has its own vault `substatement.vault.<id>` (AES-GCM, key from PBKDF2 of that person's PIN) and
  fail counter `substatement.fails.<id>`; 5 wrong PINs in a row erases only that account. The old
  single-PIN vault (`substatement.vault.v1`) is migrated to "Account 1". Saves on every keystroke and
  flushes before locking. Auto-locks after 5 min in the background. Show/Hide PIN toggle.
- Years print as 2 digits. Signature: draw it, or load an image ("Use signature image…"); an image is
  placed where the original stamp was (x108 y138, 145x62pt). `my-signature.png` = signature extracted
  from sample.pdf, git-ignored. Never commit it.
- Hosting: GitHub Pages from `main` (repo `da-vova/sub-statement`).
- `template.pdf` = blank form, built from `sample.pdf` with `node scripts/make-template.mjs sample.pdf template.pdf`
  (strips the signature stamp). `sample.pdf` contains a real signature and is git-ignored. Never commit it.
- Field map: dates `DDn/MMn/YYYYn` (1 = work from, 2 = work to, 3 = payment claim, 4 = Certificate of Currency,
  5 = date signed). `Tick2` = upper box (workers employed), `Tick1` = lower box (none / exempt).
- Run locally: `python3 -m http.server 8765`, then open http://localhost:8765
- When changing any file, bump `VERSION` in `sw.js`, the `?v=` on the script tags and "Version N" in
  `index.html`, so installed phones pick up the update (the user can read the version on the lock screen).
