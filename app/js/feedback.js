/* Roo Radar: sound, voice, vibration, plus the event logger and remote control (ntfy.sh). */
window.RR = window.RR || {};

(function (RR) {
  /* ---------------- sound / voice / vibration ---------------- */
  let actx = null;
  function unlockAudio() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
    } catch (e) { /* audio unavailable */ }
  }
  function tone(freq, start, dur, type = 'sine', gain = 0.25) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, actx.currentTime + start);
    g.gain.linearRampToValueAtTime(gain, actx.currentTime + start + 0.02);
    g.gain.linearRampToValueAtTime(0, actx.currentTime + start + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(actx.currentTime + start); o.stop(actx.currentTime + start + dur + 0.05);
  }
  const sounds = {
    chime: () => { tone(660, 0, 0.25); tone(880, 0.22, 0.35); },
    zoneHigh: () => { tone(740, 0, 0.2, 'triangle', 0.3); tone(740, 0.28, 0.2, 'triangle', 0.3); tone(990, 0.56, 0.4, 'triangle', 0.3); },
    roadside: () => { tone(880, 0, 0.18, 'square', 0.18); tone(880, 0.25, 0.18, 'square', 0.18); },
    brake: () => { for (let i = 0; i < 5; i++) tone(i % 2 ? 1300 : 1000, i * 0.16, 0.14, 'sawtooth', 0.3); }
  };
  function say(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = speechSynthesis.getVoices().find(x => /en-AU/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.rate = 1.05; speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

  /* ---------------- logger ---------------- */
  const log = {
    meta: null, events: [], t0: 0,
    start(meta) { this.meta = meta; this.events = []; this.t0 = performance.now(); this.add('drive_start', meta); },
    add(type, detail = {}, marker = '') {
      const e = { t_ms: Math.round(performance.now() - this.t0), iso: new Date().toISOString(), event: type, marker, detail };
      this.events.push(e);
      try { localStorage.setItem('rr_current_drive', JSON.stringify({ meta: this.meta, events: this.events })); } catch (err) { /* storage unavailable */ }
      if (RR.onLog) RR.onLog(e);
      return e;
    },
    csv() {
      const m = this.meta || {};
      const head = ['participant', 'condition', 'route', 'layout', 'drive', 'time_preset', 't_ms', 'iso_time', 'event', 'marker', 'detail_json'];
      const esc = v => `"${String(v).replace(/"/g, '""')}"`;
      const rows = this.events.map(e => [m.participant, m.condition, m.route, m.layout, m.drive, m.timeLabel, e.t_ms, e.iso, e.event, e.marker, JSON.stringify(e.detail)].map(esc).join(','));
      return head.join(',') + '\n' + rows.join('\n') + '\n';
    },
    filename() {
      const m = this.meta || {};
      const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      return `${m.participant}_drive${m.drive}_${m.condition}_${m.route}_${m.layout}_${ts}.csv`;
    },
    archive() {
      try {
        const all = JSON.parse(localStorage.getItem('rr_archive') || '[]');
        all.push({ filename: this.filename(), csv: this.csv() });
        localStorage.setItem('rr_archive', JSON.stringify(all));
      } catch (e) { /* storage unavailable */ }
    }
  };

  function download(filename, text, type = 'text/csv') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- remote control via ntfy.sh ---------------- */
  const remote = {
    es: null, topic: null, base: null,
    connect(base, code, onCommand, onState) {
      this.base = base; this.topic = `roo-radar-${code}`;
      try { if (this.es) this.es.close(); } catch (e) { /* ignore */ }
      try {
        this.es = new EventSource(`${base}/${this.topic}/sse`);
        this.es.onopen = () => onState && onState(true);
        this.es.onerror = () => onState && onState(false);
        this.es.onmessage = ev => {
          try { const m = JSON.parse(ev.data); if (m.event === 'message' && m.message) onCommand(m.message.trim()); } catch (e) { /* ignore */ }
        };
      } catch (e) { onState && onState(false); }
    },
    status(text) {
      if (!this.topic) return;
      fetch(`${this.base}/${this.topic}-status`, { method: 'POST', body: text }).catch(() => {});
    }
  };

  RR.fx = { unlockAudio, sounds, say, vibrate, download };
  RR.log = log;
  RR.remote = remote;
})(window.RR);
