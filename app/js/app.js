/* Roo Radar: main app (setup screen, drive loop, alerts, map). */
(function (RR) {
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  let cfg, routes, S, D = null, map = null, mapLayers = [], carMarker = null;
  const settings = Object.assign({
    participant: 'P1', condition: 'B', route: 'R1', layout: 'X', drive: 1, preset: null,
    camera: true, showCam: true, debug: false, showReport: true, green: true, code: Math.random().toString(36).slice(2, 7)
  }, store.get('rr_settings', {}));

  /* ------------------------------------------------ boot */
  async function boot() {
    const [c, r, g, p] = await Promise.all(['data/config.json', 'data/routes.json', 'data/risk_grid.json', 'data/roo_points.json']
      .map(u => fetch(u).then(x => x.json())));
    cfg = c; routes = r; RR.risk.setGrid(g); RR.risk.setPoints(p);
    if (!settings.preset) settings.preset = cfg.defaultPreset;
    if (settings.motion) Object.assign(cfg.motion, settings.motion);
    buildSetup();
    RR.remote.connect(cfg.ntfyBase, settings.code, onCommand, ok => setChip('chipRemote', ok ? 'Remote: connected' : 'Remote: offline', ok));
    RR.detector.load(cfg).then(() => setChip('chipModel', 'Detector: ready', true))
      .catch(e => setChip('chipModel', 'Detector: not loaded', false, e.message));
    document.addEventListener('keydown', onKey);
  }

  function setChip(id, text, ok, title) {
    const el = $(id); if (!el) return;
    el.textContent = text; el.className = 'chip ' + (ok ? 'ok' : 'bad'); if (title) el.title = title;
  }

  /* ------------------------------------------------ setup screen */
  function buildSetup() {
    const sel = (id, opts, val) => { $(id).innerHTML = opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join(''); $(id).value = val; };
    sel('sParticipant', ['P1', 'P2', 'P3', 'P4', 'P5', 'PILOT'].map(x => [x, x]), settings.participant);
    sel('sCondition', [['A', 'A: Baseline (silent, speed only)'], ['B', 'B: Roo Radar (alerts)']], settings.condition);
    sel('sRoute', Object.entries(routes).map(([k, v]) => [k, `${k}: ${v.name}`]), settings.route);
    sel('sLayout', [['X', 'Layout X'], ['Y', 'Layout Y']], settings.layout);
    sel('sDrive', [['1', 'Drive 1'], ['2', 'Drive 2'], ['0', 'Practice']], String(settings.drive));
    sel('sPreset', Object.entries(cfg.timePresets).map(([k, v]) => [k, `${v.label} (dial ${k})`]), settings.preset);
    $('sReport').checked = settings.showReport !== false; $('sGreen').checked = settings.green !== false;
    $('sCamera').checked = settings.camera; $('sShowCam').checked = settings.showCam; $('sDebug').checked = settings.debug;
    $('remoteCode').textContent = settings.code;
    $('layoutInfo').textContent = '';
    const upd = () => {
      Object.assign(settings, {
        participant: $('sParticipant').value, condition: $('sCondition').value, route: $('sRoute').value,
        layout: $('sLayout').value, drive: parseInt($('sDrive').value, 10), preset: $('sPreset').value,
        camera: $('sCamera').checked, showReport: $('sReport').checked, showCam: $('sShowCam').checked, debug: $('sDebug').checked, green: $('sGreen').checked
      });
      store.set('rr_settings', settings);
      const L = cfg.layouts[settings.layout];
      $('layoutInfo').textContent = `Kangaroos: ${L.roos}. Jump-out: ${L.jump}.` + (settings.condition === 'B' ? ` Scripted: ${L.scripted}.` : ' No false alarm in A.');
    };
    document.querySelectorAll('#setup select, #setup input').forEach(e => e.addEventListener('change', upd));
    upd();
    $('btnStart').onclick = startDrive;
    $('btnCalib').onclick = calibrate;
    $('motionInfo').textContent = `stop < ${cfg.motion.stopThreshold.toFixed(1)}, move > ${cfg.motion.moveThreshold.toFixed(1)}`;
    $('btnExportAll').onclick = exportAll;
    $('btnNewCode').onclick = () => { settings.code = Math.random().toString(36).slice(2, 7); store.set('rr_settings', settings); $('remoteCode').textContent = settings.code; RR.remote.connect(cfg.ntfyBase, settings.code, onCommand, ok => setChip('chipRemote', ok ? 'Remote: connected' : 'Remote: offline', ok)); };
  }

  /* Keep the car still for 3 s: measures camera noise and sets the stop / move thresholds. */
  async function calibrate() {
    alertBox('Calibrating: keep the car completely still for 3 seconds...');
    try {
      await RR.vision.startCamera($('video'));
      const vals = [];
      await new Promise(r => setTimeout(r, 600)); RR.vision.motion();
      await new Promise(r => { const iv = setInterval(() => { vals.push(RR.vision.motion()); if (vals.length >= 30) { clearInterval(iv); r(); } }, 100); });
      RR.vision.stopCamera();
      vals.sort((a, b) => a - b);
      const p95 = vals[Math.floor(vals.length * 0.95)];
      const stop = Math.max(1.2, p95 * 1.6), move = Math.max(stop * 2, stop + 2);
      settings.motion = { stopThreshold: +stop.toFixed(2), moveThreshold: +move.toFixed(2) };
      Object.assign(cfg.motion, settings.motion); store.set('rr_settings', settings);
      $('motionInfo').textContent = `stop < ${stop.toFixed(1)}, move > ${move.toFixed(1)}`;
      alertBox(`Calibrated. Still-camera noise ${p95.toFixed(2)}. Now push the car and check "motion" in the debug overlay goes above ${move.toFixed(1)}.`);
    } catch (e) { alertBox('Calibration failed: ' + e.message); }
  }

  function exportAll() {
    let all = [];
    try { all = JSON.parse(localStorage.getItem('rr_archive') || '[]'); } catch (e) { /* ignore */ }
    if (!all.length) { alertBox('No saved drives on this phone yet.'); return; }
    all.forEach((d, i) => setTimeout(() => RR.fx.download(d.filename, d.csv), i * 400));
  }
  function alertBox(t) { $('setupMsg').textContent = t; }

  /* ------------------------------------------------ drive */
  async function startDrive() {
    RR.fx.unlockAudio();
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('portrait'); } catch (e) { /* not supported */ }
    try { if (navigator.wakeLock) D_wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
    const route = routes[settings.route];
    D = {
      running: true, cond: settings.condition, route, markers: route.markers.map(m => ({ ...m })),
      t: null, lastIdx: 0, lastPassT: 0, speed: null, moving: false, stillSince: null, everMoved: false,
      zone: 'low', hist: [], rooActive: false, rooLastSeen: 0, muteNext: false, detBusy: false, lastDet: 0,
      finishedAt: null, live: null, timers: [], gB: null, gCount: 0
    };
    document.body.className = 'screen-drive cond-' + D.cond + (settings.showCam ? ' showcam' : '') + (settings.debug ? ' debug' : '');
    RR.log.start({
      participant: settings.participant, condition: settings.condition, route: settings.route, layout: settings.layout,
      drive: settings.drive, preset: settings.preset, timeLabel: cfg.timePresets[settings.preset].label,
      ua: navigator.userAgent, detector: RR.detector.loaded()
    });
    setPreset(settings.preset, 'setup');
    if (D.cond === 'B') initMap();
    if (settings.camera) {
      try {
        const v = await RR.vision.startCamera($('video'));
        RR.log.add('camera', v);
      } catch (e) { RR.log.add('error', { where: 'camera', msg: e.message }); toast('Camera failed: ' + e.message); }
      D.timers.push(setInterval(markerTick, 140));
      D.timers.push(setInterval(motionTick, 100));
      detLoop();
    }
    D.timers.push(setInterval(uiTick, 200));
    $('zoneChip').className = 'chip zone hidden'; $('limitSign').classList.add('hidden'); hideBanner();
    RR.remote.status(`START ${settings.participant} drive ${settings.drive} cond ${settings.condition} ${settings.route} ${settings.layout}`);
    toast(D.cond === 'B' ? 'Roo Radar is on. Drive safely.' : 'Drive as you normally would.');
  }
  let D_wake = null;

  function endDrive(reason) {
    if (!D || !D.running) return;
    D.running = false;
    D.timers.forEach(clearInterval);
    RR.vision.stopCamera();
    RR.log.add('drive_end', { reason, markersPassed: D.lastIdx });
    const trip = tripReport(RR.log.events);
    RR.log.add('trip_report', Object.assign({ shown: D.cond === 'B' && settings.showReport }, trip));
    RR.log.archive();
    renderTrip(trip);
    RR.remote.status(`END ${settings.participant} drive ${settings.drive} (${reason})`);
    try { if (D_wake) D_wake.release(); } catch (e) { /* ignore */ }
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
    document.body.className = 'screen-end';
    $('endSummary').textContent = `${settings.participant}, drive ${settings.drive}, condition ${settings.condition}, ${settings.route}, layout ${settings.layout}. Events logged: ${RR.log.events.length}.`;
    $('btnDownload').onclick = () => RR.fx.download(RR.log.filename(), RR.log.csv());
    $('btnShare').onclick = async () => {
      try {
        const file = new File([RR.log.csv()], RR.log.filename(), { type: 'text/csv' });
        await navigator.share({ files: [file], title: RR.log.filename() });
      } catch (e) { RR.fx.download(RR.log.filename(), RR.log.csv()); }
    };
    $('btnBack').onclick = () => {
      if (settings.drive === 1) settings.drive = 2; else if (settings.drive === 2) settings.drive = 1;
      settings.condition = settings.condition === 'A' ? 'B' : 'A';
      settings.route = settings.route === 'R1' ? 'R2' : 'R1';
      settings.layout = settings.layout === 'X' ? 'Y' : 'X';
      store.set('rr_settings', settings);
      document.body.className = 'screen-setup'; buildSetup();
    };
  }

  /* ------------------------------------------------ trip report (feedback to the driver) */
  function tripReport(ev) {
    const alerts = ev.filter(e => e.event === 'roo_alert');
    const stops = ev.filter(e => e.event === 'stop').map(e => e.detail.stopped_at_ms != null ? e.detail.stopped_at_ms : e.t_ms);
    const rts = [];
    let inTime = 0;
    for (const a of alerts) {
      const s = stops.find(t => t >= a.t_ms && t - a.t_ms <= 4000);
      if (s !== undefined) { inTime++; rts.push((s - a.t_ms) / 1000); }
    }
    const passes = ev.filter(e => e.event === 'marker_pass' && e.detail.speed_kmh != null);
    const avg = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const zone = passes.filter(e => e.detail.level !== 'low').map(e => e.detail.speed_kmh);
    const out = passes.filter(e => e.detail.level === 'low').map(e => e.detail.speed_kmh);
    return {
      roo_alerts: alerts.length, stopped_in_time: inTime,
      mean_reaction_s: rts.length ? +(rts.reduce((a, b) => a + b, 0) / rts.length).toFixed(2) : null,
      speed_in_zones: avg(zone), speed_outside: avg(out),
      zone_alerts: ev.filter(e => e.event === 'zone_alert').length
    };
  }

  function renderTrip(t) {
    const box = $('tripReport');
    if (!(D.cond === 'B' && settings.showReport)) { box.classList.add('hidden'); return; }
    let msg = 'Thanks for driving with Roo Radar.';
    if (t.speed_in_zones != null && t.speed_outside != null) {
      const d = t.speed_outside - t.speed_in_zones;
      msg = d >= 5 ? `You slowed down by about ${d} km/h in kangaroo zones. Slower speeds give you more time to stop.`
        : 'Your speed was about the same inside and outside kangaroo zones. Slowing down at dusk gives you more time to stop.';
    }
    box.innerHTML = `<h3>Your trip report</h3>
      <div class="trip-grid">
        <div><b>${t.roo_alerts}</b><span>kangaroo alerts</span></div>
        <div><b>${t.stopped_in_time} of ${t.roo_alerts}</b><span>stopped within 4 s</span></div>
        <div><b>${t.mean_reaction_s != null ? t.mean_reaction_s.toFixed(1) + ' s' : '-'}</b><span>average time to stop</span></div>
        <div><b>${t.speed_in_zones != null ? t.speed_in_zones : '-'} / ${t.speed_outside != null ? t.speed_outside : '-'}</b><span>km/h in zones / outside</span></div>
      </div>
      <p>${msg}</p><p class="note">Simulation: toy-car speeds are scaled, not real km/h.</p>`;
    box.classList.remove('hidden');
  }

  /* ------------------------------------------------ time + evidence */
  function setPreset(id, source) {
    const preset = cfg.timePresets[id]; if (!preset) return;
    settings.preset = id;
    D.t = RR.risk.simTime(preset);
    for (const m of D.markers) Object.assign(m, RR.risk.riskAt(m.lat, m.lon, D.t), { ev: RR.risk.evidenceLocal(m.lat, m.lon, D.t, cfg.evidenceRadiusM) });
    RR.log.add('time_set', { preset: id, label: preset.label, season: D.t.season, period: D.t.period, source, levels: D.markers.map(m => m.level[0].toUpperCase()).join('') });
    $('timeChip').textContent = `${preset.label} · ${D.t.period}`;
    $('timeChipBase').textContent = preset.label;
    if (D.cond === 'B') drawRisk();
    prefetchLive();
  }

  async function prefetchLive() {
    const t = D.t, myT = t;
    setChip('chipData', 'ACT data: checking', true);
    try {
      const res = await Promise.all(D.markers.map(m => RR.risk.evidenceLive(cfg.actApi, m.lat, m.lon, t, cfg.evidenceRadiusM)));
      if (D.t !== myT) return;
      res.forEach((r, i) => { D.markers[i].ev = r; });
      D.live = true; setChip('chipData', 'LIVE ACT data', true);
      RR.log.add('evidence', { source: 'live', counts: res.map(r => `${r.total}/${r.match}`).join(' ') });
    } catch (e) {
      D.live = false; setChip('chipData', 'ACT data: offline copy', false, e.message);
      RR.log.add('evidence', { source: 'offline', error: e.message, counts: D.markers.map(m => `${m.ev.total}/${m.ev.match}`).join(' ') });
    }
  }

  /* ------------------------------------------------ markers = simulated GPS */
  function markerTick() {
    if (!D || !D.running) return;
    let found;
    try { found = RR.vision.readMarkers(); } catch (e) { return; }
    if (settings.debug) $('dbgMarkers').textContent = found.map(f => `#${f.id}`).join(' ') || '-';
    for (const f of found) {
      if (cfg.timePresets[String(f.id)]) { if (String(f.id) !== settings.preset) { setPreset(String(f.id), 'dial'); toast('Time: ' + cfg.timePresets[String(f.id)].label); } continue; }
      if (settings.green) continue;          // green-card counting is in charge of marker passes
      const idx = cfg.routeMarkerIds.indexOf(f.id) + 1;
      if (idx > D.lastIdx) passMarker(idx, 'camera', f);
    }
    if (settings.green) greenTick();
  }

  /* Green M-cards lying on the road edge. Several trip lines across the left of the view each count the
     cards crossing them; whichever line has counted the most is used, so the phone's tilt does not matter.
     Cards are counted in order (M1, M2, ...); a card the camera misses can be added with N. */
  function greenTick() {
    const G = cfg.green || {}, lines = G.lines || [0.5, 0.6, 0.7, 0.8, 0.9], now = performance.now();
    const fs = RR.vision.greenBands(lines, G.band || 0.05);
    if (!D.gB) D.gB = lines.map(() => ({ base: [], on: false, n: 0, last: 0 }));
    if (settings.debug) $('dbgGreen').textContent = fs.map(f => Math.round(f * 100)).join('/');
    fs.forEach((f, i) => {
      const B = D.gB[i];
      if (B.base.length < 8) { B.base.push(f); return; }            // first second at START = background
      const base = B.base.slice().sort((a, b) => a - b)[3];
      if (!B.on && f > base + (G.on || 0.08)) B.on = true;
      else if (B.on && f < base + (G.off || 0.03)) {
        B.on = false;
        if (now - B.last > (G.minGapMs || 900)) { B.n++; B.last = now; }
      }
    });
    const best = Math.max(...D.gB.map(B => B.n));
    if (best > D.gCount) {
      D.gCount = best;
      if (D.lastIdx < D.markers.length) passMarker(D.lastIdx + 1, 'green', { size: Math.max(...fs) });
    }
  }

  function passMarker(idx, source, f) {
    const now = performance.now();
    let speed = null;
    if (D.lastIdx > 0) {
      const dt = (now - D.lastPassT) / 1000;
      const cmPerS = (idx - D.lastIdx) * cfg.markerSpacingCm / Math.max(dt, 0.05);
      speed = Math.min(199, Math.round(cmPerS * cfg.speedScaleKmhPerCmS));
      D.speed = speed;
    }
    D.lastIdx = idx; D.lastPassT = now;
    const m = D.markers[idx - 1];
    RR.log.add('marker_pass', { source, speed_kmh: speed, level: m.level, risk: +m.value.toFixed(4), ev_total: m.ev.total, ev_match: m.ev.match, ev_source: m.ev.source, size: f ? +f.size.toFixed(3) : null }, `M${idx}`);
    if (D.cond === 'B') moveCar(m);
    zoneLogic(idx, m);
    if (idx === D.markers.length) D.finishedAt = now;
    if (settings.debug) { RR.fx.vibrate(30); toast(`M${idx} read`); }   // test mode: confirm each marker
  }

  function zoneLogic(idx, m) {
    const rank = { low: 0, medium: 1, high: 2 };
    const prev = D.zone; D.zone = m.level;
    if (rank[m.level] > 0 && m.level !== prev) {
      const shown = D.cond === 'B';
      RR.log.add('zone_alert', { level: m.level, shown, ev_total: m.ev.total, ev_match: m.ev.match, ev_source: m.ev.source }, `M${idx}`);
      if (shown) showZone(m);
    } else if (m.level === 'low' && prev !== 'low') {
      RR.log.add('zone_exit', { shown: D.cond === 'B' }, `M${idx}`);
      if (D.cond === 'B') { hideBanner(); toast('Leaving kangaroo zone'); $('limitSign').classList.add('hidden'); $('zoneChip').className = 'chip zone hidden'; }
    }
  }

  function showZone(m) {
    const high = m.level === 'high';
    const adv = high ? cfg.speedAdvice.high : cfg.speedAdvice.medium;
    const when = RR.risk.phrase(D.t);
    const ev = m.ev.total > 0
      ? `Rangers recorded <b>${m.ev.total}</b> kangaroo incidents within 300 m of here since 2016, <b>${m.ev.match}</b> of them on ${when} like now.`
      : `Model predicts higher risk on ${when} here.`;
    banner(high ? 'high' : 'medium', high ? 'High kangaroo risk ahead' : 'Kangaroo risk ahead', ev, `Slow to ${adv} km/h and watch the verges.`, m.ev.source, 8000);
    const zc = $('zoneChip'); zc.textContent = high ? 'HIGH RISK ZONE' : 'KANGAROO ZONE'; zc.className = 'chip zone ' + (high ? 'high' : 'medium');
    $('limitSign').textContent = adv; $('limitSign').classList.remove('hidden');
    D.advice = adv;
    if (high) { RR.fx.sounds.zoneHigh(); RR.fx.vibrate([120, 80, 120]); RR.fx.say('High kangaroo risk ahead. Slow down.'); }
    else { RR.fx.sounds.chime(); RR.fx.vibrate(100); RR.fx.say('Kangaroo risk ahead.'); }
  }

  /* ------------------------------------------------ motion = braking */
  function motionTick() {
    if (!D || !D.running) return;
    const v = RR.vision.motion(), now = performance.now(), M = cfg.motion;
    if (settings.debug) $('dbgMotion').textContent = v.toFixed(1);
    if (v > M.moveThreshold) {
      D.stillSince = null;
      if (!D.moving) { D.moving = true; D.everMoved = true; RR.log.add('go', { motion: +v.toFixed(2) }); }
    } else if (v < M.stopThreshold && D.moving) {
      if (!D.stillSince) D.stillSince = now;
      else if (now - D.stillSince > M.stopHoldMs) {
        D.moving = false;
        RR.log.add('stop', { motion: +v.toFixed(2), stopped_at_ms: Math.round(D.stillSince - RR.log.t0) }, D.lastIdx ? `M${D.lastIdx}` : '');
      }
    }
    if (D.finishedAt && !D.moving && now - D.finishedAt > 2500) endDrive('finished');
  }

  /* ------------------------------------------------ detector loop */
  async function detLoop() {
    if (!D || !D.running) return;
    const vid = RR.vision.video();
    if (RR.detector.loaded() && vid && vid.videoWidth && !D.detBusy) {
      D.detBusy = true;
      try {
        const t0 = performance.now();
        const boxes = await RR.detector.detect(vid, vid.videoWidth, vid.videoHeight, cfg.detector.cropTop || 0);
        if (settings.debug) $('dbgDet').textContent = `${Math.round(performance.now() - t0)} ms, ${boxes.length} box`;
        onBoxes(boxes, 'model');
      } catch (e) { RR.log.add('error', { where: 'detector', msg: e.message }); }
      D.detBusy = false;
    }
    setTimeout(detLoop, cfg.detector.minGapMs);
  }

  function classify(b) {
    const cx = (b.x1 + b.x2) / 2;
    return (cx > 0.3 && cx < 0.7) ? 'on_road' : 'roadside';
  }

  function onBoxes(boxes, source) {
    // ignore boxes that fill most of the frame (camera blocked or something right against the lens)
    boxes = boxes.filter(b => (b.x2 - b.x1) * (b.y2 - b.y1) <= (cfg.detector.maxBoxArea || 1));
    drawBoxes(boxes);
    const now = performance.now();
    D.hist.push(boxes.length > 0); if (D.hist.length > 3) D.hist.shift();
    if (boxes.length) D.rooLastSeen = now;
    const confirmed = D.hist.filter(Boolean).length >= 2;
    if (!D.rooActive && confirmed && boxes.length) {
      D.rooActive = true;
      const b = boxes[0], cls = classify(b);
      announceRoo(cls, { source, conf: +b.conf.toFixed(3), box: [b.x1, b.y1, b.x2, b.y2].map(x => +x.toFixed(3)) });
    } else if (D.rooActive && now - D.rooLastSeen > 1500) {
      D.rooActive = false; RR.log.add('roo_lost', {}, D.lastIdx ? `M${D.lastIdx}` : '');
    }
  }

  function announceRoo(cls, detail) {
    const mk = D.lastIdx ? `M${D.lastIdx}` : '';
    RR.log.add('roo_detect', Object.assign({ cls }, detail), mk);
    if (D.cond !== 'B') return;
    if (D.muteNext) { D.muteNext = false; RR.log.add('roo_suppressed', { cls, woz: true }, mk); return; }
    rooAlert(cls);
    RR.log.add('roo_alert', { cls, source: detail.source }, mk);
    RR.remote.status(`ALERT ${cls} at ${mk}`);
  }

  function rooAlert(cls) {
    if (cls === 'on_road') {
      $('flash').classList.remove('hidden'); $('flash').classList.add('on');
      RR.fx.sounds.brake(); RR.fx.vibrate([400, 120, 400]); RR.fx.say('Kangaroo! Brake!');
      setTimeout(() => { $('flash').classList.add('hidden'); $('flash').classList.remove('on'); }, 2200);
    } else {
      banner('roo', 'Kangaroo beside the road', 'The camera has spotted a kangaroo near the road ahead.', 'Slow down and be ready to brake.', null, 3000);
      RR.fx.sounds.roadside(); RR.fx.vibrate(250); RR.fx.say('Kangaroo beside the road.');
    }
  }

  /* ------------------------------------------------ commands (remote / keyboard) */
  function onCommand(c) {
    if (!D || !D.running) { if (c.toUpperCase() === 'PING') RR.remote.status('PONG (setup screen)'); return; }
    const mk = D.lastIdx ? `M${D.lastIdx}` : '';
    switch (c.toUpperCase()) {
      case 'F': RR.log.add('woz_false_alarm', {}, mk); if (D.cond === 'B') { rooAlert('on_road'); RR.log.add('roo_alert', { cls: 'on_road', source: 'woz_false_alarm' }, mk); } RR.remote.status('OK F at ' + mk); break;
      case 'M': D.muteNext = true; RR.log.add('woz_mute_armed', {}, mk); RR.remote.status('OK M armed at ' + mk); break;
      case 'K': D.muteNext = false; announceRoo('on_road', { source: 'woz_forced' }); RR.remote.status('OK K at ' + mk); break;
      case 'N': passMarker(Math.min(D.lastIdx + 1, D.markers.length), 'woz_manual'); RR.remote.status('OK N to M' + D.lastIdx); break;
      case 'END': endDrive('remote'); break;
      case 'PING': RR.remote.status(`PONG ${settings.participant} drive ${settings.drive} at ${mk || 'start'}`); break;
      default: break;
    }
  }

  function onKey(e) {
    if (!D || !D.running) return;
    const k = e.key.toLowerCase();
    if (['f', 'm', 'k', 'n'].includes(k)) return onCommand(k);
    if (k === 'escape') return endDrive('key');
    if (!settings.debug) return;
    if (k === 'r') announceRoo('on_road', { source: 'sim' });
    if (k === 'd') announceRoo('roadside', { source: 'sim' });
    if (k === 's') { D.moving = false; RR.log.add('stop', { sim: true, stopped_at_ms: Math.round(performance.now() - RR.log.t0) }, `M${D.lastIdx}`); }
    if (k === 'g') { D.moving = true; RR.log.add('go', { sim: true }); }
  }

  /* ------------------------------------------------ UI */
  function uiTick() {
    if (!D || !D.running) return;
    const sp = !D.moving && D.everMoved ? 0 : D.speed;
    $('speed').textContent = sp === null ? '--' : sp;
    $('speedBase').textContent = sp === null ? '--' : sp;
    const over = D.cond === 'B' && D.zone !== 'low' && sp > (D.advice || 999) + 5;
    $('speedBox').classList.toggle('over', !!over);
    $('markerChip').textContent = D.lastIdx ? `Beacon M${D.lastIdx} of ${D.markers.length}` : 'Waiting for first beacon';
  }

  let bannerTimer = null;
  function banner(kind, title, body, advice, source, autoHideMs) {
    const b = $('banner');
    b.className = 'banner ' + kind;
    b.innerHTML = `<div class="b-title">${title}</div><div class="b-body">${body}</div><div class="b-adv">${advice}</div>` +
      (source ? `<div class="b-src">${source === 'live' ? 'Live ACT Government data' : 'ACT Government data (offline copy)'} · prediction: Roo Radar model</div>` : '');
    clearTimeout(bannerTimer);
    if (autoHideMs) bannerTimer = setTimeout(hideBanner, autoHideMs);
  }
  function hideBanner() { $('banner').className = 'banner hidden'; }
  let toastTimer = null;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2500); }

  function drawBoxes(boxes) {
    const c = $('overlay'), v = RR.vision.video(); if (!c || !v) return;
    c.width = c.clientWidth; c.height = c.clientHeight;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    if (D.cond !== 'B') return;
    g.lineWidth = 3; g.font = '600 13px system-ui';
    for (const b of boxes) {
      const on = classify(b) === 'on_road';
      g.strokeStyle = on ? '#ff3b30' : '#ffb020'; g.fillStyle = g.strokeStyle;
      g.strokeRect(b.x1 * c.width, b.y1 * c.height, (b.x2 - b.x1) * c.width, (b.y2 - b.y1) * c.height);
      g.fillText(`kangaroo ${Math.round(b.conf * 100)}%`, b.x1 * c.width + 3, Math.max(14, b.y1 * c.height - 4));
    }
  }

  /* ------------------------------------------------ map */
  const LEVEL_COLOUR = { high: '#e5484d', medium: '#f5a524', low: '#3b82f6' };
  function initMap() {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 50);
    mapLayers.forEach(l => map.removeLayer(l)); mapLayers = [];
    const pts = D.markers.map(m => [m.lat, m.lon]);
    const line = L.polyline(pts, { color: '#9aa4b2', weight: 5, opacity: 0.8 }).addTo(map); mapLayers.push(line);
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
    const coords = D.markers.map(m => `${m.lon},${m.lat}`).join(';');
    fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)
      .then(r => r.json()).then(js => {
        if (!js.routes || !js.routes[0]) return;
        line.setLatLngs(js.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
      }).catch(() => {});
    if (carMarker) map.removeLayer(carMarker);
    carMarker = L.marker(pts[0], { icon: L.divIcon({ className: 'car-icon', html: '<div></div>', iconSize: [22, 22] }) }).addTo(map);
    drawRisk();
  }
  function drawRisk() {
    if (!map) return;
    mapLayers.filter(l => l.options && l.options.rrHalo).forEach(l => map.removeLayer(l));
    mapLayers = mapLayers.filter(l => !(l.options && l.options.rrHalo));
    for (const m of D.markers) {
      const c = L.circle([m.lat, m.lon], { radius: cfg.evidenceRadiusM, color: LEVEL_COLOUR[m.level], fillColor: LEVEL_COLOUR[m.level], fillOpacity: m.level === 'low' ? 0.08 : 0.3, weight: 1, rrHalo: true }).addTo(map);
      mapLayers.push(c);
    }
  }
  function moveCar(m) {
    if (!carMarker) return;
    const from = carMarker.getLatLng(), to = L.latLng(m.lat, m.lon), t0 = performance.now();
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / 600);
      carMarker.setLatLng([from.lat + (to.lat - from.lat) * f, from.lng + (to.lng - from.lng) * f]);
      if (f < 1) requestAnimationFrame(step);
    };
    step();
    map.panTo(to, { animate: true, duration: 0.6 });
  }

  /* expose a little for testing */
  RR.app = { onCommand, passMarker: (i) => passMarker(i, 'test'), state: () => D, settings };
  window.addEventListener('load', boot);
})(window.RR);
