/* Roo Radar: time, risk lookup and evidence (live ACT API with offline fallback). */
window.RR = window.RR || {};

(function (RR) {
  const SEASONS = ['summer', 'autumn', 'winter', 'spring'];
  const SEASON_MONTHS = { summer: [12, 1, 2], autumn: [3, 4, 5], winter: [6, 7, 8], spring: [9, 10, 11] };
  const PERIODS = ['dawn', 'day', 'dusk', 'night'];
  const CBR = { lat: -35.28, lon: 149.13 };

  function seasonOf(month) {
    if ([12, 1, 2].includes(month)) return 'summer';
    if ([3, 4, 5].includes(month)) return 'autumn';
    if ([6, 7, 8].includes(month)) return 'winter';
    return 'spring';
  }

  /* Sunrise and sunset in Canberra local clock hours (NOAA approximation, same as risk_model.py). */
  function sunHours(month, day) {
    const date = new Date(Date.UTC(2026, month - 1, day));
    const n = Math.floor((date - Date.UTC(2026, 0, 0)) / 86400000);
    const g = 2 * Math.PI / 365 * (n - 1);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const lat = CBR.lat * Math.PI / 180;
    const ha = Math.acos(Math.cos(90.833 * Math.PI / 180) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) * 180 / Math.PI;
    const riseUtcMin = 720 - 4 * (CBR.lon + ha) - eq;
    const setUtcMin = 720 - 4 * (CBR.lon - ha) - eq;
    // AEST is UTC+10; daylight saving (UTC+11) runs from early October to early April
    const dst = month >= 10 || month <= 3;
    const off = dst ? 11 * 60 : 10 * 60;
    return { rise: ((riseUtcMin + off) / 60 + 24) % 24, set: ((setUtcMin + off) / 60 + 24) % 24 };
  }

  function periodOf(month, day, hourFloat) {
    const s = sunHours(month, day);
    if (hourFloat >= s.rise - 1.5 && hourFloat < s.rise + 3) return 'dawn';
    if (hourFloat >= s.rise + 3 && hourFloat < s.set - 1.5) return 'day';
    if (hourFloat >= s.set - 1.5 && hourFloat < s.set + 2.5) return 'dusk';
    return 'night';
  }

  /* Whole-hour window (inclusive) for a period, used for the evidence query. */
  function periodHourWindow(month, day, period) {
    const s = sunHours(month, day);
    const w = {
      dawn: [s.rise - 1.5, s.rise + 3], day: [s.rise + 3, s.set - 1.5],
      dusk: [s.set - 1.5, s.set + 2.5], night: [s.set + 2.5, s.rise - 1.5 + 24]
    }[period];
    const h1 = Math.floor(w[0]) % 24, h2 = (Math.ceil(w[1]) - 1 + 24) % 24;
    return { h1, h2, wraps: h2 < h1 };
  }

  function simTime(preset) {
    const hourFloat = preset.hour + preset.minute / 60;
    const season = seasonOf(preset.month);
    const period = periodOf(preset.month, preset.day, hourFloat);
    return {
      label: preset.label, month: preset.month, day: preset.day, hourFloat, season, period,
      si: SEASONS.indexOf(season), pi: PERIODS.indexOf(period),
      window: periodHourWindow(preset.month, preset.day, period), months: SEASON_MONTHS[season]
    };
  }

  function phrase(t) {
    return { dawn: `${t.season} mornings around dawn`, day: `${t.season} days`, dusk: `${t.season} evenings around dusk`, night: `${t.season} nights` }[t.period];
  }

  /* ---------- risk grid ---------- */
  let grid = null;
  function setGrid(g) { grid = g; }
  function riskAt(lat, lon, t) {
    const gy = Math.floor(lat / grid.cell_lat), gx = Math.floor(lon / grid.cell_lon);
    let best = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = grid.cells[`${gy + dy},${gx + dx}`];
      if (v) best = Math.max(best, v[t.si * 4 + t.pi]);
    }
    const level = best >= grid.thresholds.high ? 'high' : best >= grid.thresholds.medium ? 'medium' : 'low';
    return { value: best, level };
  }

  /* ---------- evidence ---------- */
  let points = null;
  function setPoints(p) { points = p.rows; }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function inWindow(h, w) { return w.wraps ? (h >= w.h1 || h <= w.h2) : (h >= w.h1 && h <= w.h2); }
  function evidenceLocal(lat, lon, t, radius) {
    let total = 0, match = 0;
    for (const r of points) {
      if (Math.abs(r[0] - lat) > 0.004 || Math.abs(r[1] - lon) > 0.005) continue;
      if (haversine(lat, lon, r[0], r[1]) > radius) continue;
      total++;
      if (t.months.includes(r[2]) && inWindow(r[3], t.window)) match++;
    }
    return { total, match, source: 'offline' };
  }

  async function fetchCount(api, where, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const url = `${api}?$select=count(*)&$where=${encodeURIComponent(where)}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const js = await res.json();
      return parseInt(js[0].count, 10);
    } finally { clearTimeout(timer); }
  }

  async function evidenceLive(api, lat, lon, t, radius, timeoutMs = 5000) {
    const base = `species='EASTERN GREY KANGAROO' AND within_circle(geocoded_column,${lat},${lon},${radius})`;
    const hrs = t.window.wraps
      ? `(date_extract_hh(created_date) >= ${t.window.h1} OR date_extract_hh(created_date) <= ${t.window.h2})`
      : `date_extract_hh(created_date) between ${t.window.h1} and ${t.window.h2}`;
    const timeCond = `${base} AND date_extract_m(created_date) in (${t.months.join(',')}) AND ${hrs}`;
    const [total, match] = await Promise.all([fetchCount(api, base, timeoutMs), fetchCount(api, timeCond, timeoutMs)]);
    return { total, match, source: 'live' };
  }

  RR.risk = { SEASONS, PERIODS, simTime, phrase, setGrid, riskAt, setPoints, evidenceLocal, evidenceLive, sunHours };
})(window.RR);
