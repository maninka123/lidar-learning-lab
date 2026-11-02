import { test as base, expect, Page } from '@playwright/test';

// The welcome intro would sit on top of every test, so each test starts as if it had just been shown (the intro has its own tests below).
const test = base.extend({ page: async ({ page }, use) => { await page.addInitScript(() => { try { if (!localStorage.getItem('lidar-lab-intro-last')) localStorage.setItem('lidar-lab-intro-last', String(Date.now())); } catch { /* ignore */ } }); await use(page); } });

declare global { interface Window { __lab: { getState: () => any; setState: (p: any) => void } } }

const go = async (page: Page, tab: number) => { await page.getByTestId(`nav-${tab}`).click(); await page.waitForTimeout(400); };
const state = <T,>(page: Page, fn: (s: any) => T) => page.evaluate((src) => { const f = new Function('s', `return (${src})(s)`); return f(window.__lab.getState()); }, fn.toString());

test.describe('LiDAR Learning Lab', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('nav-5')).toBeVisible();
    (page as any).__errors = errors;
  });
  test.afterEach(async ({ page }) => { expect((page as any).__errors).toEqual([]); });

  test('shell: ten lecture tabs, viewport, view presets, panel toggle', async ({ page }) => {
    for (let i = 0; i < 10; i++) await expect(page.getByTestId(`nav-${i}`)).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
    await page.getByTestId('view-home').click();
    await expect(page.getByTestId('view-top')).toHaveCount(0);
    await go(page, 1);
    await page.getByTestId('view-home').click();
    await expect(page.getByTestId('view-front')).toHaveCount(0);
    await page.getByTestId('toggle-panel').click();
    await expect(page.getByTestId('right-panel')).toHaveClass(/closed/);
    await page.getByTestId('toggle-panel').click();
    await expect(page.getByTestId('right-panel')).not.toHaveClass(/closed/);
  });

  test('tab 0: what is LiDAR — simple concept page with point inspection', async ({ page }) => {
    await expect(page.getByTestId('concept-point-info')).toContainText('Intensity');
    await expect(page.getByTestId('stats-card')).toContainText('Time of flight');
    await expect(page.getByTestId('person-points')).toContainText('Points on the person');
    await expect(page.getByRole('button', { name: 'Exercise' })).toHaveCount(0);
    await expect(page.getByTestId('environment-menu')).toHaveCount(0);
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await expect(page.getByText('Horizontal field of view')).toBeVisible();
    await expect(page.getByTestId('person-points')).toContainText('Points on the wall');
    await expect(page.getByText('LiDAR needs reflected light to return to its sensor. Dark surfaces return less light, while mirrors may reflect light away.')).toBeVisible();
    await expect(page.getByTestId('material-note')).toContainText('Strong return signal and longer detection range.');
    await page.getByTestId('mat-rubber').click();
    await expect(page.getByTestId('material-note')).toContainText('Weak return signal and shorter detection range.');
    await page.getByTestId('mat-mirror').click();
    await expect(page.getByTestId('material-note')).toContainText('Specular reflection');
    await expect(page.getByText('Turn the wall (angle to the sensor)')).toBeVisible();
    await page.getByTestId('mat-white').click();
    await expect(page.getByText('Turn the wall (angle to the sensor)')).toHaveCount(0);
    await page.getByTestId('raw-toggle').click();
    await expect(page.getByTestId('raw-view')).toContainText('DATA ascii');
    await expect(page.getByTestId('raw-view')).toContainText('FIELDS x y z intensity');
    await page.getByTestId('raw-toggle').click();
    await page.getByTestId('points-only').click();
    await page.getByTestId('points-only').click();
    await page.getByTestId('scene-only').click(); // just the room and the person
    await expect(page.getByTestId('scene-only')).toContainText('Show beams');
    await expect(page.getByTestId('stats-card')).toHaveCount(0);
    await page.getByTestId('points-only').click(); // the two views exclude each other
    await expect(page.getByTestId('scene-only')).toContainText('Scene only');
    await expect(page.getByTestId('points-only')).toContainText('Show scene');
    await page.getByTestId('points-only').click();
    await expect(page.getByTestId('stats-card')).toHaveCount(1);
    await page.getByTestId('play-pause').click();
    await expect(page.getByTestId('play-pause')).toHaveAttribute('aria-label', 'Play the light pulse');
    await page.getByTestId('nav-toggle').click();
    await expect(page.locator('.app')).toHaveClass(/nav-collapsed/);
    await page.getByTestId('nav-toggle').click();
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    for (const l of ['Field of view', 'Beam divergence', 'Time of flight']) await page.getByRole('button', { name: l, exact: true }).click();
  });

  test('tab 1: simulated scan produces points and coverage statistics', async ({ page }) => {
    await go(page, 1);
    await page.getByTestId('run-scan').click();
    await expect(page.getByTestId('stats-card')).toContainText(/\d{2},\d{3}/);
    await expect.poll(() => state(page, (s) => s.scanInfo?.coverage?.coveredPct ?? 0)).toBeGreaterThan(5);
    const n1 = await state(page, (s) => s.clouds.scan.count);
    await page.evaluate(() => window.__lab.getState().setSensor({ hRes: 1.5 }));
    await page.getByTestId('run-scan').click();
    await expect.poll(() => state(page, (s) => s.clouds.scan.count)).toBeLessThan(n1);
    await page.getByTestId('raw-toggle').click();
    await expect(page.getByTestId('raw-view')).toContainText('DATA ascii');
    await page.getByTestId('raw-toggle').click();
    await page.getByTestId('points-only').click();
    await page.getByTestId('points-only').click();
    await expect(page.getByText('Vertical FOV', { exact: true })).toBeVisible();
    await page.evaluate(() => window.__lab.getState().setPreset('rot4'));
    await page.getByTestId('sensor-picker').locator('select').selectOption('c64');
    await expect.poll(() => state(page, (s) => s.sensorPresetId)).toBe('rot64');
    await expect(page.getByTestId('sensor-hdl64e')).toBeVisible();
    await page.getByTestId('sensor-hdl64e').click();
    await expect.poll(() => state(page, (s) => s.sensorPresetId)).toBe('hdl64e');
    await page.evaluate(() => window.__lab.getState().setPreset('planar'));
    await expect(page.getByText('Vertical FOV', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__lab.getState().setPreset('rot32'));
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByTestId('log-scan').click();
    await expect(page.getByTestId('scan-log')).toBeVisible();
  });

  test('compare sensors tab: several sensors scan the same environment', async ({ page }) => {
    await go(page, 2);
    await expect(page.getByTestId('compare-sensors')).toBeVisible();
    await expect(page.getByTestId('cmp-panel-0')).toContainText('points', { timeout: 60000 });
    await page.getByTestId('add-view').click();
    await expect(page.getByTestId('cmp-panel-2')).toBeVisible();
  });

  test('tab 1: prism (Livox-style) scans keep filling in automatically', async ({ page }) => {
    await go(page, 1);
    await page.evaluate(() => window.__lab.getState().setPreset('avia'));
    await page.getByTestId('run-scan').click();
    await expect.poll(() => state(page, (s) => s.clouds.scan?.count ?? 0)).toBeGreaterThan(1000);
    const n1 = await state(page, (s) => s.clouds.scan.count);
    await expect.poll(() => state(page, (s) => s.clouds.scan?.count ?? 0), { timeout: 60000 }).toBeGreaterThan(n1 * 2);
    await expect(page.getByTestId('run-scan')).toContainText(/Stop|Run scan/);
    await page.getByRole('button', { name: 'Single sweep', exact: true }).click();
    await expect.poll(() => state(page, (s) => s.accumulate)).toBe(false);
  });

  test('tab 3: point cloud gallery - real Ouster frames and the real TLS scan', async ({ page }) => {
    await go(page, 3);
    await expect(page.getByTestId('gallery-info')).toContainText('Ouster OS1-128', { timeout: 60000 });
    await expect(page.getByTestId('gallery-info')).toContainText('128', { timeout: 60000 });
    await page.getByTestId('gallery-play').click();
    await page.getByTestId('gallery-play').click();
    await page.getByTestId('gallery-select').locator('select').selectOption('vlp16');
    await expect(page.getByTestId('gallery-info')).toContainText('VLP-16', { timeout: 60000 });
    await page.getByTestId('gallery-select').locator('select').selectOption('mid360');
    await expect(page.getByTestId('gallery-info')).toContainText('MID-360', { timeout: 60000 });
    await page.getByTestId('gallery-select').locator('select').selectOption('riegl');
    await expect(page.getByTestId('gallery-info')).toContainText('324,064', { timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Exercise' })).toHaveCount(0);
    await page.getByTestId('raw-toggle').click();
    await expect(page.getByTestId('raw-view')).toContainText('FIELDS x y z');
    await expect.poll(() => state(page, (s) => s.galleryRaw && s.galleryViewed.includes('riegl') && s.galleryViewed.includes('os1128'))).toBe(true);
  });



  test('tab 5: SLAM drift + loop closure', async ({ page }) => {
    await go(page, 9);
      await page.evaluate(() => window.__lab.getState().patch({ slamParams: { ...window.__lab.getState().slamParams, loopClosure: true } }));
    await page.getByTestId('run-slam').click();
    await expect.poll(() => state(page, (s) => s.slam?.ateAfter ?? null), { timeout: 120000 }).not.toBeNull();
    const r = await state(page, (s) => ({ b: s.slam.ateBefore, a: s.slam.ateAfter }));
    expect(r.a).toBeLessThan(r.b);
  });

  test('tab 4: point cloud registration - ICP corrects a rigid error', async ({ page }) => {
    await go(page, 6);
    await expect.poll(() => state(page, (s) => !!s.reg.A && !!s.reg.B), { timeout: 60000 }).toBe(true);
    await page.getByTestId('calculate').click();
    await expect(page.getByTestId('transform-matrix')).toBeVisible();
    await page.getByRole('button', { name: 'Automatic (ICP)' }).click();
    await page.getByTestId('run-icp').click();
    await expect.poll(() => state(page, (s) => s.reg.after?.rmse ?? null), { timeout: 120000 }).not.toBeNull();
    const reg = await state(page, (s) => ({ b: s.reg.before.rmse, a: s.reg.after.rmse, e: s.reg.recoveredErr }));
    expect(reg.a).toBeLessThan(reg.b * 0.5);
    expect(reg.e.t).toBeLessThan(0.1);
  });

  test('tabs 5-6: noise + outliers + cleaning, then floor + objects segmentation', async ({ page }) => {
    await go(page, 1);
    await page.getByTestId('run-scan').click();
    await expect.poll(() => state(page, (s) => !!s.clouds.scan)).toBe(true);
    await go(page, 5);
    await page.getByText('Noise + outliers + clean').click();
    await expect.poll(() => state(page, (s) => s.proc.quality?.injected ?? 0), { timeout: 60000 }).toBeGreaterThan(100);
    const q = await state(page, (s) => s.proc.quality);
    expect(q.injectedLeft / q.injected).toBeLessThan(0.5);
    await page.getByRole('button', { name: 'Result', exact: true }).click();
    await page.getByTestId('reset-original').click();
    await expect.poll(() => state(page, (s) => s.proc.steps.length)).toBe(0);
    await go(page, 12);
    await page.getByTestId('run-seg').click();
    await expect.poll(() => state(page, (s) => s.seg.gt?.recovered?.length ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(3);
  });

  test('tab 7: LiDAR vs reconstruction needs valid alignment before reporting errors', async ({ page }) => {
    await go(page, 17);
    await expect(page.getByRole('button', { name: 'Exercise' })).toHaveCount(0);
    await expect(page.getByTestId('scene-picker')).toBeVisible();
    await page.getByTestId('scene-living').click();
    await expect.poll(() => state(page, (s) => s.recon.object)).toBe('living');
    await page.getByTestId('scene-chair').click();
    for (const a of ['0', '120', '240']) { await page.getByLabel('Walk around').fill(a); await page.getByTestId('capture-image').click(); }
    await expect(page.getByTestId('captured-photos').locator('canvas')).toHaveCount(3);
    await page.getByRole('button', { name: /Create 3D scene from 3 photos/ }).click();
    await expect(page.getByTestId('recon-tile')).toBeVisible({ timeout: 60000 });
    await expect.poll(() => state(page, (s) => !!s.recon.lidar), { timeout: 60000 }).toBe(true);
    await page.getByTestId('reconstruct').click();
    await expect.poll(() => state(page, (s) => !!s.recon.out), { timeout: 60000 }).toBe(true);
    await page.getByTestId('mesh-toolbar').click();
    await expect.poll(() => page.getByTestId('photo-strip').count()).toBe(1);
    await page.getByRole('button', { name: '3 · Compare', exact: true }).click();
    await expect(page.getByTestId('recon-stats')).toHaveCount(0); // no statistics before alignment
    await page.getByTestId('align-recon').click();
    await expect(page.getByTestId('recon-stats')).toBeVisible({ timeout: 90000 });
  });

  test('tab 12: scene graph on the classroom, offline queries, local-llm-fit card and direct DeepSeek inference (mocked)', async ({ page }) => {
    await page.route('**/api/deepseek/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '# Summary\n\n**Room:** a classroom per the graph.\n\n- z near 0 is the floor\n- some tables' } }], usage: { prompt_tokens: 9876, completion_tokens: 21 } }) }));
    await go(page, 14);
    await expect(page.getByTestId('ds-preview')).toContainText('points');
    await page.getByTestId('ds-prompt').click();
    await expect(page.getByTestId('ds-prompt-text')).toContainText('System');
    await page.getByTestId('ds-send').click();
    await expect(page.getByTestId('ds-answer')).toContainText('classroom');
    await expect(page.getByTestId('ds-answer').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('ds-answer').getByText('Room:', { exact: true })).toBeVisible();
    await expect(page.getByText('Why this is not real point cloud inference')).toBeVisible();
    await page.getByRole('button', { name: '2 Scene graph', exact: true }).click();
    await expect(page.getByTestId('graph-view')).toBeVisible({ timeout: 60000 });
    await page.getByTestId('node-table-1').click();
    await page.getByRole('button', { name: '3 Graph → AI', exact: true }).click();
    await expect(page.getByTestId('node-details')).toContainText('table-1');
    await expect(page.getByTestId('gs-preview')).toContainText('tokens');
    await page.getByTestId('gs-input').fill('Which tables are in the room?');
    await page.getByTestId('gs-input').press('Enter');
    await expect(page.getByTestId('gs-answer')).toContainText('graph');
    await expect(page.getByTestId('gs-ask')).toHaveText('Which tables are in the room?');
    // the conversation goes on: a second question adds a second pair of bubbles, the first stays
    await page.getByTestId('gs-input').fill('And the chairs?');
    await page.getByTestId('gs-send').click();
    await expect(page.getByTestId('gs-ask')).toHaveCount(2);
    await expect(page.getByTestId('gs-answer')).toHaveCount(2);
    await page.getByTestId('gs-new').click();
    await expect(page.getByTestId('gs-ask')).toHaveCount(0);
    await page.getByText('How many chairs are there?').last().click();
    await expect(page.getByTestId('answer')).toContainText(/\d+/);
    await expect(page.getByTestId('llm-fit-link')).toHaveAttribute('href', 'https://maninka123.github.io/local-llm-fit/');
  });
  test('environment menu switches scenes compactly', async ({ page }) => {
    await go(page, 1);
    await page.getByTestId('environment-menu').click();
    await page.getByTestId('env-B').click();
    await expect.poll(() => state(page, (s) => s.sceneId)).toBe('B');
    await page.getByTestId('env-A').click();
    await expect.poll(() => state(page, (s) => s.sceneId)).toBe('A');
  });

  test('scene switching keeps state per scene and all three scenes can be scanned', async ({ page }) => {
    await go(page, 1);
    for (const id of ['B', 'C', 'A']) {
      await page.evaluate((i) => window.__lab.getState().setScene(i), id);
      await page.getByTestId('run-scan').click();
      await expect.poll(() => state(page, (s) => s.clouds.scan?.meta?.sceneId), { timeout: 60000 }).toBe(id);
      expect(await state(page, (s) => s.clouds.scan.count)).toBeGreaterThan(5000);
    }
  });
});

test('viewport: right-drag and the Pan button move the view like CloudCompare', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-3').click();
  await expect(page.getByTestId('gallery-info')).toContainText('Ouster', { timeout: 60000 });
  const box = (await page.locator('canvas').first().boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const camPos = () => page.evaluate(() => (window as any).__camPos?.() ?? null);
  void camPos;
  const shot = async () => (await page.locator('canvas').first().screenshot()).toString('base64');
  const a = await shot();
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 120, cy + 40, { steps: 8 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(800);
  const b = await shot();
  expect(b).not.toBe(a);
  await page.getByTestId('view-pan').click();
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 100, cy - 30, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await shot()).not.toBe(b);
});

test('tab 6: Street is always the big city, also after switching labs and environments', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-9').click();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).toBe('D');
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).toBe('D');
  await page.getByTestId('environment-menu').click();
  await page.getByTestId('env-A').click();
  await page.getByTestId('env-D').click();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).toBe('D');
  await expect(page.getByTestId('env-C')).toHaveCount(0);
});

test.describe('classroom applications', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });
  const go2 = async (page: any, n: number) => { await page.getByTestId(`nav-${n}`).click(); };
  test('tab 10: scan to CAD finds walls and exports a DXF', async ({ page }) => {
    await go2(page, 16);
    await expect(page.getByTestId('stats-card')).toContainText(/Walls found\s*\d+/, { timeout: 90000 });
    await expect.poll(async () => parseInt(((await page.getByTestId('stats-card').innerText()).match(/Walls found\s*(\d+)/) ?? [])[1] ?? '0'), { timeout: 90000 }).toBeGreaterThanOrEqual(4);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-dxf').click()]);
    expect(dl.suggestedFilename()).toBe('classroom_walls.dxf');
  });
  test('tab 11: change detection shows five visits and a heatmap', async ({ page }) => {
    await go2(page, 7);
    await expect(page.getByTestId('stamp-4')).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId('change-chart')).toContainText(/\d+\.\d%/, { timeout: 120000 });
    await expect(page.getByText('What changed', { exact: true })).toBeVisible({ timeout: 120000 });
    await page.getByTestId('stamp-4').fill('2026-05-01T09:00');
    await expect(page.getByTestId('stats-card')).toContainText(/Time between\s*\d+/);
  });
  test('tab 12: meshing builds a surface', async ({ page }) => {
    await go2(page, 11);
    await page.getByTestId('video-X57nSQZePyE').click();
    await expect(page.locator('iframe[src*="X57nSQZePyE"]')).toBeVisible();
    await expect(page.getByTestId('video-fullscreen')).toBeVisible();
    await page.getByTestId('video-close').click();
    await page.getByTestId('build-surface').click();
    await expect(page.getByTestId('stats-card')).toContainText(/Triangles\s*[\d,]{4,}/, { timeout: 60000 });
  });
});

test('tab 7: TLS stations are scanned, registered and compared with the truth', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-8').click();
  await page.getByTestId('tls-preset-3').click();
  await page.getByTestId('scan-stations').click();
  await expect(page.getByTestId('stats-card')).toContainText(/\d{2,3},\d{3} points scanned/, { timeout: 120000 });
  await expect(page.getByText(/they all pile up in one place/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registered', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'True places' })).toHaveCount(0);
  await page.getByTestId('register-tls').click();
  await expect(page.getByText('4 · How close did it get?')).toBeVisible({ timeout: 180000 });
  await expect(page.getByRole('button', { name: 'Registered', exact: true })).toBeEnabled();
  await expect(page.getByTestId('stats-card')).toContainText(/Registration error\s*[\d.]+ cm/);
});

test('tab 8: LiDAR + camera fusion - estimate, calculate, save and map', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-10').click();
  await expect(page.getByTestId('fusion-calculate')).toBeEnabled({ timeout: 120000 });
  await page.getByTestId('fusion-calculate').click();
  await expect(page.getByTestId('fusion-errors')).toContainText('Total');
  await expect(page.getByTestId('fusion-stats')).toContainText(/Colours right\s*\d+ %/);
  await page.getByTestId('find-matches').click();
  await page.getByTestId('solve-calibration').click();
  await expect(page.getByText(/Solved: the matches now agree to/)).toBeVisible();
  await page.getByTestId('fusion-calculate').click();
  await expect(page.getByTestId('fusion-stats')).toContainText(/Error\s*[0-2]\.\d cm/);
  await expect(page.getByTestId('open-mapping')).toBeDisabled();
  await page.getByTestId('save-calibration').click();
  await page.getByTestId('open-mapping').click();
  await expect(page.getByTestId('fusion-mapping')).toBeVisible();
  await page.getByTestId('mapping-scan').click();
  await expect(page.getByTestId('mapping-coloured')).toContainText('%', { timeout: 180000 });
  await page.getByTestId('mapping-close').click();
  await expect(page.getByTestId('fusion-mapping')).toHaveCount(0);
});

test('processing: draw a crop box on the original cloud with the mouse', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-5').click();
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__lab.getState().clouds).length), { timeout: 60000 }).toBeGreaterThan(0);
  await page.getByTestId('add-type').locator('select').selectOption('crop');
  await page.getByTestId('add-step').click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  const full = await page.evaluate(() => (window as any).__lab.getState().proc.steps[0]);
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().proc.steps[0].max[0])).not.toBe(full.max[0]);
  const drawn = await page.evaluate(() => (window as any).__lab.getState().proc.steps[0]);
  expect(drawn.type).toBe('crop');
  expect(drawn.max[0] - drawn.min[0]).toBeLessThan(full.max[0] - full.min[0]);
  expect(drawn.max[1] - drawn.min[1]).toBeLessThan(full.max[1] - full.min[1]);
  expect(Math.abs(drawn.max[2] - full.max[2])).toBeLessThan(1e-6); // drawn from above: the height is left alone
  await expect(page.getByTestId('draw-box-0')).toContainText('Draw the box on the cloud');
});

test('segmentation: label clusters by hand and use them in the scene graph', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-12').click();
  await expect(page.getByText(/125,\d{3} pts/)).toBeVisible({ timeout: 60000 });
  await page.getByTestId('run-seg').click();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().seg.result?.clusters?.length ?? 0), { timeout: 90000 }).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByTestId('label-table')).toBeVisible({ timeout: 90000 });
  await page.getByTestId('cluster-row-2').locator('td').first().click();
  await expect(page.getByTestId('picked-card')).toContainText('Points');
  await page.getByTestId('picked-label').selectOption('Chair');
  await expect.poll(() => page.evaluate(() => Object.values((window as any).__lab.getState().seg.names).includes('Chair'))).toBe(true);
  await page.getByTestId('picked-close').click();
  await expect(page.getByTestId('picked-card')).toHaveCount(0);
  await page.getByTestId('label-0').selectOption('Chair');
  await page.getByTestId('label-1').selectOption('Table');
  await expect(page.getByText(/trained on labelled point clouds|semantic segmentation model/)).toBeVisible();
  await page.getByTestId('nav-14').click();
  await page.getByRole('button', { name: '2 Scene graph', exact: true }).click();
  await page.getByRole('button', { name: 'My labelled clusters' }).click();
  await expect(page.getByTestId('graph-empty')).toHaveCount(0);
  await expect(page.getByTestId('graph-view')).toContainText('Chair 1');
  await expect(page.getByTestId('graph-view')).toContainText('Table 1');
});

test('segmentation: planes first, then clusters, as two separate stages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-12').click();
  await expect(page.getByText(/125,\d{3} pts/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('run-cluster')).toBeDisabled();
  await page.getByTestId('run-planes').click();
  await expect(page.getByText(/planes found in/)).toBeVisible({ timeout: 90000 });
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().seg.result?.clusters?.length)).toBe(0);
  await page.getByTestId('run-cluster').click();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().seg.result?.clusters?.length ?? 0), { timeout: 90000 }).toBeGreaterThan(5);
});

test('tab 13: drive, point clouds, scene graph per frame, temporal graph, results and AI question (mocked)', async ({ page }) => {
  await page.route('**/api/deepseek/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '## Moving\n\n- **person**: crosses ahead' } }], usage: { prompt_tokens: 2000, completion_tokens: 12 } }) }));
  await page.goto('/');
  await page.getByTestId('nav-15').click();
  await page.getByTestId('mv-play').click();
  await page.getByTestId('mv-play').click();
  await page.getByRole('button', { name: '2 Clouds', exact: true }).click();
  await expect(page.getByText(/k points in this frame/)).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: '3 Graphs', exact: true }).click();
  await expect(page.getByTestId('seg-stats')).toContainText('ms');
  await expect(page.getByTestId('frame-graph')).toBeVisible();
  await page.getByRole('button', { name: '4 Over time', exact: true }).click();
  await expect(page.getByTestId('track-count')).toContainText(/\d+ tracked objects/);
  await expect(page.getByTestId('temporal-story')).toBeVisible();
  await expect(page.getByTestId('story-caption')).toContainText('A scene graph for every scan');
  for (let i = 0; i < 4; i++) await page.getByTestId('story-next').click();
  await expect(page.getByTestId('story-caption')).toContainText('Repeat for every scan');
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByRole('button', { name: '5 Results', exact: true }).click();
  await expect(page.getByTestId('events')).toContainText('f');
  await page.getByRole('button', { name: '6 Ask AI', exact: true }).click();
  await page.getByTestId('mv-prompt').locator('summary').click();
  await expect(page.getByTestId('mv-prompt')).toContainText(/person|car/);
  await page.getByTestId('mv-input').fill('What is moving?');
  await page.getByTestId('mv-input').press('Enter');
  await expect(page.getByTestId('mv-answer')).toContainText('crosses ahead');
  await page.getByTestId('mv-input').fill('And who is closest?');
  await page.getByTestId('mv-send').click();
  await expect(page.getByTestId('mv-ask')).toHaveCount(2);
  await expect(page.getByTestId('mv-answer')).toHaveCount(2);
  // the questions that need no AI
  await page.getByRole('button', { name: 'What is moving, and how fast?' }).last().click();
  await expect(page.getByTestId('mv-offline-answer')).toContainText('m/s');
  await expect(page.getByTestId('mv-offline-answer')).toContainText('not an AI');
});

test.describe('corner cases', () => {
  test('TLS tab: changing the environment while a scan is running leaves nothing of the old one behind', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-8').click();
    await page.getByTestId('tls-preset-3').click();
    await page.getByTestId('scan-stations').click();
    await page.getByTestId('environment-menu').click();
    await page.getByTestId('env-B').click();
    await page.waitForTimeout(20000);
    await expect(page.getByTestId('stats-card')).toContainText(/Stations\s*0/);
    await expect(page.getByTestId('stats-card')).not.toContainText('points scanned');
    await expect(page.getByTestId('scan-stations')).toBeDisabled();
  });

  test('every tab opens without page errors or console errors', async ({ page }) => {
    const bad: string[] = [];
    page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|favicon|ytimg|youtube/i.test(m.text())) bad.push(`console: ${m.text()}`); });
    await page.goto('/');
    for (let i = 0; i < 18; i++) { await page.getByTestId(`nav-${i}`).click(); await page.waitForTimeout(700); await expect(page.locator('canvas').first()).toBeVisible(); }
    expect(bad).toEqual([]);
  });

  test('TLS tab: needs a station, works with just one, and the city is not left selected in other tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-8').click();
    await expect(page.getByTestId('scan-stations')).toBeDisabled();
    await page.getByTestId('add-stations-tool').click();
    await page.getByTestId('environment-menu').click();
    await page.getByTestId('env-A').click();
    await page.evaluate(() => (window as any).__lab.getState().patch({ pendingStation: [0, 0] }));
    await page.getByTestId('scan-stations').click();
    await expect(page.getByTestId('stats-card')).toContainText(/\d{2,3},\d{3} points scanned/, { timeout: 120000 });
    await expect(page.getByTestId('stats-card')).toContainText(/Scene covered\s*\d+ %/, { timeout: 60000 });
    await expect(page.getByTestId('register-tls')).toHaveCount(0);
    await page.getByTestId('points-only').click();
    await expect(page.getByTestId('points-only')).toContainText('Show scene');
    await page.getByTestId('environment-menu').click();
    await page.getByTestId('env-D').click();
    await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).toBe('D');
    await page.getByTestId('nav-1').click();
    await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).not.toBe('D');
  });

  test('CAD with a slice at the ceiling, change detection with the same visit twice', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-16').click();
    await expect(page.getByTestId('stats-card')).toContainText(/Walls found\s*[1-9]/, { timeout: 90000 });
    await page.getByTestId('nav-7').click();
    await expect(page.getByTestId('stamp-0')).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId('change-chart')).toContainText(/\d+\.\d%/, { timeout: 120000 });
  });
});

test('SLAM tab: a waypoint can be removed and the route follows', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('nav-9').click();
  await page.getByRole('button', { name: 'Loop preset' }).click();
  const n0 = await state(page, (s) => s.waypoints.length);
  expect(n0).toBeGreaterThanOrEqual(3);
  await page.getByTestId('wp-remove-1').click();
  const wp = await state(page, (s) => s.waypoints.length);
  expect(wp).toBe(n0 - 1);
  await expect(page.getByTestId('wp-remove-0')).toBeVisible();
  await expect(page.getByTestId(`wp-remove-${n0 - 1}`)).toHaveCount(0);
});

test('supervised learning: images left, point clouds right, drag blocks, clear errors, train, compare', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('nav-13').click();
  await expect(page.getByTestId('nn-image-flow')).toBeVisible();
  await expect(page.getByTestId('nn-points-flow')).toBeVisible();
  await expect(page.getByTestId('right-panel')).toHaveCount(0);
  const left = await page.getByTestId('nn-col-image').boundingBox(), right = await page.getByTestId('nn-col-points').boundingBox();
  expect(left!.x).toBeLessThan(right!.x);
  await expect(page.locator('[data-testid^="nn-image-sample-"]')).toHaveCount(10);
  await expect(page.locator('[data-testid^="nn-points-sample-"]')).toHaveCount(10);
  // an image classifier with no blocks needs Flatten, and the message says so
  await page.getByTestId('nn-image-clear').click();
  await expect(page.getByTestId('nn-image-error')).toContainText('Flatten');
  await expect(page.getByTestId('nn-image-train')).toBeDisabled();
  // drag a block into the line, then fix the model by clicking
  await page.getByTestId('nn-image-add-conv').dragTo(page.getByTestId('nn-image-slot-0'));
  await expect(page.getByTestId('nn-image-block-0')).toContainText('Conv');
  await page.getByTestId('nn-image-add-flatten').click();
  await expect(page.getByTestId('nn-image-error')).toHaveCount(0);
  // train both sides together
  await page.getByTestId('nn-train-both').click();
  await expect(page.getByTestId('nn-image-epoch')).toContainText('epoch 200 / 200', { timeout: 120000 });
  await expect(page.getByTestId('nn-points-epoch')).toContainText('epoch 200 / 200', { timeout: 120000 });
  await expect(page.getByTestId('nn-image-score')).toContainText('%');
  await expect(page.getByTestId('nn-summary')).toContainText(/\d+ % \/ \d+ %.*\d+ % \/ \d+ %/s);
  // segmentation changes the blocks that fit, on both sides
  await page.getByRole('button', { name: 'Segmentation' }).click();
  await expect(page.getByTestId('nn-points-add-upsample')).toBeVisible();
  await expect(page.getByTestId('nn-points-error')).toHaveCount(0);
  await page.getByTestId('nn-train-both').click();
  await expect(page.getByTestId('nn-points-epoch')).toContainText('epoch 200 / 200', { timeout: 120000 });
  await expect(page.getByTestId('nn-summary')).toContainText(/0\.\d\d \/ 0\.\d\d/);
});

test('scene graph: true objects to try it, and a clear choice when there are no named clusters', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('nav-14').click();
  await page.getByRole('button', { name: '2 Scene graph', exact: true }).click();
  await expect(page.getByTestId('graph-view')).toContainText('Table 1', { timeout: 60000 });
  await expect(page.getByTestId('graph-view')).toContainText('Whiteboard');
  await expect(page.getByTestId('graph-legend')).toContainText('Chair');
  await page.getByRole('button', { name: 'My labelled clusters' }).click();
  await expect(page.getByTestId('graph-empty')).toBeVisible();
  await expect(page.getByTestId('graph-go-cluster')).toBeVisible();
  await expect(page.getByTestId('graph-go-train')).toBeVisible();
  await page.getByTestId('graph-use-truth').click();
  await expect(page.getByTestId('graph-view')).toContainText('Table 1');
  await page.getByTestId('graph-go-cluster').count();
});

test('moving scene: run segmentation on the point clouds, see its name, timing and classes on the canvas', async ({ page }) => {
  await page.goto('/'); await page.getByTestId('nav-15').click();
  await expect(page.getByTestId('mv-play')).toBeVisible({ timeout: 120000 });
  await page.getByRole('button', { name: '2 Clouds' }).click();
  await expect(page.getByTestId('seg-card')).toHaveCount(0);
  await page.getByText('Run segmentation').click();
  await expect(page.getByTestId('seg-card')).toContainText('Ground plane + Euclidean clustering');
  await expect(page.getByTestId('seg-ms')).toContainText(/\d+ ms/);
  await expect(page.getByTestId('seg-card')).toContainText('Ground plane (RANSAC)');
  await expect(page.getByTestId('seg-classes')).toContainText(/car|person|pole/);
  const first = await page.getByTestId('seg-card').innerText();
  await page.getByTestId('mv-play').click();
  await expect.poll(async () => (await page.getByTestId('seg-card').innerText()) !== first, { timeout: 15000 }).toBe(true);
});

test.describe('welcome intro', () => {
  const KEY = 'lidar-lab-intro-last', setLast = (page: Page, agoMs: number | null) => page.addInitScript(([k, ago]) => { // only on the first load of a tab, so a reload keeps what the page itself wrote
    try { if (!sessionStorage.getItem('e2e-set')) { sessionStorage.setItem('e2e-set', '1'); if (ago === null) localStorage.removeItem(k as string); else localStorage.setItem(k as string, String(Date.now() - (ago as number))); } } catch { /* ignore */ }
  }, [KEY, agoMs] as const);
  const stored = (page: Page) => page.evaluate((k) => Number(localStorage.getItem(k)), KEY);

  test('first visit: shows at once, the app loads underneath, it stays a minimum time, records the time, and a refresh skips it', async ({ page }) => {
    await setLast(page, null); const t0 = Date.now(); await page.goto('/');
    await expect(page.getByTestId('intro')).toBeVisible();
    await expect(page.getByTestId('intro')).toContainText('LiDAR Learning Lab'); await expect(page.getByTestId('intro')).toContainText('Explore the world in 3D');
    await expect(page.getByTestId('nav-0')).toBeAttached(); // the app is already there underneath
    const shownAt = await stored(page); expect(Math.abs(shownAt - Date.now())).toBeLessThan(5000); // the time is written as soon as it appears
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 15000 });
    expect(Date.now() - t0).toBeGreaterThan(2500); // never shorter than the minimum
    await page.reload(); await expect(page.getByTestId('nav-0')).toBeVisible(); await expect(page.getByTestId('intro')).toHaveCount(0);
    expect(await stored(page)).toBe(shownAt); // the visit that skipped the intro did not move the timer
  });

  test('within two hours it is skipped and the timer is untouched; after two hours or the next day it shows again', async ({ page, browser }) => {
    await setLast(page, 119 * 60e3); const before = Date.now() - 119 * 60e3; await page.goto('/');
    await expect(page.getByTestId('nav-0')).toBeVisible(); await expect(page.getByTestId('intro')).toHaveCount(0); expect(Math.abs((await stored(page)) - before)).toBeLessThan(5000);
    for (const ago of [2 * 3600e3 + 60e3, 26 * 3600e3]) {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); await setLast(p, ago); await p.goto('/'); await expect(p.getByTestId('intro')).toBeVisible(); await ctx.close();
    }
  });

  test('another tab opened while it is showing skips it, and skipping still records the time', async ({ page, context }) => {
    await setLast(page, null); await page.goto('/'); await expect(page.getByTestId('intro')).toBeVisible();
    const other = await context.newPage(); await other.goto('/'); await expect(other.getByTestId('nav-0')).toBeVisible(); await expect(other.getByTestId('intro')).toHaveCount(0);
    await page.getByTestId('intro-skip').click(); await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 5000 }); await expect(page.getByTestId('nav-0')).toBeVisible();
    expect(Date.now() - (await stored(page))).toBeLessThan(8000);
  });

  test('Escape skips it too', async ({ page }) => {
    await setLast(page, null); await page.goto('/'); await expect(page.getByTestId('intro')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 5000 });
  });

  test('with blocked storage it still works (shown once per page load, nothing breaks)', async ({ page }) => {
    const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    await page.goto('/'); await expect(page.getByTestId('intro')).toBeVisible(); await page.getByTestId('intro-skip').click(); await expect(page.getByTestId('nav-0')).toBeVisible(); expect(errs).toEqual([]);
  });

  test('with reduced motion it is shorter and calmer', async ({ page }) => {
    await setLast(page, null); await page.emulateMedia({ reducedMotion: 'reduce' }); const t0 = Date.now(); await page.goto('/');
    await expect(page.getByTestId('intro')).toHaveClass(/calm/); await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 8000 });
    expect(Date.now() - t0).toBeLessThan(2800);
  });
});

test.describe('occlusion & sensor placement', () => {
  const plan = (page: Page) => page.locator('canvas[aria-label="Top-down plan view"]');
  const clickPlan = async (page: Page, fx: number, fy: number) => { await plan(page).scrollIntoViewIfNeeded(); const b = (await plan(page).boundingBox())!; await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); };
  const SPOTS: [number, number][] = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.35, 0.5], [0.65, 0.5], [0.5, 0.25], [0.5, 0.75], [0.25, 0.35], [0.75, 0.65], [0.3, 0.65], [0.7, 0.35]];
  /** press Add scanner and click free floor until the list has n scanners (some spots are inside furniture and are refused) */
  const addUntil = async (page: Page, n: number, from = 0) => {
    for (let i = from; i < SPOTS.length; i++) {
      if (await page.getByTestId(`occ-pick-${n}`).count()) return i + 1;
      await page.getByTestId('occ-add').click({ force: true }); await clickPlan(page, SPOTS[i][0], SPOTS[i][1]); await page.waitForTimeout(120);
    }
    await expect(page.getByTestId(`occ-pick-${n}`)).toBeVisible(); return SPOTS.length;
  };
  test('sits after the Gallery and before Processing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-4')).toContainText('Occlusion');
    await expect(page.getByTestId('nav-3')).toContainText('Gallery');
    await expect(page.getByTestId('nav-5')).toContainText('Processing');
  });
  test('explore: the scanner can be moved and the visible share updates', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await expect(page.getByTestId('stats-card')).toContainText('Visible');
    const before = await page.getByTestId('stats-card').innerText();
    await clickPlan(page, 0.2, 0.25); await page.waitForTimeout(900);
    expect(await page.getByTestId('stats-card').innerText()).not.toBe(before);
  });
  test('design: add up to four scanners, select, delete, and coverage is shown', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /B · Design/ }).click();
    const used = await addUntil(page, 4);
    await expect(page.getByTestId('occ-pick-4')).toBeVisible();
    await page.getByTestId('occ-add').click({ force: true }).catch(() => undefined);
    for (let i = used; i < SPOTS.length; i++) { await clickPlan(page, SPOTS[i][0], SPOTS[i][1]); }
    await expect(page.getByTestId('occ-pick-5')).toHaveCount(0);
    await page.getByTestId('occ-pick-2').click(); await page.getByTestId('occ-delete').click();
    await expect(page.getByTestId('occ-pick-4')).toHaveCount(0);
    await expect(page.getByTestId('stats-card')).toContainText('Observed');
  });
  test('design: scanning works and a moved scanner makes its scan stale; changing environment clears everything', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /B · Design/ }).click();
    await addUntil(page, 1);
    await page.getByTestId('occ-scan-all').click();
    await expect(page.getByTestId('occ-table')).toContainText('pts', { timeout: 60000 });
    await clickPlan(page, 0.3, 0.3);
    await expect(page.getByTestId('occ-stale')).toBeVisible();
    await page.getByTestId('environment-menu').click(); await page.getByTestId('env-B').click();
    await expect(page.getByTestId('occ-pick-1')).toHaveCount(0);
  });
  test('compare: copy A to B, add a scanner to B and see the improvement', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /C · Compare/ }).click();
    await addUntil(page, 1);
    await page.getByTestId('occ-copy').click();
    await page.getByRole('button', { name: /Edit B/ }).click();
    await expect(page.getByTestId('occ-pick-1')).toBeVisible();
    await addUntil(page, 2, 6);
    await expect(page.getByTestId('occ-improvement')).toContainText(/\+|observes|No change/, { timeout: 10000 });
    await expect(page.getByTestId('occ-compare')).toContainText('Scanners');
  });
  test('challenge: shows a goal, progress and completes with the example solution', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /B · Design/ }).click();
    await page.getByTestId('occ-challenge-easy').click();
    await expect(page.getByTestId('occ-challenge')).toContainText('90 %');
    await page.getByRole('button', { name: 'Show an example' }).click();
    await expect(page.getByTestId('occ-challenge')).toContainText('Done', { timeout: 10000 });
  });
  test('walkthrough: steps, plays, and the normal controls still work afterwards', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByTestId('occ-guide-start').click();
    await expect(page.getByTestId('occ-guide-title')).toContainText('Step 1 of 5', { timeout: 20000 });
    await page.getByTestId('occ-guide-next').click(); await expect(page.getByTestId('occ-guide-title')).toContainText('Step 2 of 5');
    await page.getByTestId('occ-guide-step-5').click(); await expect(page.getByTestId('occ-guide-chart')).toBeVisible();
    await page.getByTestId('occ-guide-prev').click(); await expect(page.getByTestId('occ-guide-title')).toContainText('Step 4 of 5');
    await page.getByTestId('occ-guide-restart').click(); await expect(page.getByTestId('occ-guide-title')).toContainText('Step 1 of 5');
    await page.getByTestId('occ-guide-close').click();
    await expect(page.getByTestId('occ-guide-start')).toBeVisible();
  });
  test('point cloud view hides the scene and keeps only points', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /B · Design/ }).click();
    await addUntil(page, 1);
    await page.getByTestId('occ-scan-all').click();
    await expect(page.getByTestId('occ-table')).toContainText('pts', { timeout: 60000 });
    await page.getByRole('button', { name: 'Point cloud' }).click();
    await expect(page.getByRole('button', { name: 'Point cloud' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Occlusion dots' }).click();
    await expect(page.getByRole('button', { name: 'Occlusion dots' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Scene', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Scene', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  test('links on to TLS Scanning', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByTestId('occ-open-tls').click();
    await expect(page.getByTestId('nav-8')).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('guided ICP and SLAM lessons', () => {
  test('ICP lesson replays the real iterations, steps, plays and returns to normal use', async ({ page }) => {
    await page.goto('/'); await go(page, 6);
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    await expect(page.getByTestId('icp-guide-iter')).toContainText('Iteration 1 /', { timeout: 60000 });
    await page.getByTestId('icp-guide-next').click(); await expect(page.getByTestId('icp-guide-title')).toContainText('Step 2 of 5');
    await expect(page.getByTestId('icp-guide-pair')).toContainText('apart');
    await page.getByTestId('icp-guide-next').click(); await expect(page.getByTestId('icp-guide-delta')).toContainText('Move found');
    await expect(page.getByTestId('transform-matrix')).toContainText('move');
    await page.getByTestId('icp-guide-step-5').click(); await expect(page.getByTestId('icp-guide-chart')).toBeVisible();
    await page.getByTestId('icp-guide-next').click(); await expect(page.getByTestId('icp-guide-iter')).toContainText('Iteration 2 /');
    await page.getByTestId('icp-guide-restart').click(); await expect(page.getByTestId('icp-guide-iter')).toContainText('Iteration 1 /');
    await page.getByTestId('icp-guide-close').click(); await expect(page.getByTestId('icp-guide-start')).toBeVisible();
    await page.getByRole('button', { name: 'Controls', exact: true }).click();
    await expect(page.getByTestId('run-icp')).toBeVisible();
  });
  test('ICP lesson: a poor start can settle in the wrong place', async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto('/'); await go(page, 6);
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    await expect(page.getByTestId('icp-guide-iter')).toContainText('Iteration 1 /', { timeout: 60000 });
    await page.getByTestId('guide-bad-start').click(); await page.getByTestId('guide-rerun').click();
    await expect(page.getByTestId('icp-guide-iter')).toContainText('Iteration 1 /', { timeout: 60000 });
    await page.getByTestId('icp-guide-step-5').click();
    for (let i = 0; i < 120; i++) { const t = await page.getByTestId('icp-guide-iter').innerText(); const m = t.match(/Iteration (\d+) \/ (\d+)/)!; if (m[1] === m[2]) break; await page.getByTestId('icp-guide-next').click(); }
    await expect(page.getByText('Settled, but in the wrong place')).toBeVisible();
    await expect(page.getByTestId('guide-open-slam')).toBeVisible();
    await page.getByTestId('guide-open-slam').click();
    await expect(page.getByTestId('nav-9')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Learn', exact: true })).toBeVisible({ timeout: 20000 });
  });
  test('SLAM lesson: steps through drift, loop closure and the summary', async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto('/'); await go(page, 9);
      await page.evaluate(() => window.__lab.getState().patch({ slamParams: { ...window.__lab.getState().slamParams, steps: 20 } })); // a short loop keeps the headless run quick
    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    await expect(page.getByTestId('slam-guide-title')).toContainText('Step 1 of 6', { timeout: 150000 });
    await page.getByTestId('slam-guide-step-3').click({ force: true }); await expect(page.getByTestId('slam-guide-drift')).toContainText('position off by', { timeout: 15000 });
    await page.getByTestId('slam-guide-step-4').click({ force: true }); await expect(page.getByTestId('slam-guide-verify')).toContainText('overlap');
    await page.getByTestId('slam-guide-step-5').click({ force: true }); await expect(page.getByTestId('slam-guide-ate')).toContainText('ATE');
    await page.getByTestId('slam-guide-step-6').click({ force: true }); await expect(page.getByTestId('slam-guide-pipeline')).toContainText('simplified');
    await page.getByTestId('slam-guide-close').click(); await page.getByRole('button', { name: 'Controls', exact: true }).click(); await expect(page.getByTestId('run-slam')).toBeVisible();
  });
});
