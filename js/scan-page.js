/* Standalone camera card-scanner — runs INSIDE scan.html, which carries
 * its own relaxed CSP ('unsafe-eval' for OpenCV's Emscripten embind, plus
 * worker-src for Tesseract). It is embedded by the main app as a same-origin
 * <iframe> overlay, so the app's strict default-src 'none' CSP stays intact.
 * scan.html can also be opened directly (no login) to test in isolation.
 *
 * Pipeline (OCR-first — covers the WHOLE Scryfall base, no local card DB):
 *   rectify (OpenCV: Canny + approxPolyDP → perspective warp to a canonical
 *   card) → OCR two regions with Tesseract:
 *     • bottom-left info line → set code + collector number → exact Scryfall
 *       lookup /cards/:set/:cn (authoritative, language-agnostic: settles the
 *       edition AND foreign-language cards in one shot).
 *     • title band → card name → fuzzy + autocomplete Scryfall, used as the
 *       fallback for older cards that lack a printed set code.
 *
 * Why OCR and not image-matching: a descriptor DB (ORB) doesn't scale past a
 * few hundred cards (hundreds of MB to download, billions of comparisons per
 * scan). OCR → Scryfall has no local DB and covers everything. The earlier
 * OCR attempt failed on a raw (skewed) video crop; here we OCR the RECTIFIED
 * canonical card, which is the reliability unlock. Full rationale and the
 * open items live in the scanner entry of CLAUDE.md.
 *
 * On a confirmed pick it posts { type:'deckrypt-scan', action:'pick',
 * card:{name,setcode,cn} } to the parent window (setcode/cn omitted for a
 * name-only match → the parent's add-card flow lets the user pick the
 * printing). Annuler/Escape/Fermer post action:'close'.
 *
 * Memory discipline: every cv.Mat created in the live loop is .delete()'d
 * (WASM heap) — see detectCorners / warpToCanonical. */

(function () {
  "use strict";

  const PARENT = window.parent !== window ? window.parent : null; // null = standalone

  // --- tuning ---
  const DETECT_W = 480;
  const STABLE_FRAMES = 3, STABLE_PX = 6;
  const MIN_AREA = 0.06, MAX_AREA = 0.99;
  // Canonical card the live frame is warped to. Bigger than the old ORB era
  // (480×680): the bottom collector line is tiny, OCR needs the extra pixels.
  const CANON_W = 744, CANON_H = 1040; // ≈ 63:88 mtg card ratio
  // OCR crop boxes, as fractions of the canonical card (x, y, w, h).
  const TITLE_BOX = { x: 0.055, y: 0.045, w: 0.78, h: 0.065 };  // name bar (avoid the mana cost, top-right)
  const BOTTOM_BOX = { x: 0.03, y: 0.928, w: 0.44, h: 0.060 };  // collector + set/lang block, bottom-left
  const SF = "https://api.scryfall.com";

  const TITLE_WHITELIST =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
    "àâäçéèêëîïôöùûüœÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒ',.- ";
  const BOTTOM_WHITELIST = "0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ •*-";
  // parseBottom / cleanTitle live in js/scan-parse.js (pure, unit-tested),
  // loaded as a global before this script in scan.html.

  const $ = (id) => document.getElementById(id);
  const video = $("scanner-video");
  const canvas = $("scanner-canvas");
  const octx = canvas.getContext("2d");
  const intro = $("scanner-intro");
  const spinner = $("scanner-spinner");
  const loadinfo = $("scanner-loadinfo");
  const startBtn = $("scanner-start");
  const errEl = $("scanner-err");
  const statusEl = $("scanner-status");
  const reading = $("scanner-reading");
  const resultsEl = $("scanner-results");
  const candsEl = $("scanner-cands");
  const controls = $("scanner-controls");
  const torchBtn = $("scanner-torch");
  const snapBtn = $("scanner-snap");
  const addBtn = $("scanner-add");
  const resumeBtn = $("scanner-resume");
  const closeBtn = $("scanner-close");
  const introCloseBtn = $("scanner-intro-close");

  const themeCss = getComputedStyle(document.documentElement);
  const ARMED_COLOR = themeCss.getPropertyValue("--accent").trim() || "#818cf8";
  const DETECT_COLOR = themeCss.getPropertyValue("--success").trim() || "#6ee7b7";

  let cvReady = false, ocrReady = false, worker = null, ocrMode = null;
  let track = null, scanning = false, locked = false, busy = false;
  let detW = 0, detH = 0, ratio = 1;
  let prevCorners = null, stableCount = 0, armed = true;
  let bestMatch = null;
  let tickTimer = null;

  const detCanvas = document.createElement("canvas");
  const detCtx = detCanvas.getContext("2d", { willReadFrequently: true });
  const capCanvas = document.createElement("canvas");
  const capCtx = capCanvas.getContext("2d");
  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

  function postParent(action, card) {
    if (!PARENT) return; // standalone: nothing to hand off to
    PARENT.postMessage({ type: "deckrypt-scan", action, card: card || null }, window.location.origin);
  }

  // ---- engine readiness ----
  function whenCvReady(cb) {
    if (typeof cv === "undefined") { setTimeout(() => whenCvReady(cb), 50); return; }
    if (cv instanceof Promise) { cv.then((m) => { window.cv = m; cb(); }); return; }
    if (cv.Mat) { cb(); return; }
    cv.onRuntimeInitialized = cb;
  }
  whenCvReady(() => { cvReady = true; maybeReady(); });

  // Tesseract worker (LSTM-only core, self-hosted under assets/scanner/).
  // corePath/langPath are consumed INSIDE the worker (importScripts/fetch),
  // which resolves relative paths against the worker's own URL — so they must
  // be ABSOLUTE or they'd double up (…/tesseract/assets/scanner/tesseract/…).
  const abs = (p) => new URL(p, location.href).href;
  (function initOcr() {
    if (typeof Tesseract === "undefined") { setTimeout(initOcr, 50); return; }
    Tesseract.createWorker("eng", 1, {
      workerPath: abs("assets/scanner/tesseract/worker.min.js"),
      corePath: abs("assets/scanner/tesseract/"),
      langPath: abs("assets/scanner/tessdata"),
      workerBlobURL: false, // load worker from the 'self' URL → no blob: in CSP
      logger: (m) => {
        if (m && m.status && !ocrReady) {
          loadinfo.textContent = "Moteur OCR : " + m.status + " " + Math.round((m.progress || 0) * 100) + "%";
        }
      },
    }).then((w) => { worker = w; ocrReady = true; maybeReady(); })
      .catch((e) => { errEl.textContent = "Moteur OCR indisponible : " + (e.message || e); spinner.hidden = true; });
  })();

  function maybeReady() {
    if (!(cvReady && ocrReady)) return;
    spinner.hidden = true;
    loadinfo.textContent = "Prêt. Lecture du nom + du code d'extension.";
    startBtn.hidden = false;
    startBtn.focus();
  }

  // ---- camera ----
  function startCamera() {
    startBtn.disabled = true; errEl.textContent = "";
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((stream) => {
      track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      intro.hidden = true;
      [video, canvas, statusEl, controls].forEach((el) => { el.hidden = false; });
      setupTorch();
      return video.play().catch(() => {});
    }).then(() => {
      sizeCanvases();
      statusEl.classList.add("live");
      reading.textContent = "Cherche une carte…";
      scanning = true; scheduleTick(0);
    }).catch((e) => {
      startBtn.disabled = false;
      errEl.textContent = !window.isSecureContext
        ? "Caméra disponible uniquement en https:// (ou localhost)."
        : ("Caméra inaccessible : " + (e.name || e.message));
    });
  }

  function sizeCanvases() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw) return;
    detW = DETECT_W; detH = Math.round(DETECT_W * vh / vw); ratio = vw / detW;
    detCanvas.width = detW; detCanvas.height = detH;
    capCanvas.width = vw; capCanvas.height = vh;
  }

  function setupTorch() {
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities(); if (!caps || !caps.torch) return;
    torchBtn.hidden = false; let on = false;
    torchBtn.onclick = () => {
      on = !on;
      track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
      torchBtn.classList.toggle("active", on);
    };
  }

  function toScreen(p) {
    const vw = video.videoWidth, vh = video.videoHeight, cw = canvas.width, ch = canvas.height;
    const scale = Math.max(cw / vw, ch / vh), offX = (vw * scale - cw) / 2, offY = (vh * scale - ch) / 2;
    return { x: (p.x * ratio) * scale - offX, y: (p.y * ratio) * scale - offY };
  }

  function quadArea(c) {
    const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
    let a = 0;
    for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; a += p.x * q.y - q.x * p.y; }
    return Math.abs(a) / 2;
  }
  function validQuad(c) {
    if (!c || !c.topLeftCorner || !c.topRightCorner || !c.bottomLeftCorner || !c.bottomRightCorner) return false;
    const frac = quadArea(c) / (detW * detH);
    return frac >= MIN_AREA && frac <= MAX_AREA;
  }
  function cornersMoved(a, b) {
    if (!a || !b) return 999;
    const ks = ["topLeftCorner", "topRightCorner", "bottomLeftCorner", "bottomRightCorner"];
    let m = 0;
    ks.forEach((k) => { m = Math.max(m, Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)); });
    return m;
  }

  function orderCorners(p) {
    const bySum = p.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const byDiff = p.slice().sort((a, b) => (a.y - a.x) - (b.y - b.x));
    return { topLeftCorner: bySum[0], bottomRightCorner: bySum[3], topRightCorner: byDiff[0], bottomLeftCorner: byDiff[3] };
  }
  function detectCorners() {
    detCtx.drawImage(video, 0, 0, detW, detH);
    let src = null, gray = null, blur = null, edge = null, k = null, contours = null, hier = null, corners = null;
    try {
      src = cv.imread(detCanvas); gray = new cv.Mat(); blur = new cv.Mat(); edge = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edge, 40, 120);
      k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
      cv.dilate(edge, edge, k);
      contours = new cv.MatVector(); hier = new cv.Mat();
      cv.findContours(edge, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let bestArea = MIN_AREA * detW * detH, bestPts = null;
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i), a = cv.contourArea(c);
        if (a > bestArea) {
          const approx = new cv.Mat(), peri = cv.arcLength(c, true);
          cv.approxPolyDP(c, approx, 0.02 * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const p = [];
            for (let j = 0; j < 4; j++) p.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
            bestPts = p; bestArea = a;
          }
          approx.delete();
        }
        c.delete();
      }
      if (bestPts) corners = orderCorners(bestPts);
    } catch (e) { corners = null; }
    [src, gray, blur, edge, k, contours, hier].forEach((m) => { if (m) try { m.delete(); } catch (e) {} });
    return corners;
  }

  /* Single-flight scheduler for the detect loop. Every re-arm goes through
   * here so there is never more than one chain alive: the loop keeps
   * polling while locked (150 ms), and resumeScanning re-enters it — with a
   * bare setTimeout that second entry would run ALONGSIDE the pending one,
   * doubling detectCorners() work on every "Scanner une autre". */
  function scheduleTick(ms) {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, ms);
  }

  function tick() {
    if (!scanning) return;
    if (locked || busy) { scheduleTick(150); return; }
    if (!video.videoWidth) { scheduleTick(100); return; }

    const corners = detectCorners();
    octx.clearRect(0, 0, canvas.width, canvas.height);
    if (validQuad(corners)) {
      drawQuad(corners, armed ? ARMED_COLOR : DETECT_COLOR);
      const moved = cornersMoved(corners, prevCorners);
      if (moved < STABLE_PX) { stableCount++; } else { stableCount = 0; armed = true; }
      prevCorners = corners;
      reading.textContent = armed
        ? ("Carte détectée — tiens immobile (" + Math.min(stableCount, STABLE_FRAMES) + "/" + STABLE_FRAMES + ")")
        : "Bouge pour rescanner";
      if (armed && stableCount >= STABLE_FRAMES) { capture(corners); }
    } else {
      stableCount = 0; prevCorners = null;
      reading.textContent = "Cherche une carte… (fond contrasté)";
    }
    scheduleTick(70);
  }

  function drawQuad(c, color) {
    const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner].map(toScreen);
    octx.strokeStyle = color; octx.lineWidth = 4; octx.lineJoin = "round";
    octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath(); octx.stroke();
  }

  function capture(corners) {
    armed = false; stableCount = 0; busy = true;
    capCtx.drawImage(video, 0, 0, capCanvas.width, capCanvas.height);
    const card = warpToCanonical(corners);
    if (!card) { busy = false; armed = true; return; }
    reading.textContent = "Lecture…";
    recognize(card).catch(() => {}).then(() => { busy = false; });
  }

  function warpToCanonical(corners) {
    let src = null, M = null, srcTri = null, dstTri = null, dst = null, out = null;
    try {
      src = cv.imread(capCanvas);
      const s = ratio;
      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners.topLeftCorner.x * s, corners.topLeftCorner.y * s,
        corners.topRightCorner.x * s, corners.topRightCorner.y * s,
        corners.bottomLeftCorner.x * s, corners.bottomLeftCorner.y * s,
        corners.bottomRightCorner.x * s, corners.bottomRightCorner.y * s]);
      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CANON_W, 0, 0, CANON_H, CANON_W, CANON_H]);
      M = cv.getPerspectiveTransform(srcTri, dstTri);
      dst = new cv.Mat();
      cv.warpPerspective(src, dst, M, new cv.Size(CANON_W, CANON_H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
      out = document.createElement("canvas"); cv.imshow(out, dst);
    } catch (e) { out = null; }
    [src, M, srcTri, dstTri, dst].forEach((m) => { if (m) try { m.delete(); } catch (e) {} });
    return out;
  }

  // Crop a fractional box from the canonical card into workCanvas, upscaled
  // toward a legible line height, then binarized. `invert` flips polarity for
  // light-on-dark text (the collector line on black-bordered cards).
  function cropForOcr(card, box, invert) {
    const sx = card.width * box.x, sy = card.height * box.y;
    const sw = card.width * box.w, sh = card.height * box.h;
    const scale = Math.max(1, Math.min(4, 80 / sh));
    workCanvas.width = Math.round(sw * scale);
    workCanvas.height = Math.round(sh * scale);
    workCtx.imageSmoothingEnabled = true;
    workCtx.drawImage(card, sx, sy, sw, sh, 0, 0, workCanvas.width, workCanvas.height);
    binarize(workCtx, workCanvas.width, workCanvas.height, invert);
    return workCanvas;
  }

  function binarize(g, w, h, invert) {
    const d = g.getImageData(0, 0, w, h), p = d.data;
    let sum = 0; const n = p.length / 4;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      p[i] = p[i + 1] = p[i + 2] = lum; sum += lum;
    }
    const thr = (sum / n) * 0.92;
    for (let j = 0; j < p.length; j += 4) {
      const dark = p[j] < thr;            // dark pixel in the source
      const text = invert ? !dark : dark; // light-on-dark → treat light as text
      const v = text ? 0 : 255;           // Tesseract wants dark text on white
      p[j] = p[j + 1] = p[j + 2] = v;
    }
    g.putImageData(d, 0, 0);
  }

  async function setOcrMode(mode) {
    if (ocrMode === mode) return;
    await worker.setParameters(mode === "title"
      ? { tessedit_pageseg_mode: "7", tessedit_char_whitelist: TITLE_WHITELIST }
      : { tessedit_pageseg_mode: "6", tessedit_char_whitelist: BOTTOM_WHITELIST });
    ocrMode = mode;
  }

  async function ocr(canvasEl, mode) {
    await setOcrMode(mode);
    const out = await worker.recognize(canvasEl);
    return (out && out.data && out.data.text) || "";
  }

  function sfCard(c) {
    return {
      name: c.name,
      set: c.set_name || c.set,
      setcode: c.set,
      cn: c.collector_number,
      thumb: cardImage(c, "small"),
    };
  }

  function getJson(url) {
    return fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }

  async function lookupSetCn(set, cn) {
    if (!set || !cn) return null;
    const c = await getJson(SF + "/cards/" + encodeURIComponent(set) + "/" + encodeURIComponent(cn));
    return c && c.name ? sfCard(c) : null;
  }

  /* Candidates resolve through ONE batched /cards/collection, not a
   * /named?fuzzy per name: that fires 5 extra parallel requests per scan,
   * which Scryfall's 50-100 ms rate-limit policy doesn't tolerate over a
   * deck-scanning session — and getJson swallows failures, so the 429s
   * would read as bad OCR instead of surfacing. */
  async function lookupName(name) {
    if (!name || name.length < 3) return [];
    const [best, auto] = await Promise.all([
      getJson(SF + "/cards/named?fuzzy=" + encodeURIComponent(name)),
      getJson(SF + "/cards/autocomplete?q=" + encodeURIComponent(name)),
    ]);
    const out = [], seen = new Set();
    if (best && best.name) { out.push(sfCard(best)); seen.add(best.name.toLowerCase()); }

    const names = ((auto && auto.data) || [])
      .filter((n) => !seen.has(n.toLowerCase()))
      .slice(0, 5);
    if (!names.length) return out;

    // Unlike getJson, fetchScryfallCards throws once its retries are
    // spent; candidates are a nice-to-have, so degrade to the best guess.
    const { byName } = await fetchScryfallCards(names.map((n) => ({ name: n })))
      .catch(() => ({ byName: new Map() }));
    for (const n of names) {
      const c = byName.get(n.toLowerCase());
      if (!c || !c.name || seen.has(c.name.toLowerCase())) continue;
      out.push(sfCard(c));
      seen.add(c.name.toLowerCase());
    }
    return out;
  }

  async function recognize(card) {
    const idText = await ocr(cropForOcr(card, BOTTOM_BOX, true), "bottom");
    const { set, cn } = parseBottom(idText);
    const titleText = await ocr(cropForOcr(card, TITLE_BOX, false), "title");
    const name = cleanTitle(titleText);

    // Authoritative path: exact printing from set + collector number.
    const exact = await lookupSetCn(set, cn);
    if (exact) {
      const others = name ? await lookupName(name) : [];
      const cands = [exact, ...others.filter((c) => c.name !== exact.name)].slice(0, 6);
      renderCandidates(cands);
      lockOn(exact);
      return;
    }

    // Fallback: name → fuzzy/autocomplete; edition resolved later by the user.
    const cands = await lookupName(name);
    if (cands.length) {
      renderCandidates(cands);
      lockOn(cands[0]);
      return;
    }

    armed = true;
    reading.textContent = name
      ? ("Pas trouvé : « " + name + " ». Recadre ou rapproche.")
      : "Rien lu — éclaire bien le nom et le bas de la carte.";
  }

  function lockOn(card) {
    locked = true; bestMatch = card;
    statusEl.classList.remove("live"); statusEl.classList.add("locked");
    reading.textContent = card.setcode && card.cn
      ? ("✓ " + card.name + " — " + (card.set || card.setcode) + " #" + card.cn)
      : ("✓ " + card.name + " — édition à confirmer");
    octx.clearRect(0, 0, canvas.width, canvas.height);
    if (prevCorners) drawQuad(prevCorners, DETECT_COLOR);
    snapBtn.hidden = true; addBtn.hidden = false; resumeBtn.hidden = false;
    addBtn.focus();
  }

  function renderCandidates(cards) {
    resultsEl.hidden = false;
    candsEl.replaceChildren();
    cards.forEach((c, idx) => {
      const div = document.createElement("div");
      div.className = "scanner-cand" + (idx === 0 ? " best" : "");
      div.setAttribute("role", "button"); div.tabIndex = 0;
      const im = new Image(); im.alt = c.name; im.className = "scanner-cand-img";
      if (c.thumb) im.src = c.thumb;
      const nm = document.createElement("div"); nm.className = "scanner-cand-name"; nm.textContent = c.name;
      const dd = document.createElement("div"); dd.className = "scanner-cand-meta";
      dd.textContent = (c.set || c.setcode || "") + (c.cn ? " #" + c.cn : "");
      div.append(im, nm, dd);
      const pick = () => lockOn(c);
      div.addEventListener("click", pick);
      div.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      candsEl.appendChild(div);
    });
  }

  // ---- lifecycle ----
  function stopCamera() {
    scanning = false; locked = false;
    clearTimeout(tickTimer); tickTimer = null;
    if (track) { try { track.stop(); } catch (e) {} track = null; }
    video.srcObject = null;
  }
  function confirmPick() {
    if (!bestMatch) return;
    const card = { name: bestMatch.name };
    if (bestMatch.setcode && bestMatch.cn) { card.setcode = bestMatch.setcode; card.cn = bestMatch.cn; }
    stopCamera();
    postParent("pick", card);
  }
  function close() {
    stopCamera();
    if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
    postParent("close");
  }
  function resumeScanning() {
    locked = false; bestMatch = null; armed = true; stableCount = 0; prevCorners = null;
    statusEl.classList.add("live"); statusEl.classList.remove("locked");
    snapBtn.hidden = false; addBtn.hidden = true; resumeBtn.hidden = true;
    resultsEl.hidden = true; candsEl.replaceChildren();
    reading.textContent = "Cherche une carte…";
    if (scanning) scheduleTick(0);
  }

  startBtn.addEventListener("click", startCamera);
  snapBtn.addEventListener("click", () => { if (prevCorners && !busy) capture(prevCorners); });
  addBtn.addEventListener("click", confirmPick);
  resumeBtn.addEventListener("click", resumeScanning);
  closeBtn.addEventListener("click", close);
  introCloseBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  window.addEventListener("resize", () => { if (scanning) sizeCanvases(); });
})();
