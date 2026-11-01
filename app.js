/* Subcontractor's Statement filler. Everything runs in the browser; nothing is uploaded. */
(() => {
  const { PDFDocument, StandardFonts, TextAlignment } = PDFLib;
  const $ = (id) => document.getElementById(id);
  const VAULT = 'substatement.vault.v1';                       // encrypted {fields, sig}
  const OLD_STORE = 'substatement.v1', OLD_SIG = 'substatement.sig.v1'; // pre-PIN plain storage
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const FAILS = 'substatement.fails';  // wrong PIN attempts in a row
  const MAX_FAILS = 5;                 // reaching this erases everything

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ---------- PIN vault: details + signature encrypted with AES-GCM, key derived from the PIN ---------- */
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let key = null, salt = null, sigData = null, sigKind = 'drawn'; // sigKind: 'drawn' | 'image'

  async function deriveKey(pin, saltBytes) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function writeVault(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(data))));
    store.set(VAULT, JSON.stringify({ salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  }

  async function readVault(pin) {
    const v = JSON.parse(store.get(VAULT));
    const k = await deriveKey(pin, unb64(v.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, k, unb64(v.ct)); // throws if PIN wrong
    key = k; salt = unb64(v.salt);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function newVault(pin, data) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(pin, salt);
    await writeVault(data);
  }

  function collect() {
    const fields = {};
    document.querySelectorAll('[data-keep]').forEach((el) => {
      if (el.type === 'radio') { if (el.checked) fields[el.name] = el.value; }
      else fields[el.id] = el.value;
    });
    return { fields, sig: sigData, sigKind };
  }

  let saveTimer = null;
  function saveDetails() {
    if (!key) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeVault(collect()).catch((e) => console.error(e)), 300);
  }

  function applyData(data) {
    const fields = (data && data.fields) || {};
    document.querySelectorAll('[data-keep]').forEach((el) => {
      if (el.type === 'radio') el.checked = fields[el.name] ? fields[el.name] === el.value : el.checked;
      else if (fields[el.id] != null) el.value = fields[el.id];
    });
    $('signDate').value = new Date().toLocaleDateString('en-CA'); // today, yyyy-mm-dd local time
    sigData = (data && data.sig) || null;
    sigKind = (data && data.sigKind) || 'drawn';
    if (sigData) drawImageURL(sigData);
  }

  // Data saved before the PIN existed (plain localStorage) gets moved into the vault.
  function legacyData() {
    let fields = null;
    try { fields = JSON.parse(store.get(OLD_STORE) || 'null'); } catch {}
    const sig = store.get(OLD_SIG) || null;
    return fields || sig ? { fields: fields || {}, sig } : null;
  }

  /* ---------- lock screen ---------- */
  function showLock() {
    const creating = !store.get(VAULT);
    $('lockTitle').textContent = creating ? 'Create a PIN' : 'Enter your PIN';
    $('lockText').textContent = creating
      ? 'Pick a PIN (at least 4 digits). It locks your saved details and signature on this phone.'
      : 'Your saved details are locked.';
    $('pin2Wrap').hidden = !creating;
    $('unlockBtn').textContent = creating ? 'Set PIN' : 'Unlock';
    $('forgot').hidden = creating;
    $('pin').value = ''; $('pin2').value = '';
    const fails = failCount();
    $('lockMsg').textContent = !creating && fails ? `${MAX_FAILS - fails} attempt(s) left before everything is erased.` : '';
    $('lock').hidden = false; $('app').hidden = true;
    setTimeout(() => $('pin').focus(), 50);

    $('lockForm').onsubmit = async (e) => {
      e.preventDefault();
      const pin = $('pin').value.trim();
      if (pin.length < 4) { $('lockMsg').textContent = 'PIN must be at least 4 digits.'; return; }
      $('unlockBtn').disabled = true;
      try {
        if (creating) {
          if (pin !== $('pin2').value.trim()) { $('lockMsg').textContent = "PINs don't match."; return; }
          const old = legacyData();
          await newVault(pin, old || { fields: {}, sig: null });
          store.del(OLD_STORE); store.del(OLD_SIG);
          unlocked(old);
        } else {
          let data;
          try { data = await readVault(pin); }
          catch (err) { return wrongPin(); }
          store.del(FAILS);
          unlocked(data);
        }
      } catch (err) {
        console.error(err);
        $('lockMsg').textContent = 'Something went wrong: ' + err.message;
      } finally { $('unlockBtn').disabled = false; }
    };
  }

  function failCount() { return parseInt(store.get(FAILS) || '0', 10) || 0; }

  function wipeAll() { [VAULT, OLD_STORE, OLD_SIG, FAILS].forEach((k) => store.del(k)); }

  function wrongPin() {
    const n = failCount() + 1;
    if (n >= MAX_FAILS) {
      wipeAll();
      alert(`Wrong PIN ${MAX_FAILS} times in a row. All saved information has been erased.`);
      location.reload();
      return;
    }
    store.set(FAILS, String(n));
    const left = MAX_FAILS - n;
    $('lockMsg').textContent = `Wrong PIN. ${left} attempt${left === 1 ? '' : 's'} left before everything is erased.`;
    $('pin').value = ''; $('pin').focus();
  }

  // Keep the keyboard up: stop the button stealing focus from the PIN box on tap.
  $('showPin').addEventListener('pointerdown', (e) => e.preventDefault());
  $('showPin').addEventListener('mousedown', (e) => e.preventDefault());
  $('showPin').addEventListener('click', () => {
    const show = $('pin').type === 'password';
    ['pin', 'pin2'].forEach((id) => { $(id).type = show ? 'text' : 'password'; });
    $('showPin').textContent = show ? '🙈 Hide PIN' : '👁 Show PIN';
    $('showPin').setAttribute('aria-pressed', String(show));
  });

  function unlocked(data) {
    $('lock').hidden = true; $('app').hidden = false;
    sizeCanvas();
    applyData(data);
  }

  function lockNow() { key = null; salt = null; location.reload(); }

  $('forgot').onclick = () => {
    if (!confirm('Forgot your PIN? This deletes all saved details and the signature so you can start again.')) return;
    wipeAll(); location.reload();
  };

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (key && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lockNow();
  });

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
  const end = () => { if (drawing) { drawing = false; sigData = trimmedSignature(); sigKind = 'drawn'; saveDetails(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  $('sigClear').onclick = () => {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height); hasInk = false; sigData = null; sigKind = 'drawn'; saveDetails();
  };

  // Signature from an image file (e.g. my-signature.png). Near-white pixels become transparent so a
  // photo of a signature on paper doesn't cover the form's dotted line.
  $('sigFile').onchange = async () => {
    const file = $('sigFile').files[0];
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1500 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const im = g.getImageData(0, 0, c.width, c.height), px = im.data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (lum > 200) px[i + 3] = 0;
        if (px[i + 3] > 10) {
          const x = (i / 4) % c.width, y = Math.floor(i / 4 / c.width);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) throw new Error('No signature found in that image.');
      g.putImageData(im, 0, 0);
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      sigData = out.toDataURL('image/png'); sigKind = 'image';
      drawImageURL(sigData);
      saveDetails();
      msg('Signature loaded from file.', 'ok');
    } catch (e) { console.error(e); msg('Could not use that image: ' + e.message, 'err'); }
    $('sigFile').value = '';
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
      const r = await fetch('template.pdf', { cache: 'no-cache' });
      if (!r.ok) throw new Error('Could not load the form template');
      templateBytes = await r.arrayBuffer();
    }
    return templateBytes;
  }

  const splitDate = (v) => { if (!v) return ['', '', '']; const [y, m, d] = v.split('-'); return [d, m, y]; };
  const fmtDate = (v) => { const [d, m, y] = splitDate(v); return v ? `${d}-${m}-${y}` : ''; };

  async function buildPdf() {
    const doc = await PDFDocument.load(await template());
    const font = await doc.embedFont(StandardFonts.HelveticaBold); // filled-in text is bold
    const form = doc.getForm();

    const put = (name, value) => {
      const f = form.getTextField(name);
      value = (value || '').trim();
      const w = f.acroField.getWidgets()[0].getRectangle().width - 2;
      let size = 10;
      while (size > 5 && font.widthOfTextAtSize(value, size) > w) size -= 0.5;
      f.setFontSize(size);
      f.setAlignment(TextAlignment.Center);
      f.setText(value);
    };
    const putDate = (n, v) => { const [d, m, y] = splitDate(v); put('DD' + n, d); put('MM' + n, m); put('YYYY' + n, y ? y.slice(-2) : ''); }; // 2-digit year

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

    if (sigData) {
      const img = await doc.embedPng(sigData);
      const box = sigKind === 'image'
        ? { x: 108, y: 138, w: 145, h: 62 }  // same spot and size as the signature stamp on the original
        : { x: 108, y: 152, w: 175, h: 40 }; // just above the "(f) Signature" line
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
    if (!sigData) missing.push('Signature');
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
    if (!confirm('Delete all saved details, the signature and your PIN from this phone?')) return;
    store.del(VAULT); store.del(OLD_STORE); store.del(OLD_SIG); location.reload();
  };

  $('lockBtn').onclick = lockNow;

  $('changePin').onclick = async () => {
    const pin = (prompt('New PIN (at least 4 digits):') || '').trim();
    if (!pin) return;
    if (pin.length < 4) return alert('PIN must be at least 4 digits.');
    if ((prompt('Type the new PIN again:') || '').trim() !== pin) return alert("PINs don't match. PIN not changed.");
    await newVault(pin, collect());
    msg('PIN changed.', 'ok');
  };

  document.querySelectorAll('[data-keep]').forEach((el) => el.addEventListener('change', saveDetails));

  /* ---------- init ---------- */
  if (!window.crypto || !crypto.subtle) {
    document.body.textContent = 'This app needs a secure (https) connection.';
    return;
  }
  showLock();
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(sizeCanvas, 150); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
