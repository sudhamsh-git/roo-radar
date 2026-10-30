# Roo Radar prototype app

A browser app for an Android phone (Chrome). The phone sits on a cardboard car and is pushed along a printed road.

- **Simulated GPS:** printed ArUco beacons M1–M12 along the paper road map to real coordinates on two Canberra routes (`data/routes.json`). The time between beacons gives the speed.
- **Time dial:** markers 40–45 set the simulated date and time (season + dawn/day/dusk/night).
- **Risk alerts:** a Poisson gradient-boosting model trained on 32k ACT ranger kangaroo incidents (`materials/analysis/risk_model.py`) gives a risk level per location and time (`data/risk_grid.json`). The evidence text comes live from the ACT Government open-data API (Socrata, dataset `qw4j-6rbq`), with an offline copy (`data/roo_points.json`) as backup.
- **Camera detection:** a YOLOv8n model fine-tuned on kangaroo images (`models/roo_detector.onnx`, trained with `materials/prototype/detector/train_kangaroo_detector.ipynb`) runs in the browser with onnxruntime-web.
- **Braking:** frame-to-frame motion of the camera image detects when the car stops.
- **Condition A** (baseline): the app runs silently, logs everything and shows only the speed. **Condition B**: full Roo Radar.
- **Researcher control:** `control.html` on a laptop sends Wizard-of-Oz commands (F false alarm, M mute next roo, K force roo alert, N next beacon, END) through ntfy.sh, using the code on the phone's setup screen. A Bluetooth keyboard paired to the phone also works (same keys).
- **Logs:** every drive downloads as a CSV and is also saved on the phone.

## Hosting on GitHub Pages (camera needs https)

1. On github.com, create a new **public** repository called `roo-radar`.
2. *Add file → Upload files*, and drag in everything inside this `app` folder (`index.html`, `control.html`, `css`, `js`, `vendor`, `data`, `models`). Commit.
3. *Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save*.
4. After about a minute the app is at `https://<username>.github.io/roo-radar/` and the console at `https://<username>.github.io/roo-radar/control.html`.

## Testing at a desk

Tick **Debug overlay** on the setup screen. During a drive, keys on a connected keyboard: `n` next beacon, `r` kangaroo on road, `d` kangaroo roadside, `s` stop, `g` go, `f`/`m`/`k` Wizard-of-Oz, `Esc` end.

## Third-party code

- js-aruco2 (MIT), `vendor/aruco/`
- Leaflet 1.9.4 (BSD-2-Clause), `vendor/leaflet/`
- onnxruntime-web 1.20.1 (MIT), loaded from the jsDelivr CDN
- Map tiles © OpenStreetMap contributors; routing from the public OSRM demo server
