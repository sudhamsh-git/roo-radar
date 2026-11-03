/* Roo Radar: YOLOv8n kangaroo detector running in the browser with onnxruntime-web. */
window.RR = window.RR || {};

(function (RR) {
  let session = null, inputName = null, size = 320, cfg = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function load(config) {
    cfg = config.detector; size = cfg.inputSize;
    canvas.width = size; canvas.height = size;
    if (!window.ort) throw new Error('onnxruntime-web not loaded (no internet?)');
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(cfg.model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    inputName = session.inputNames[0];
    return true;
  }

  function iou(a, b) {
    const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return u > 0 ? inter / u : 0;
  }

  /* source: video or canvas. Returns boxes normalised to the source frame (0..1). */
  async function detect(source, srcW, srcH, y0 = 0) {
    if (!session) return [];
    const cropY = Math.round(y0 * srcH), cropH = srcH - cropY;          // only the part of the frame from y0 down
    const scale = Math.min(size / srcW, size / cropH);
    const w = Math.round(srcW * scale), h = Math.round(cropH * scale);
    const px = Math.floor((size - w) / 2), py = Math.floor((size - h) / 2);
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, 0, cropY, srcW, cropH, px, py, w, h);
    const rgba = ctx.getImageData(0, 0, size, size).data;
    const n = size * size, data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = rgba[i * 4] / 255; data[n + i] = rgba[i * 4 + 1] / 255; data[2 * n + i] = rgba[i * 4 + 2] / 255;
    }
    const out = await session.run({ [inputName]: new ort.Tensor('float32', data, [1, 3, size, size]) });
    const o = out[session.outputNames[0]];           // [1, 4 + classes, anchors]
    const [, ch, na] = o.dims, d = o.data;
    const boxes = [];
    for (let a = 0; a < na; a++) {
      let conf = 0;
      for (let c = 4; c < ch; c++) conf = Math.max(conf, d[c * na + a]);
      if (conf < cfg.confThreshold) continue;
      const bx = d[a], by = d[na + a], bw = d[2 * na + a], bh = d[3 * na + a];
      boxes.push({
        x1: Math.max(0, (bx - bw / 2 - px) / w), y1: y0 + (1 - y0) * Math.max(0, (by - bh / 2 - py) / h),
        x2: Math.min(1, (bx + bw / 2 - px) / w), y2: y0 + (1 - y0) * Math.min(1, (by + bh / 2 - py) / h), conf
      });
    }
    boxes.sort((a, b) => b.conf - a.conf);
    const keep = [];
    for (const b of boxes) if (keep.every(k => iou(k, b) < cfg.iouThreshold)) keep.push(b);
    return keep;
  }

  RR.detector = { load, detect, loaded: () => !!session };
})(window.RR);
