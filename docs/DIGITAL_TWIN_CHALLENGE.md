# Industrial Digital Twin Challenge

The last tab of the lab. Students design a sensing system for a simulated factory, process what it measures, and are graded automatically on what they actually produced. There is no fixed answer and no timer.

## What a student does (nine stages)

1. **Mission**: the tasks, the rubric, team name, instructor settings.
2. **Equipment**: a shop with a credit budget (fictional prices). LiDARs (16, 32, 64, 128 channels, solid-state, a TLS, a mobile unit), cameras (basic, medium, high, wide, low-light), lamps and a mobile platform. Finer resolution costs more.
3. **Deploy**: place units by clicking the scene or the plan, set height, turn and tilt, draw the mobile route. Geometric LiDAR coverage and camera view (sharpness, readable labels) are shown while planning.
4. **Calibrate**: every camera starts with a hidden installation error. A simulated board gives marker positions; students fix position, angles and field of view by hand or with an automatic least-squares solver and watch the reprojection error.
5. **Acquire**: the survey is measured with range noise, lost returns, floating outliers, a slightly wrong recorded pose for fixed scanners, and drifting dead reckoning for the mobile scanner.
6. **Pipeline**: typed blocks (registration, cleaning, plane removal, clustering, classification, colour reading, change detection, safety check). A block that needs something earlier says what is missing.
7. **Digital twin**, 8. **Tasks**, 9. **Evaluate**: diagnostics, grade, feedback, attempts, export, and sending the score.

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
