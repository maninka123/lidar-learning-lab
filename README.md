# LiDAR Learning Lab

A browser-based, hands-on simulation platform for a 60-minute workshop on **LiDAR, point clouds, TLS / MLS, SLAM, point-cloud processing, clustering and segmentation, image-to-3D reconstruction, scene graphs and AI reasoning**.

Participants explore 3D scenes, drive virtual LiDAR scanners (real ray casting against scene geometry), generate point clouds, process and segment them, register scans, compare LiDAR with image-based reconstruction and query a geometric scene graph. Everything runs in the browser: no server, database, authentication or AI API is needed.

**Live demo: https://maninka123.github.io/lidar-learning-lab/**

**Live tools bundled:** eleven lecture-aligned tabs (light theme) · four procedural scenes · PLY / PCD / LAS import · PLY / PCD export · 9 auto-checked challenges with JSON / PDF summary.

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
| 1 | **What is LiDAR?** | Concept page with no scene: a sensor, a wall and a few objects. Watch a laser pulse travel out and back (time of flight, R = cΔt/2), see beam divergence grow with range, and explore horizontal/vertical FOV in 3D, top and side views. Click any point to read its position, range and intensity. |
| 2 | **Scanner Simulator** | Place and aim a scanner; set FOV, angular resolution, channels, range, frequency, returns and noise; pick a scanner type (2D, 4–128-channel mechanical, TLS, prism, MEMS, solid-state array) with commercial models (Velodyne, Ouster, Hesai, RoboSense, Livox, SICK, Hokuyo, Blickfeld, Leica, FARO…); animated scan pattern for non-repetitive scanners. Specifications are approximate public values. |
| 3 | **Compare Sensors** | The same environment scanned by 2–4 sensors you choose, point clouds only, cameras linked. |
| 4 | **Point Cloud Gallery** | Real measured point clouds with play / pause through frames: Velodyne VLP-16 (from a pcap), Ouster OS1-128 and OS0-128 (from OSF recordings), Livox MID-360 (from a ROS 2 bag) and a RIEGL VZ-400 TLS tree. Shows scanner type, field of view, channels and the raw file text, and lets you open your own file. |
| 5 | **Point Cloud Registration** | Two point clouds, no scene. Move cloud B by hand and press Calculate to read the RMSE and overlap, or align automatically with ICP (point-to-point or point-to-plane, match distance, best-pairs trimming, iterations). Iteration scrubber, convergence chart, run comparison table and the 4 × 4 transformation matrix drawn on the view. |
| 6 | **SLAM & Mobile Scanning** | A city district with roads, crossings, a school, vehicles and pedestrians. Mobile scanning along waypoints (handheld, vehicle or UAV with adjustable flight height, motion distortion), then a closed-loop SLAM run with drift (noisy odometry or ICP scan matching) and a loop closure *teaching approximation*. |
| 7 | **Point Cloud Processing** | Add/reorder/remove pipeline steps (crop, voxel, random downsample, noise, outliers, dropout, statistical & radius outlier removal, normals, rigid transform) on an immutable original; split comparison; deterministic seed; export. |
| 8 | **Clustering & Segmentation** | RANSAC planes, ground removal, Euclidean clustering, DBSCAN, parameter-sensitivity sweep, A/B comparison, over-/under-segmentation scoring against ground truth. |
| 9 | **Image to 3D** | Photo, LiDAR cloud, reconstruction, voxel-surface mesh, overlay and error map; similarity alignment (rotation, translation and scale); error statistics only after a valid alignment. |
| 10 | **Scene Graphs & 3D AI** | Nodes with id, label, position, size, bbox and confidence; geometric relations; interactive graph ↔ 3D selection; deterministic offline question answering; link to the *local-llm-fit* model-fit tool. |
| 11 | **Challenges** | Nine automatically checked exercises, progress tracking, JSON/PDF summary download and a suggested 60-minute agenda. |

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
| Scene D – city district (76 × 56 m) | Procedural, this repo | MIT | Synthetic | as above, pedestrians, traffic lights |
| Real TLS tree (RIEGL VZ-400) | [Zenodo 5076045](https://zenodo.org/records/5076045), UCL | CC BY 4.0 | Measured | x y z |
| Ouster OS1-128 / OS0-128 frames | [ouster-sdk test data](https://github.com/ouster-lidar/ouster-sdk) (tests/osfs), decoded from OSF | BSD-3-Clause | Measured | x y z, intensity |
| Livox MID-360 frames | [Zenodo 14841855](https://zenodo.org/records/14841855), AIST (ROS 2 bag, `/livox/lidar`) | CC BY 4.0 | Measured | x y z, intensity |
| Velodyne VLP-16 frames | [Keio-CSG/lidar-spoofing-artifacts](https://github.com/Keio-CSG/lidar-spoofing-artifacts) (benign pcap), decoded with velodyne_decoder | no licence stated: credit Keio-CSG | Measured | x y z, intensity |
| User uploads | PLY (ascii/binary), PCD (ascii/binary/compressed), LAS 1.0–1.4 (uncompressed) | user's | Measured or synthetic (you choose) | whatever the file contains |

Units are metres; coordinates are right-handed, **Z-up**. Other public datasets (e.g. Stanford 3D Scanning Repository, ETH TLS, Semantic3D, KITTI samples) are not bundled: redistribution terms still need to be verified for each. LAZ is not decoded in the browser — convert with `pdal translate in.laz out.las`.

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
  registration/   ICP (point-to-point, point-to-plane, trimmed, optional scale), SLAM teaching simulation
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
