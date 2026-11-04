/* Roo Radar: camera, marker reading (simulated GPS + time dial) and motion (stop detection). */
window.RR = window.RR || {};

(function (RR) {
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const tiny = document.createElement('canvas');
  const tctx = tiny.getContext('2d', { willReadFrequently: true });
  tiny.width = 64; tiny.height = 36;
  let video = null, stream = null, detector = null, prevGray = null;

  async function startCamera(videoEl) {
    video = videoEl;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
    });
    video.srcObject = stream;
    await video.play();
    detector = new AR.Detector({ dictionaryName: 'ARUCO_4X4_1000' });
    return { width: video.videoWidth, height: video.videoHeight };
  }

  function stopCamera() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }

  /* Read markers. Passes rotate each call: the whole frame (downscaled), then the left and right
     sides at higher resolution, where the roadside markers appear when the phone is upright.
     Returns [{id, cx, cy, size}] normalised to the whole frame. */
  let pass = 0;
  function readMarkers() {
    if (!video || !video.videoWidth) return [];
    const VW = video.videoWidth, VH = video.videoHeight, portrait = VH > VW;
    const regions = portrait
      ? [[0, 0, 1, 1, 640], [0, 0.2, 0.6, 0.8, 900], [0.4, 0.2, 0.6, 0.8, 900]]
      : [[0, 0, 1, 1, 960]];
    const [rx, ry, rw, rh, maxW] = regions[pass++ % regions.length];
    const sx = rx * VW, sy = ry * VH, sw = rw * VW, sh = rh * VH;
    const s = Math.min(1, maxW / sw);
    const w = Math.round(sw * s), h = Math.round(sh * s);
    if (work.width !== w || work.height !== h) { work.width = w; work.height = h; }
    wctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    const found = detector.detect(wctx.getImageData(0, 0, w, h));
    return found.map(m => {
      const xs = m.corners.map(c => c.x), ys = m.corners.map(c => c.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 / w, cy = (Math.min(...ys) + Math.max(...ys)) / 2 / h;
      return { id: m.id, cx: rx + cx * rw, cy: ry + cy * rh, size: (Math.max(...xs) - Math.min(...xs)) / w * rw };
    });
  }

  /* Share of "card green" pixels in thin bands across the left part of the view (one value per band). */
  const gcan = document.createElement('canvas'); gcan.width = 60; gcan.height = 200;
  const gctx = gcan.getContext('2d', { willReadFrequently: true });
  function greenBands(lines, band) {
    if (!video || !video.videoWidth) return lines.map(() => 0);
    const VW = video.videoWidth, VH = video.videoHeight;
    gctx.drawImage(video, 0, 0, 0.55 * VW, VH, 0, 0, 60, 200);
    const d = gctx.getImageData(0, 0, 60, 200).data;
    return lines.map(L => {
      const r0 = Math.max(0, Math.round((L - band / 2) * 200)), r1 = Math.min(200, Math.round((L + band / 2) * 200));
      let n = 0, t = 0;
      for (let y = r0; y < r1; y++) for (let x = 0; x < 60; x++) {
        const i = (y * 60 + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2]; t++;
        if (g > 18 && g > r * 1.35 && g > b * 1.3) n++;   // works in a dimmed room too
      }
      return t ? n / t : 0;
    });
  }

  /* Mean absolute difference between consecutive tiny grey frames (0-255). */
  function motion() {
    if (!video || !video.videoWidth) return 0;
    tctx.drawImage(video, 0, 0, 64, 36);
    const d = tctx.getImageData(0, 0, 64, 36).data;
    const g = new Uint8Array(64 * 36);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    let diff = 0;
    if (prevGray) { for (let i = 0; i < g.length; i++) diff += Math.abs(g[i] - prevGray[i]); diff /= g.length; }
    prevGray = g;
    return diff;
  }

  RR.vision = { startCamera, stopCamera, readMarkers, motion, video: () => video, greenBands };
})(window.RR);
