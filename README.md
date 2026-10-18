# LiDAR Learning Lab

A browser-based, hands-on simulation platform for a 60-minute workshop on **LiDAR, point clouds, TLS / MLS, SLAM, point-cloud processing, clustering and segmentation, image-to-3D reconstruction, scene graphs and AI reasoning**.

Participants explore 3D scenes, drive virtual LiDAR scanners (real ray casting against scene geometry), generate point clouds, process and segment them, register scans, compare LiDAR with image-based reconstruction and query a geometric scene graph. Everything runs in the browser: no server, database, authentication or AI API is needed.

**Live demo: https://maninka123.github.io/lidar-learning-lab/**

**Live tools bundled:** nine lecture-aligned tabs · three procedural scenes · PLY / PCD / LAS import · PLY / PCD export · 9 auto-checked challenges with JSON / PDF summary.

## Quick start

Requires **Node.js 20.19+ or 22+**.

```bash
npm install          # install dependencies
npm run dev          # development server → http://localhost:5173
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build → http://localhost:4173
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright; builds + serves the app itself)
npm run typecheck    # TypeScript only
```

First time running the end-to-end tests: `npx playwright install chromium`.

> Tip: keep the project on a normal local disk. Cloud-synced folders (OneDrive, iCloud, Dropbox) can make `node_modules` extremely slow.

## Tabs

| # | Tab | What you can do |
|---|-----|-----------------|
| 1 | **LiDAR Fundamentals** | Place and aim a scanner; set FOV, angular resolution, channels, min/max range, frequency, returns, noise and reflectivity; 3D and 2D-plan views, visible rays and hit points; compare point count, spacing, coverage and occlusion; presets incl. documented VLP-16, Ouster OS1 and Livox Mid-360 *example profiles*, plus prism (Risley), MEMS micro-mirror and solid-state-array scan architectures with a scan-pattern preview. |
| 2 | **Point Cloud Explorer** | XYZ / height / range / intensity / RGB / semantic / normal colouring, point picking with attributes, point-to-point distances, clipping and cropping, upload (PLY, PCD, LAS) and export (PLY, PCD). |
| 3 | **TLS & MLS Laboratory** | Tripod stations, overlap and missing-region visualisation, station registration error + ICP repair; moving platform with editable waypoints, time-dependent poses, animation and motion-distortion demo; TLS vs MLS comparison table. |
| 4 | **SLAM & Registration** | Closed-loop robot run with drift accumulation (noisy odometry or ICP scan matching), loop closure *teaching approximation*, manual rigid error controls, point-to-point ICP with iteration scrubber, RMSE and fitness. |
| 5 | **Point Cloud Processing** | Add/reorder/remove pipeline steps (crop, voxel, random downsample, noise, outliers, dropout, statistical & radius outlier removal, normals, rigid transform) on an **immutable original**; split comparison with synced cameras; deterministic seed; export. |
| 6 | **Clustering & Segmentation** | RANSAC planes, ground removal, Euclidean clustering, DBSCAN, parameter-sensitivity sweep, A/B comparison, over-/under-segmentation scoring against ground truth. |
| 7 | **Image to 3D** | Photo, LiDAR cloud, reconstruction, voxel-surface mesh, overlay and error map; synced split view; similarity alignment (rotation, translation **and scale**); error statistics only after a valid alignment. |
| 8 | **Scene Graphs & 3D AI** | Nodes with id, label, position, size, bbox, source, confidence; geometric relations (near, above, below, inside, left/right, intersects, blocks path); interactive graph ↔ 3D selection; deterministic offline question answering; notes on integrating a real LLM; link to the *local-llm-fit* model-fit tool. |
| 9 | **Challenges** | Nine automatically checked exercises, progress tracking, JSON/PDF summary download and a suggested 60-minute agenda. |

## What is real, and what is a teaching simplification

The lab is explicit about this inside the UI; the same rules apply here.

* **Scanning is real ray casting.** Each beam is cast against analytic boxes, cylinders and spheres; range is measured from the sensor origin, noise is added along the ray, and points are built from sensor-relative range and direction and transformed to world coordinates.
* **Intensity is a simplified model**, `I ≈ ρ·cosθ ÷ (1 + (r/r₀)²)`, and detection range scales with √reflectivity. It is not a calibrated physical return. Intensity and RGB are stored and rendered as separate attributes.
* **Commercial sensor profiles** (VLP-16, OS1, Mid-360) list public datasheet values and a list of simplifications. Illustrative scan patterns (hybrid mirror, solid-state rosette) do **not** reproduce any commercial pattern. Re-check current datasheets before quoting numbers.
* **SLAM** is a controlled-error teaching model. Loop closure = scan-to-scan ICP between last and first scan + linear distribution of the residual — not a pose-graph back-end, and nothing is prerecorded.
* **Segmentation:** RANSAC is rule-based geometry, Euclidean clustering and DBSCAN are unsupervised and know nothing about classes. The class labels shown are **ground-truth annotations written by the simulator**, not predictions of a trained model. The “rule-based class guess” is a deliberately crude size heuristic shown for contrast.
* **Image to 3D:** the photograph, depth maps, multi-view photogrammetry, RGB-D fusion and single-image-depth results are produced by in-browser simulations (ray-cast renders + depth-error models + depth-map fusion). **No NeRF, 3D Gaussian Splatting or generative-model outputs are bundled or faked.** You can upload your own prerecorded PLY/PCD and evaluate it with the same alignment and error tools.
* **Scene-graph questions** use an offline deterministic intent matcher, not an LLM. The tool contract a real LLM would use is documented in the app; an LLM would have to obtain every measurement from those geometric tools.

## Datasets

| Dataset | Source | Licence | Origin | Attributes |
|---|---|---|---|---|
| Scene A – room (8 × 6 × 3 m) | Procedural, this repo | MIT | Synthetic | geometry, class, instance, material reflectivity |
| Scene B – industrial workshop | Procedural, this repo | MIT | Synthetic | as above |
| Scene C – street | Procedural, this repo | MIT | Synthetic | as above, porous foliage (multi-return) |
| Bundled example clouds | Generated by the simulator | MIT | Synthetic | xyz, RGB, intensity, range, normals (GT), class, instance, time, scan id |
| User uploads | PLY (ascii/binary), PCD (ascii/binary/compressed), LAS 1.0–1.4 (uncompressed) | user's | Measured or synthetic (you choose) | whatever the file contains |

Units are metres; coordinates are right-handed, **Z-up**. Public datasets (e.g. Stanford 3D Scanning Repository, ETH TLS, Semantic3D, KITTI samples) are deliberately **not** bundled yet: download availability and redistribution terms still need to be verified for each. LAZ is not decoded in the browser — convert with `pdal translate in.laz out.las`.

## Performance

Designed for laptops without a dedicated GPU: typed arrays, `BufferGeometry` points, adjustable point budget and render budget (with automatic reduction when the frame rate drops), and Web Workers for scanning, processing, segmentation, ICP, SLAM and reconstruction. Target: responsive orbiting with ≈100 000 points. No large dataset is downloaded automatically.

## Architecture

```
src/
  core/           PRNG, math (rigid transforms, Horn/Umeyama fit, Jacobi eigen), k-d tree,
                  point-cloud model + attribute handling, colour mapping
  scenes/         scene definitions (room, industrial, outdoor), analytic ray caster,
                  surface sampling + coverage / occlusion classification
  sensor/         presets & documented profiles, scan patterns, simulator (poses over time)
  processing/     filters, noise/outliers, voxel, normals, pipeline runner
  segmentation/   RANSAC, Euclidean clustering, DBSCAN, GT evaluation
  registration/   ICP (optionally with scale), SLAM teaching simulation
  recon/          synthetic photo + depth-error models, fusion, voxel mesh, alignment, error stats
  graph/          scene graph builder, relations, query engine, layout
  io/             PLY / PCD / LAS readers, PLY / PCD writers
  engine/         task registry, Web Worker + client with main-thread fallback
  exercises/      challenge definitions, automatic checks, PDF writer
  state/          Zustand store, actions
  ui/, tabs/      React + React Three Fiber components, one file per lecture tab
tests/            Vitest unit tests (algorithms, IO, simulator, graph, SLAM, recon)
e2e/              Playwright browser tests (workshop walkthrough)
```

Stack: React, TypeScript, Vite, Three.js + React Three Fiber + Drei, Zustand, Tailwind CSS, Vitest, Playwright.

## Validation

Unit tests cover: ray distances to a known wall; FOV and angular resolution changing coverage; moving the scanner changing measurements; intensity distinct from RGB; downsampling reducing/preserving counts; reproducible noise; outlier filters removing injected outliers; RANSAC recovering a known plane; DBSCAN separating clusters; ICP recovering a known small rigid transform; scene-graph distances in world coordinates; PLY/PCD (ascii and binary) round-trips keeping attributes; SLAM drift and loop closure; reconstruction alignment. The Playwright suite walks through every tab.

## Deployment

The app is published automatically to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` → https://maninka123.github.io/lidar-learning-lab/ (one-time setup: repo **Settings → Pages → Source: GitHub Actions**).

`npm run build` produces a fully static site in `dist/` (relative asset paths), deployable to any static host (GitHub Pages, Netlify, S3…). Nothing is sent to a server; uploaded files stay in the browser.

## Related tools

Scan-architecture descriptions (prism rosette, MEMS eye-shaped pattern, fixed arrays) follow **[Rotating Target Calibration Studio](https://github.com/maninka123/rotating-target-calibration-studio)** ([live demo](https://maninka123.github.io/rotating-target-calibration-studio/)), which goes deeper into comparing LiDAR and camera architectures.


Wondering which local LLM you could run for the scene-graph question-answering idea? Try **[Model Fit Explorer (local-llm-fit)](https://github.com/maninka123/local-llm-fit)** — [web version](https://maninka123.github.io/local-llm-fit/). It is linked (and optionally embeddable on request) from Tab 8.

## Licence

MIT — see [LICENSE](LICENSE).
