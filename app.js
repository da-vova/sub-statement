/* Subcontractor's Statement filler. Everything runs in the browser; nothing is uploaded. */
(() => {
  const { PDFDocument, StandardFonts } = PDFLib;
  const $ = (id) => document.getElementById(id);
  const STORE = 'substatement.v1';
  const SIG_STORE = 'substatement.sig.v1';

  /* ---------- saved details ---------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  function saveDetails() {
    const data = {};
    document.querySelectorAll('[data-keep]').forEach((el) => {
      if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else data[el.id] = el.value;
    });
    store.set(STORE, JSON.stringify(data));
  }

  function loadDetails() {
    let data = {};
    try { data = JSON.parse(store.get(STORE) || '{}'); } catch {}
    document.querySelectorAll('[data-keep]').forEach((el) => {
      if (el.type === 'radio') el.checked = data[el.name] ? data[el.name] === el.value : el.checked;
      else if (data[el.id] != null) el.value = data[el.id];
    });
    if (!$('signDate').value) $('signDate').value = new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local time
  }

  /* ---------- signature pad ---------- */
  const canvas = $('sig');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let drawing = false, hasInk = false, last = null;

  function sizeCanvas() {
    const prev = hasInk ? canvas.toDataURL('image/png') : null;
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#0a1a3a';
    if (prev) drawImageURL(prev);
  }

  function drawImageURL(url) {
    const img = new Image();
    img.onload = () => {
      const r = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      const s = Math.min(r.width / img.width, r.height / img.height, 1 / (window.devicePixelRatio || 1));
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, (r.width - w) / 2, (r.height - h) / 2, w, h);
      hasInk = true;
    };
    img.src = url;
  }

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; hasInk = true;
  });
  const end = () => { if (drawing) { drawing = false; store.set(SIG_STORE, trimmedSignature() || ''); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  $('sigClear').onclick = () => {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height); hasInk = false; store.del(SIG_STORE);
  };

  // PNG of just the inked area (transparent background), or null.
  function trimmedSignature() {
    if (!hasInk) return null;
    const { width: w, height: h } = canvas;
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const pad = 4;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  /* ---------- PDF ---------- */
  let templateBytes = null;
  async function template() {
    if (!templateBytes) {
      const r = await fetch('template.pdf');
      if (!r.ok) throw new Error('Could not load the form template');
      templateBytes = await r.arrayBuffer();
    }
    return templateBytes;
  }

  const splitDate = (v) => { if (!v) return ['', '', '']; const [y, m, d] = v.split('-'); return [d, m, y]; };
  const fmtDate = (v) => { const [d, m, y] = splitDate(v); return v ? `${d}-${m}-${y}` : ''; };

  async function buildPdf() {
    const doc = await PDFDocument.load(await template());
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.getForm();

    const put = (name, value) => {
      const f = form.getTextField(name);
      value = (value || '').trim();
      const w = f.acroField.getWidgets()[0].getRectangle().width - 2;
      let size = 10;
      while (size > 5 && font.widthOfTextAtSize(value, size) > w) size -= 0.5;
      f.setFontSize(size);
      f.setText(value);
    };
    const putDate = (n, v) => { const [d, m, y] = splitDate(v); put('DD' + n, d); put('MM' + n, m); put('YYYY' + n, y); };

    put('Subcontractor/business name', $('subName').value);
    put('ABN', $('subAbn').value);
    put('Address of subcontractor', $('subAddr').value);
    put('Business name of principal contactor', $('prinName').value);
    put('ABN_2', $('prinAbn').value);
    put('Contract number/identifier', $('contract').value);
    putDate(1, $('from').value);
    putDate(2, $('to').value);
    putDate(3, $('claim').value);
    putDate(4, $('coc').value);
    putDate(5, $('signDate').value);
    put('Director or authorised person', $('person').value);
    put('Full name', $('person').value);
    put('PositionTitle', $('position').value);

    // On the form, "Tick2" is the upper box (workers employed) and "Tick1" the lower (none / exempt).
    const tick = document.querySelector('input[name=tick]:checked').value;
    form.getCheckBox('Tick2')[tick === 'employ' ? 'check' : 'uncheck']();
    form.getCheckBox('Tick1')[tick === 'none' ? 'check' : 'uncheck']();

    form.updateFieldAppearances(font);
    try { form.removeField(form.getField('Signature')); } catch {}
    form.flatten();

    const sig = trimmedSignature();
    if (sig) {
      const img = await doc.embedPng(sig);
      const box = { x: 108, y: 152, w: 175, h: 40 }; // just above the "(f) Signature" line
      const s = Math.min(box.w / img.width, box.h / img.height);
      doc.getPages()[0].drawImage(img, { x: box.x, y: box.y, width: img.width * s, height: img.height * s });
    }

    const file = $('cocFile').files[0];
    if (file) await appendAttachment(doc, file);

    return doc.save();
  }

  async function appendAttachment(doc, file) {
    const bytes = await file.arrayBuffer();
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
      return;
    }
    // Any image: re-encode via canvas to JPEG so HEIC/WebP etc. that the browser can decode still work.
    const bmp = await createImageBitmap(file);
    const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const jpg = await (await fetch(c.toDataURL('image/jpeg', 0.85))).arrayBuffer();
    const img = await doc.embedJpg(jpg);
    const page = doc.addPage([595.28, 841.89]);
    const m = 36, s = Math.min((595.28 - 2 * m) / img.width, (841.89 - 2 * m) / img.height);
    page.drawImage(img, { x: (595.28 - img.width * s) / 2, y: (841.89 - img.height * s) / 2, width: img.width * s, height: img.height * s });
  }

  function fileName() {
    const who = ($('subName').value || 'Subcontractor').replace(/[^\w &.-]+/g, '').trim();
    const when = fmtDate($('claim').value) || fmtDate($('signDate').value) || 'undated';
    return `Subcontractor Statement - ${who} - ${when}.pdf`;
  }

  function check() {
    const missing = [];
    [['subName', 'Subcontractor name'], ['prinName', 'Principal contractor'], ['from', 'Work from'], ['to', 'Work to'],
     ['person', 'Your full name'], ['signDate', 'Date signed']].forEach(([id, n]) => { if (!$(id).value.trim()) missing.push(n); });
    if (!hasInk) missing.push('Signature');
    return missing;
  }

  const msg = (t, cls = '') => { $('msg').textContent = t; $('msg').className = cls; };

  async function makeFile() {
    const missing = check();
    if (missing.length && !confirm('Missing: ' + missing.join(', ') + '.\n\nSave anyway?')) return null;
    saveDetails();
    msg('Creating PDF…');
    const bytes = await buildPdf();
    return new File([bytes], fileName(), { type: 'application/pdf' });
  }

  $('save').onclick = async () => {
    try {
      const file = await makeFile(); if (!file) return msg('');
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      msg('Saved: ' + file.name, 'ok');
    } catch (e) { console.error(e); msg('Error: ' + e.message, 'err'); }
  };

  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }));
  if (canShareFiles) $('share').hidden = false;
  $('share').onclick = async () => {
    try {
      const file = await makeFile(); if (!file) return msg('');
      await navigator.share({ files: [file], title: file.name });
      msg('Shared: ' + file.name, 'ok');
    } catch (e) { if (e.name !== 'AbortError') { console.error(e); msg('Error: ' + e.message, 'err'); } else msg(''); }
  };

  $('reset').onclick = () => {
    if (!confirm('Clear all saved details and signature from this phone?')) return;
    store.del(STORE); store.del(SIG_STORE);
    $('f').reset(); $('sigClear').click(); loadDetails(); msg('Cleared.', 'ok');
  };

  document.querySelectorAll('[data-keep]').forEach((el) => el.addEventListener('change', saveDetails));

  /* ---------- init ---------- */
  loadDetails();
  sizeCanvas();
  const savedSig = store.get(SIG_STORE);
  if (savedSig) drawImageURL(savedSig);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(sizeCanvas, 150); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
