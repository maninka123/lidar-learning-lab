# Industrial Digital Twin Challenge

The last tab of the lab. Students design a sensing system for a simulated factory, process what it measures, and are graded automatically on what they actually produced. There is no fixed answer and no timer.

## Seven connected engineering missions

Only the first mission is initially available. Each introduces a specific factory problem, exposes only relevant controls, and unlocks the next mission after measured performance passes. Students inspect results before choosing Continue. Previously unlocked missions remain available; there is no timer or required equipment count.

| Mission | Passing criteria |
|---|---|
| 1. Design the sensing network | ≥70% measured coverage of critical production, inspection and loading areas; within budget |
| 2. Align measurements | RMSE ≤8 cm and overlap ≥20%; a single scanner is judged by its surface accuracy |
| 3. Clean the cloud | ≥60% outliers removed, ≥80% valid monitoring-height measurements retained, ≥60% small-object measurements retained |
| 4. Detect objects | Detection F1 ≥55% and small-object recall ≥25% |
| 5. Add cameras and colour | ≥70% labels read correctly; all paired cameras have marker RMS ≤4 px normalised to 720p |
| 6. Changes and safety | Change F1 ≥50% and safety-zone accuracy ≥75%, independently |
| 7. Commission the twin | All six validations current; final weighted score ≥60/100 over seeds 101 and 202 |

These are minimum educational thresholds, not industrial performance claims. The initial proposed 5 cm / 65% detection / 65% change thresholds were too restrictive for the simplified geometry, partial surfaces and clustering. The automated strategy validation documents the achieved values. Excellent requires stronger performance than Passed; perfection is not necessary.

### Experimentation and visual feedback

The 3D factory and plan remain available for positioning. Sensors can be selected and moved, rotated, tilted and measured at coarse, standard or fine resolution. Resolution changes actual ray sampling and acquisition cost. The shop supports specification cards and comparison of up to three devices.

Planning shows geometric line-of-sight coverage. **Test measured coverage** separately ray-casts the selected hardware with noise and dropout and checks reference surfaces against actual returns within 15 cm. Red means no measured view; yellow one view; green two independent views; blue three or more. Switch between critical regions and the whole factory. Coverage, overlap, missing area and sampling density are distinct quantities.

Registration exposes direct placement, point-to-point/plane ICP, starting pose, match distance, trimming, iterations and preview diagnostics. Cleaning and detection reuse the lab's processing algorithms, including selectable planes/clusters and parallel filters. Step previews compare input and output. Classification uses shape rules, not a neural network.

Camera–LiDAR connections are stored on each camera (`pairedLidarId`) and used by calibration, acquisition, processing and final grading. Legacy unpaired cameras use the nearest installed scanner. A removed explicit partner requires re-pairing. Point provenance includes scan ids, so a camera colours only measurements belonging to its partner. Calibration shows measured/projected markers, initial/current error and manual parameters; assisted optimisation requires inspecting the error and trying a manual correction. Passing depends on measured error, not a “done” flag.

Change assessment displays original/updated surveys, findings and safety zones. Final evaluation keeps the current project, runs two unseen deterministic variants, and exposes each variant's interactive 3D result, score and task metrics. Markdown engineering reports and full JSON configurations can be exported. Existing score consent, student identity and instructor collection controls are preserved.

### Persistence and invalidation

Save version 2 migrates version-1 equipment, calibration, pipelines, saved pipelines, attempts and identity. Old stage visits do not count as mission passes. Progress, measured summaries and per-mission attempts survive reload; large point clouds are recreated on demand.

Each result carries a dependency fingerprint. LiDAR placement/resolution or route changes invalidate all affected results. Cleaning changes retain coverage and registration passes; camera/lighting changes retain geometry validations and invalidate colour/final results. Colour-vote changes do not invalidate geometry-only change/safety results. Previously unlocked missions stay accessible, with stale results clearly labelled. Final evaluation and submission require all prerequisite results current. Async results are discarded if the configuration changes while they run.

### Pricing and project budget

Reference prices use USD, checked 2026-11-04, and **one simulation credit = US$5** before the instructor price scale. The default 3,000-credit allocation represents a US$15,000 educational project. Installation and resolution effort are simulated allowances, not vendor quotations. Existing instructor budgets and grading settings remain authoritative.

- [Livox manufacturer launch announcement](https://www.livoxtech.com/mobile/de/news/mid360_launch): US$749 sample reference, labelled as a launch price rather than a current binding quote.
- [Leica BLK360 official shop](https://shop.leica-geosystems.com/reality-capture/blk360/buy): US$26,500 commercial TLS reference; the simulator uses a generic TLS approximation.
- Other generic scanner/camera classes are explicitly **estimated educational prices**, never claimed to be verified vendor quotations.
- TLS survey hire is an **educational service estimate**, limited to two fixed surveyed stations per project. Repeated practice replays those stations. It does not provide a mobile survey or unrestricted extra stations.

The shared budget carries through all missions. Purchases that raise an over-budget total are refused, and equipment may be removed or replaced. Expensive hardware cannot see through obstacles and cost efficiency remains secondary to technical results.

### Validation

`tests/mission-strategies.test.ts` runs a lower-cost, balanced, higher-performance and deliberately poor system on actual ray-cast data; successful systems must pass all missions and the final variants. Fixtures in `tests/helpers/twinStrategies.ts` are test strategies, not student-facing solutions. Progression, migration, invalidation and legacy submission compatibility have dedicated tests. `e2e/mission-redesign.spec.ts` exercises the controls and a complete measured project in a real browser.

Valid-point retention is evaluated in the fixed monitoring height range −0.15 to 3 m. Discarding ceiling/roof measurements is intentional for this task; small-object retention remains separately measured using provenance. This region is fixed and cannot be altered to game the retention metric.

## Measured strategy validation

The default-budget strategies passed all six practice gates and the two final scenarios. These are regression fixtures, not required solutions.

| Strategy | Cost (of 3,000) | Critical coverage | Registration RMSE | Detection F1 | Labels correct | Change F1 | Final / 100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lower cost | 2,282 | 79.5% | 7.14 cm | 61.0% | 90% | 60.0% | 74.8 |
| Balanced | 2,782 | 83.7% | 7.33 cm | 58.5% | 70% | 70.6% | 76.3 |
| Higher performance | 2,792 | 84.9% | 7.30 cm | 63.5% | 70% | 63.2% | 74.5 |

All three retained 88–90% of valid monitoring-height points and 100% of the sampled small-object measurements, removed 94–95% of outliers, and correctly assessed the three practice safety zones. Detection of small objects was 2/7 (28.6%); retained points do not guarantee separation of objects that touch their support surfaces. The deliberately poor strategy failed initial coverage and could not unlock the next mission. Full run evidence is in [MISSION_VALIDATION.json](MISSION_VALIDATION.json).

## Scoring (100 points, all weights editable)

| Task | Points | Measured |
|---|---|---|
| Digital twin | 20 | share of the true surface below 3 m covered (radius 15 cm), median distance to the true surface (exact distance to the geometry), floating points, consistency of the scans with each other |
| Object detection | 20 | one-to-one (Hungarian) matching by 3D IoU (small objects by centre distance), precision, recall, class, centre error |
| Colour-coded labels | 10 | label colour read from camera pixels on the right object: accuracy and macro F1 |
| Change detection | 20 | added / removed / moved matched one-to-one with the reference change list: precision, recall, location |
| Noise handling | 10 | floating points removed, real points kept, small-object points kept (by provenance) |
| Safety and clearance | 10 | zone violations and clearance distances against geometry (educational, not a certified system) |
| Budget and efficiency | 10 | scaled by how well the system performed, so doing nothing cheaply earns nothing |

Every score is a bounded, explicit function of a measured quantity (`lin(x, bad, good)`). Nothing rewards a tool by name. Disabled tasks drop out and the rest are rescaled.

## Why results differ between designs

Hardware changes the data, not the grade: resolution sets the points per scan, range noise and dropout come from the catalogue entry, the dark zone is dark for every camera (more pixels do not make light; the low-light camera or a lamp helps), calibration error puts the wrong pixels on the wrong points, registration quality changes the merged map and the change detection, and over-filtering removes small objects. The student-visible survey (`VisibleSurvey`) and the hidden truth (`HiddenSurvey`) are separate objects; points carry a provenance index into the hidden table.

Practice runs one scenario seed. The **final evaluation** runs the unchanged system on two other deterministic scenario variants (different object positions, label colours and changes) and averages the scores. Installation errors belong to the hardware, so a calibration made in practice is still right in the final.

## Sending a score to the instructor

After grading (as often as wanted) a student enters name and index number, agrees, and presses **Send my score**. The server receives: name, index, score and per-task scores, cost, number of practice and final runs, a short list of equipment and block names, ten headline results, the time zone and language, and (added by the server) the time, the approximate city and country from the edge headers and a keyed network tag. The student is not asked where they are: you name the networks ("Campus Wi-Fi", "Home") in the admin page and every record from that network shows the name. No point clouds are sent. The server also records the network (IP) address of the computer and a random id the browser keeps, so a computer that sends scores under several names or index numbers can be spotted; the student is told this next to the consent box.

In the admin page (`/admin`) the **Challenge scores** tab shows every record, a best-per-student view, search, CSV download, per-record details, a networks table (label a network once, for example "Campus Wi-Fi", and it is named everywhere), and **Start / Stop accepting scores**. It starts closed. Students can always use the challenge and see their grade; only sending is switched. You open it **unlimited** (until you press Stop) or for a number of **hours** or **days**; a timed opening closes itself, checked on every request. Records are never deleted automatically.

Endpoints: `POST /api/student/submit` (student app origin only, 80 per network per hour), `GET /api/public/challenge` (is it open?), and admin `challenge`, `challenge-start`, `challenge-stop`, `challenge-label`, `challenge-delete`, `challenge-clear`.

## Known approximations and limits

- Everything runs in the browser, so the reference data cannot be kept secret from a determined student. The final evaluation is built to move to a trusted server later.
- The LiDAR model adds range noise, dropout (more for dark surfaces and long range) and floating outliers. Intensity and reflectivity are the lab's simplified model. Mobile scans use dead reckoning plus sequential scan matching, not full SLAM (no loop closure).
- The camera is a pinhole with a field-of-view parameter; no lens distortion, no rolling shutter, no auto-exposure. Lighting is per-zone plus a falloff for lamps; no shadows from lamps.
- Camera depth for occlusion when colouring points is taken from the LiDAR cloud itself.
- Classification is rule-based on cluster size, height and roundness; there is no trained neural network block. The toy networks of the supervised-learning tab take fixed-size inputs and are not directly compatible with a factory point cloud. Semantic segmentation as a per-point network is not included.
- Calibration is solved for the camera position, two angles and the field of view; distance along the viewing direction is the weakest part (as in real calibration).
- Safety zones are axis-aligned boxes judged from detected object boxes.
