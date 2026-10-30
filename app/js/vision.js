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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    });
    video.srcObject = stream;
    await video.play();
    detector = new AR.Detector({ dictionaryName: 'ARUCO_4X4_1000' });
    return { width: video.videoWidth, height: video.videoHeight };
  }

  function stopCamera() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }

  /* Read markers on a downscaled frame. Returns [{id, cx, cy, size}] normalised. */
  function readMarkers(maxW = 560) {
    if (!video || !video.videoWidth) return [];
    const s = Math.min(1, maxW / video.videoWidth);
    const w = Math.round(video.videoWidth * s), h = Math.round(video.videoHeight * s);
    if (work.width !== w) { work.width = w; work.height = h; }
    wctx.drawImage(video, 0, 0, w, h);
    const img = wctx.getImageData(0, 0, w, h);
    const found = detector.detect(img);
    return found.map(m => {
      const xs = m.corners.map(c => c.x), ys = m.corners.map(c => c.y);
      return { id: m.id, cx: (Math.min(...xs) + Math.max(...xs)) / 2 / w, cy: (Math.min(...ys) + Math.max(...ys)) / 2 / h, size: (Math.max(...xs) - Math.min(...xs)) / w };
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

  RR.vision = { startCamera, stopCamera, readMarkers, motion, video: () => video };
})(window.RR);
