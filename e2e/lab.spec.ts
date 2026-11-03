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
    for (let i = 0; i < 19; i++) { await page.getByTestId(`nav-${i}`).click(); await page.waitForTimeout(700); await expect(page.locator('canvas').first()).toBeVisible(); }
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
    await page.getByTestId('intro-skip').click({ timeout: 2500 }).catch(() => {}); // on a slow machine the intro may already have left by itself; the outcome is the same
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 5000 }); await expect(page.getByTestId('nav-0')).toBeVisible();
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
    await setLast(page, null); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
    await expect(page.getByTestId('intro')).toHaveClass(/calm/); const t0 = Date.now();
    await page.getByTestId('nav-0').waitFor({ state: 'attached' }); const ready = Date.now(); // the intro never leaves before the app underneath is ready, so time it from the later of "1.2 s shown" and "app ready"
    await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 8000 });
    expect(Date.now() - Math.max(t0 + 1200, ready)).toBeLessThan(2500); // the normal intro holds for at least 2.8 s and then fades for 0.75 s
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
  test('compare: save two placements in Design, then compare them', async ({ page }) => {
    await page.goto('/'); await go(page, 4);
    await page.getByRole('button', { name: /B · Design/ }).click();
    await addUntil(page, 1);
    await page.getByTestId('occ-save-A').click();
    await expect(page.getByTestId('occ-saved-A')).toContainText('1 scanner');
    await addUntil(page, 2, 6);
    await page.getByTestId('occ-save-B').click();
    await page.getByTestId('occ-open-compare').click();
    await expect(page.getByTestId('occ-add')).toHaveCount(0);
    await expect(page.getByTestId('occ-improvement')).toContainText(/\+|observes|No change|worse/, { timeout: 10000 });
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
    await page.getByRole('button', { name: 'Point cloud', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Point cloud', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Coverage', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Scene', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Scene', exact: true })).toHaveAttribute('aria-pressed', 'true');
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

test.describe('industrial digital twin challenge', () => {
  test('is the last tab; the budget can never be exceeded, and every item can be removed and re-bought', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('nav-18')).toContainText('Industrial Digital Twin');
    await page.getByTestId('nav-18').click();
    await expect(page.getByTestId('twin-stage-title')).toContainText('Mission');
    await page.getByTestId('twin-start').click();
    await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-cam-mid').click();
    const before = await page.getByTestId('twin-remaining').innerText();
    await expect(page.getByTestId('twin-buy-tls')).toBeDisabled(); // 6000+ credits do not fit in what is left
    await expect(page.getByTestId('twin-budget')).not.toContainText('Over budget');
    expect(await page.getByTestId('twin-remaining').innerText()).toBe(before);
    // every owned item has its own Remove button; removing frees the credits, and the item can be bought again
    await expect(page.getByTestId('twin-owned')).toContainText('LiDAR 1'); await expect(page.getByTestId('twin-owned')).toContainText('Camera 1');
    await page.getByTestId('twin-remove-c1').click();
    await expect(page.getByTestId('twin-owned')).not.toContainText('Camera 1'); expect(await page.getByTestId('twin-remaining').innerText()).not.toBe(before);
    await page.getByTestId('twin-remove-l1').click(); await expect(page.getByTestId('twin-owned')).not.toContainText('LiDAR 1'); await expect(page.getByTestId('twin-remaining')).toContainText('3000');
    await expect(page.getByTestId('twin-buy-tls')).toBeDisabled(); // a 6000-credit TLS does not fit in the default 3000 (the admin can raise the budget)
    await page.getByTestId('twin-buy-rot128').click(); await expect(page.getByTestId('twin-owned')).toContainText('128');
    await expect(page.getByTestId('twin-budget')).not.toContainText('Over budget');
  });
  test('upgrades that would go over the budget are refused with a message', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click();
    await page.getByTestId('twin-buy-rot128').click(); await page.getByTestId('twin-buy-cam-high').click(); await page.getByTestId('twin-buy-light').click(); await page.getByTestId('twin-buy-light').click(); // 2905 of 3000
    await page.getByTestId('twin-stage-3').click(); await page.getByTestId('twin-unit-c1').click();
    const left = await page.getByTestId('twin-remaining').innerText();
    await page.getByText(/Low-light kit/).click(); // +120: refused
    await expect(page.getByText(/Not enough credits/).first()).toBeVisible();
    expect(await page.getByTestId('twin-remaining').innerText()).toBe(left);
    await expect(page.getByTestId('twin-budget')).not.toContainText('Over budget');
  });
  test('new equipment starts scattered around the factory, not on top of each other; the tilt reaches ±90°', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click();
    for (let i = 0; i < 3; i++) await page.getByTestId('twin-buy-rot16').click();
    const pos = await page.evaluate(() => (window as any).__twin?.getState().design.lidars.map((u: any) => [u.x, u.y]));
    expect(pos).toHaveLength(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1])).toBeGreaterThan(5);
    await page.getByTestId('twin-stage-3').click(); await page.getByTestId('twin-unit-l1').click();
    const tilt = page.getByLabel('Tilt up (+) / down (−)'); await expect(tilt).toHaveAttribute('min', '-90'); await expect(tilt).toHaveAttribute('max', '90');
    await expect(page.getByLabel('Resolution')).toHaveCount(0); // the model (channel count) decides it
  });
  test('the plan sits in the top-left corner of the view, and the coverage numbers are in the live statistics', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-stage-3').click();
    await expect(page.getByTestId('twin-plan')).toBeVisible(); await expect(page.getByTestId('twin-plan').locator('canvas')).toBeVisible();
    const stage = await page.getByTestId('stage').boundingBox(), plan = await page.getByTestId('twin-plan').boundingBox();
    expect(plan!.x - stage!.x).toBeLessThan(30); expect(plan!.y - stage!.y).toBeLessThan(90); // top left of the canvas
    await expect(page.getByTestId('stats-card')).toContainText('Observed', { timeout: 30000 });
    await expect(page.getByTestId('stats-card').getByTestId('stats-group')).toHaveCount(2); // Budget & equipment, LiDAR coverage
    await expect(page.getByTestId('right-panel').getByTestId('twin-plan')).toHaveCount(0); // not in the panel
    await page.getByTestId('twin-plan-toggle').click(); await expect(page.getByTestId('twin-plan').locator('canvas')).toHaveCount(0); // it can be folded away
    await page.getByTestId('twin-plan-toggle').click(); await expect(page.getByTestId('twin-plan').locator('canvas')).toBeVisible();
    const legend = await page.getByLabel('Legend').boundingBox(); expect(legend!.x + legend!.width).toBeGreaterThan(stage!.x + stage!.width - 40); // the colour key is at the top right
    await page.getByTestId('stats-card').getByRole('button', { name: /LiDAR coverage/ }).click(); // a group title folds its numbers away
    await expect(page.getByTestId('stats-card')).not.toContainText('Observed'); await page.getByTestId('stats-card').getByRole('button', { name: /LiDAR coverage/ }).click(); await expect(page.getByTestId('stats-card')).toContainText('Observed');
      await page.getByTestId('twin-stage-5').click(); await expect(page.getByTestId('twin-plan')).toBeVisible(); // it stays for the later stages
    await page.getByTestId('twin-stage-8').click(); await expect(page.getByTestId('twin-plan')).toBeVisible();
  });
  test('the same model can be bought twice, and each unit stays where it is put', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click();
    await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-rot32').click();
    await expect(page.getByTestId('twin-owned')).toContainText('LiDAR 1'); await expect(page.getByTestId('twin-owned')).toContainText('LiDAR 2');
    await page.getByTestId('twin-stage-3').click(); await expect(page.getByTestId('twin-unit-l2')).toBeVisible();
    await expect(page.getByTestId('twin-add-station')).toHaveCount(0); // no stations: these are fixed units for monitoring
  });
  test('calibration is checked against a LiDAR, and that LiDAR\'s points are coloured by the camera as you calibrate', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click();
    await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-cam-mid').click();
    await page.getByTestId('twin-stage-4').click();
    await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR'); // the pairing is on the button
    await expect(page.getByTestId('twin-cal-list')).not.toContainText('LiDAR 1 LiDAR 2'); // only cameras are listed to calibrate
    await page.getByTestId('twin-unit-c1').click();
    await expect(page.getByTestId('twin-pair-board')).toBeVisible();
    { const from = (await page.getByTestId('twin-port-c1').boundingBox())!, to = (await page.getByTestId('twin-pair-l2').boundingBox())!; // connect by dragging a wire from the camera to a LiDAR
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 8 }); await page.mouse.up(); }
    await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR 2'); await page.getByTestId('twin-pair-l1').click(); await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR 1'); await page.getByTestId('twin-pair-l2').click(); await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR 2'); // the pairing is the student's choice, not fixed 1-to-1
    await expect(page.getByTestId('twin-fov-pct')).toContainText(/LiDAR covers [\d.]+ % of the camera's view/); const near = await page.getByTestId('twin-fov-pct').innerText();
    await page.getByTestId('twin-fov-overlap').getByRole('slider').fill('20'); await expect(page.getByTestId('twin-fov-overlap')).toContainText('on a flat screen 20 m'); expect(await page.getByTestId('twin-fov-pct').innerText()).not.toBe(near);
    await page.getByTestId('twin-pair-l1').click(); await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR 1');
    await expect(page.getByTestId('twin-cal-colour')).toContainText(/colours [\d,]+ of [\d,]+ points/, { timeout: 60000 });
    const before = await page.getByTestId('twin-cal-colour').innerText();
    await page.getByTestId('twin-cal-auto').click();
    await expect(page.getByTestId('twin-cal-colour')).toContainText(/colours/, { timeout: 60000 });
    expect(before).toMatch(/Grey points/);
  });
  test('several cameras can be wired to one LiDAR, and together they colour its points', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click();
    await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-cam-mid').click(); await page.getByTestId('twin-buy-cam-basic').click();
    await page.getByTestId('twin-stage-4').click(); await page.getByTestId('twin-unit-c1').click();
    await expect(page.getByTestId('twin-pair-l1')).toContainText('Cam 1 + Cam 2'); // both wires end at the one LiDAR
    await expect(page.getByTestId('twin-unit-c1')).toContainText('→ LiDAR 1'); await expect(page.getByTestId('twin-unit-c2')).toContainText('→ LiDAR 1');
    await expect(page.getByTestId('twin-cal-colour')).toContainText(/Cameras 1 \+ 2 together colour [\d,]+ of [\d,]+ points/, { timeout: 60000 });
  });
  test('the 3D view can show the scene, the points, or both at once', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot32').click();
    await page.getByTestId('twin-stage-5').click(); await page.getByTestId('twin-acquire').click();
    await expect(page.getByTestId('twin-survey')).toBeVisible({ timeout: 60000 });
    const view = page.getByRole('group', { name: 'What the 3D view shows' });
    for (const m of ['Scene', 'Points', 'Both']) { await view.getByRole('button', { name: m, exact: true }).click(); await expect(view.getByRole('button', { name: m, exact: true })).toHaveAttribute('aria-pressed', 'true'); }
    await expect(page.locator('canvas').first()).toBeVisible();
  });
  test('the pipeline is built block by block: it starts empty, phases are joined by arrows, a registration is required, and the order is kept', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/'); await page.getByTestId('nav-18').click();
    await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-rot32').click();
    await page.getByTestId('twin-stage-6').click();
    await expect(page.locator('[data-testid^="twin-block-"]')).toHaveCount(0); // nothing is pre-built
    await expect(page.getByTestId('twin-recommended')).toHaveCount(0);
    await expect(page.getByTestId('twin-run')).toBeDisabled();
    await expect(page.getByTestId('twin-lanes').locator('.pipe-link')).toHaveCount(4); // arrows between the five phases
    await page.getByTestId('twin-add-phase-4').selectOption('classify'); await page.getByTestId('twin-add-phase-4').selectOption('euclid'); // added in the wrong order: kept in the right one
    await page.getByTestId('twin-add-phase-1').selectOption('icp');
    await expect(page.getByTestId('twin-block-1')).toContainText('ICP registration'); await expect(page.getByTestId('twin-block-2')).toContainText('Euclidean'); await expect(page.getByTestId('twin-block-3')).toContainText('Classify');
    await page.getByTestId('twin-add-phase-4').selectOption('colour'); // needs a camera: the message says so
    await expect(page.getByTestId('twin-block-error-4')).toBeVisible(); await expect(page.getByTestId('twin-run')).toBeDisabled();
    await page.getByTestId('twin-remove-4').click(); await expect(page.getByTestId('twin-run')).toBeEnabled();
    // registration can be tested on its own, with its RMSE
    await page.getByTestId('twin-settings-1').click(); await expect(page.getByLabel(/Match distance/)).toBeVisible();
    await page.getByTestId('twin-test-reg-1').click(); await expect(page.getByTestId('twin-reg-result')).toContainText('RMSE', { timeout: 60000 });
    await page.getByTestId('twin-run').click();
    await expect(page.getByTestId('twin-steps')).toBeVisible({ timeout: 180000 });
    await page.getByTestId('twin-stage-9').click();
    await expect(page.getByTestId('twin-total')).toContainText('/ 100');
    await expect(page.getByTestId('twin-send-off')).toBeVisible(); // no server address is built into the test app: sending is explained, not offered
    await page.getByTestId('twin-stage-7').click(); await expect(page.getByTestId('twin-twin')).toContainText('Covered');
  });
  test('the 3D view has its own Test button while you add blocks: it says what is missing, runs the pipeline and steps through the blocks', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-stage-6').click();
    await expect(page.getByTestId('twin-canvas-run')).toBeVisible(); await expect(page.getByTestId('twin-run-canvas')).toBeDisabled(); await expect(page.getByTestId('twin-canvas-why')).toContainText(/registration/i);
    await page.getByTestId('twin-add-phase-1').selectOption('icp'); await page.getByTestId('twin-add-phase-2').selectOption('voxel');
    await expect(page.getByTestId('twin-canvas-why')).toHaveCount(0); await expect(page.getByTestId('twin-run-canvas')).toBeEnabled();
    await page.getByTestId('twin-run-canvas').click(); await expect(page.getByTestId('twin-canvas-steps')).toBeVisible({ timeout: 180000 });
    await expect(page.getByTestId('twin-points-2')).toContainText(/−\d+ %/); // the voxel block says how many points it removed, right inside the block
    await expect(page.getByTestId('twin-canvas-steps')).toContainText(/After .*: [\d,]+ points/); // a finished run already shows its result in the view: the last block with points
    await page.getByRole('button', { name: 'Previous block' }).click(); await page.getByRole('button', { name: 'Next block' }).click(); await expect(page.getByTestId('twin-canvas-steps')).toContainText(/After .*: [\d,]+ points/);
  });
  test('a block that finds planes or clusters lists them, and unticking some changes the result', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click(); await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-buy-rot32').click(); await page.getByTestId('twin-stage-6').click();
    await page.getByTestId('twin-add-phase-1').selectOption('icp'); await page.getByTestId('twin-add-phase-2').selectOption('voxel'); await page.getByTestId('twin-add-phase-3').selectOption('planes');
    await page.getByTestId('twin-run-canvas').click(); await expect(page.getByTestId('twin-pick-3')).toContainText(/\d+ planes found/, { timeout: 180000 }); await expect(page.getByTestId('twin-pick-3')).toContainText('Floor');
    await expect(page.getByTestId('twin-points-3')).toContainText(/−\d+ %/); // the planes were removed
    await page.getByTestId('twin-pick-none-3').click(); // keep every plane: nothing is removed any more, and the test runs again by itself
    await expect(page.getByTestId('twin-points-3')).toHaveCount(0, { timeout: 180000 }); await expect(page.getByTestId('twin-pick-3-1')).not.toBeChecked();
  });
  test('blocks can run in sequence or in parallel, and the builder can be expanded', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click();
    await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot16').click(); await page.getByTestId('twin-stage-6').click();
    await page.getByTestId('twin-add-phase-1').selectOption('icp'); await page.getByTestId('twin-add-phase-2').selectOption('crop');
    await page.getByTestId('twin-add-phase-2').selectOption('sor'); await page.getByTestId('twin-add-phase-2').selectOption('ror');
    await expect(page.getByTestId('twin-parallel-group')).toHaveCount(0); // in sequence by default: arrows between blocks, no side-by-side group
    await expect(page.getByTestId('twin-phase-2').locator('.pipe-arrow')).toHaveCount(2);
    await page.getByTestId('twin-par-3').click(); await page.getByTestId('twin-par-4').click(); // sor and ror side by side
    await expect(page.getByTestId('twin-parallel-group')).toHaveCount(1); await expect(page.getByTestId('twin-parallel-group')).toContainText('joined');
    await page.getByTestId('twin-seq-4').click(); await expect(page.getByTestId('twin-parallel-group')).toHaveCount(0); // a lone parallel block is just in sequence
    await page.getByTestId('twin-par-4').click();
    await page.getByTestId('twin-expand-builder').click();
    await expect(page.getByTestId('twin-pipe-overlay')).toBeVisible(); await expect(page.getByTestId('twin-lanes-wide').locator('.pipe-link')).toHaveCount(4);
    await expect(page.getByTestId('twin-parallel-group')).toHaveCount(1); // the same pipeline, laid out left to right
    await page.getByTestId('twin-collapse-builder').click(); await expect(page.getByTestId('twin-pipe-overlay')).toHaveCount(0);
    await expect(page.getByTestId('twin-parallel-group')).toHaveCount(1);
  });
  test('the workspace is remembered after a reload', async ({ page }) => {
    await page.goto('/'); await page.getByTestId('nav-18').click();
    await page.getByTestId('twin-team').fill('Lidar Legends');
    await page.getByTestId('twin-stage-2').click(); await page.getByTestId('twin-buy-rot16').click();
    await page.waitForTimeout(700); await page.reload(); await page.getByTestId('nav-18').click();
    await expect(page.getByTestId('twin-stage-title')).toContainText('Equipment'); // it opens where you left off
    await expect(page.getByTestId('twin-owned')).toContainText('Low-resolution');
    await page.getByTestId('twin-stage-1').click(); await expect(page.getByTestId('twin-team')).toHaveValue('Lidar Legends');
  });
});


// ============================================================================ the Thank You tab and its feedback form
const FB_API = 'http://localhost:8799', CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
const thanks = async (page: Page) => { await page.goto('/'); await page.getByTestId('nav-19').click(); await expect(page.getByTestId('thanks-page')).toBeVisible(); };
const fillForm = async (page: Page, o: { before?: number[]; after?: number[]; helpful?: number; module?: string; text?: string } = {}) => {
  const b = o.before ?? [2, 2, 1], a = o.after ?? [4, 3, 1];
  for (let i = 0; i < 3; i++) { await page.getByTestId(`fb-before-${i + 1}-${b[i]}`).click(); await page.getByTestId(`fb-after-${i + 1}-${a[i]}`).click(); }
  await page.getByTestId('fb-helpful-' + (o.helpful ?? 5)).click(); await page.getByTestId('fb-module').selectOption(o.module ?? 'fusion'); if (o.text) await page.getByTestId('fb-text').fill(o.text);
};

test.describe('thank you page and feedback form', () => {
  test('Thank You is the last tab, calm and complete, and the form never opens by itself', async ({ page }) => {
    const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
    await thanks(page);
    await expect(page.getByTestId('nav-19')).toContainText('Thank You'); await expect(page.getByTestId('nav-20')).toHaveCount(0); await expect(page.getByTestId('nav-18')).toContainText('Industrial Digital Twin Challenge'); // after the challenge, and last
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thank You for Exploring LiDAR Learning Lab');
    await expect(page.getByTestId('thanks-page')).toContainText('how point clouds become meaningful information');
    await expect(page.getByTestId('thanks-page')).toContainText("We'd love to hear about your experience");
    await expect(page.getByTestId('thanks-feedback')).toHaveText('Share Your Feedback'); await expect(page.getByTestId('feedback-dialog')).toHaveCount(0); // not forced, not automatic
    await expect(page.getByTestId('thanks-canvas')).toBeVisible();
    const hero = await page.getByTestId('thanks-hero').evaluate((el) => getComputedStyle(el, '::before').backgroundImage); expect(hero).toContain('gradient'); // the night-time scan fades into the app's light page: one continuous picture
    await page.getByTestId('thanks-again').click(); await expect(page.getByTestId('nav-0')).toHaveAttribute('aria-current', 'page'); await expect(page.getByTestId('intro')).toHaveCount(0); // back to the first lesson, no intro replay
    expect(errs).toEqual([]);
  });
  test('reduced motion keeps the picture still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await thanks(page); await expect(page.getByTestId('thanks-page')).toHaveClass(/still/);
  });
  test('every rating starts unanswered, and the form explains what is missing without sending anything', async ({ page }) => {
    let posts = 0; await page.route('**/api/student/feedback', (r) => { posts++; return r.abort(); });
    await thanks(page); await page.getByTestId('thanks-feedback').click(); await expect(page.getByTestId('feedback-dialog')).toBeVisible();
    await expect(page.locator('[data-testid="feedback-dialog"] [role=radio][aria-checked=true]')).toHaveCount(0); await expect(page.locator('[data-testid="feedback-dialog"] [role=radio]')).toHaveCount(5 * 7); // 3 × (before, after) + helpfulness
    await expect(page.getByTestId('fb-module')).toHaveValue(''); await expect(page.getByTestId('fb-text')).toHaveAttribute('maxlength', '1000');
    await expect(page.getByTestId('feedback-dialog')).toContainText('Your feedback is anonymous. Please avoid including personal information in your comments.');
    await page.getByTestId('feedback-submit').click(); await expect(page.getByTestId('feedback-missing')).toContainText('8 answers are missing'); await expect(page.getByTestId('feedback-missing')).toContainText('Question 1 · Before'); await expect(page.getByTestId('feedback-missing')).toContainText('Question 5 · Most useful part');
    await page.getByTestId('feedback-missing').getByRole('button', { name: 'Question 4 · Helpfulness' }).click(); await expect(page.getByTestId('fb-helpful-1')).toBeFocused(); // a missing answer can be reached from the list
    await page.getByTestId('fb-before-1-3').click(); await page.getByTestId('fb-after-1-3').click(); await expect(page.getByTestId('fb-delta-1')).toContainText('no change'); // equal ratings are allowed
    await page.getByTestId('fb-after-1-1').click(); await expect(page.getByTestId('fb-delta-1')).toContainText('−2'); // and so are lower ones
    expect(posts).toBe(0);
  });
  test('the rating rows work from the keyboard, are read as radio groups, and the answers survive closing and reopening', async ({ page }) => {
    await thanks(page); await page.getByTestId('thanks-feedback').click();
    const row = page.getByRole('radiogroup', { name: /Before using the lab: Overall understanding/ }); await expect(row).toBeVisible();
    await row.getByRole('radio').first().focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await expect(page.getByTestId('fb-before-1-3')).toHaveAttribute('aria-checked', 'true'); await expect(page.getByTestId('fb-before-1-3')).toHaveAttribute('aria-label', '3: Moderate understanding');
    await page.getByTestId('fb-text').fill('More about registration'); await page.keyboard.press('Escape'); await expect(page.getByTestId('feedback-dialog')).toHaveCount(0);
    await page.getByTestId('thanks-feedback').click(); await expect(page.getByTestId('fb-before-1-3')).toHaveAttribute('aria-checked', 'true'); await expect(page.getByTestId('fb-text')).toHaveValue('More about registration');
  });
  test('without a lab server it says so plainly, keeps the answers and never shows a success message', async ({ page }) => {
    await thanks(page); await page.getByTestId('thanks-feedback').click(); await fillForm(page, { text: 'Great' }); await page.getByTestId('feedback-submit').click();
    await expect(page.getByTestId('feedback-error')).toContainText('not set up'); await expect(page.getByTestId('feedback-success')).toHaveCount(0); await expect(page.getByTestId('fb-text')).toHaveValue('Great'); await expect(page.getByTestId('fb-after-1-4')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('feedback form with a lab server', () => {
  test.use({ baseURL: 'http://127.0.0.1:4174' });
  test('a complete form is sent once, shows the thank-you message, and the page remembers it was sent', async ({ page }) => {
    const bodies: any[] = []; await page.route(`${FB_API}/**`, async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST' } }); if (r.request().url().endsWith('/api/student/feedback')) { bodies.push(r.request().postDataJSON()); return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true,"duplicate":false}' }); } return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"available":false,"status":"inactive"}' }); });
    await thanks(page); await page.getByTestId('thanks-feedback').click(); await fillForm(page, { before: [1, 2, 3], after: [4, 4, 3], helpful: 4, module: 'registration', text: 'More on SLAM' }); await page.getByTestId('feedback-submit').click();
    await expect(page.getByTestId('feedback-success')).toContainText('Thank you for your feedback!'); await expect(page.getByTestId('feedback-success')).toContainText('has been recorded');
    expect(bodies).toHaveLength(1); expect(bodies[0]).toMatchObject({ before: [1, 2, 3], after: [4, 4, 3], helpful: 4, module: 'registration', text: 'More on SLAM' }); expect(Object.keys(bodies[0]).sort()).toEqual(['after', 'before', 'helpful', 'module', 'sid', 'text']); // answers only
    await page.getByTestId('feedback-back').click(); await expect(page.getByTestId('feedback-dialog')).toHaveCount(0); await expect(page.getByTestId('thanks-sent')).toBeVisible();
  });
  test('a failed send keeps the answers and can be retried, as the same response', async ({ page }) => {
    const bodies: any[] = []; let n = 0;
    await page.route(`${FB_API}/**`, async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST' } }); if (r.request().url().endsWith('/api/student/feedback')) { bodies.push(r.request().postDataJSON()); return n++ === 0 ? r.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: '{}' }) : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true}' }); } return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"available":false,"status":"inactive"}' }); });
    await thanks(page); await page.getByTestId('thanks-feedback').click(); await fillForm(page, { text: 'Keep me' }); await page.getByTestId('feedback-submit').click();
    await expect(page.getByTestId('feedback-error')).toContainText('could not be saved'); await expect(page.getByTestId('feedback-success')).toHaveCount(0); await expect(page.getByTestId('fb-text')).toHaveValue('Keep me'); await expect(page.getByTestId('feedback-submit')).toHaveText('Try again');
    await page.getByTestId('feedback-submit').click(); await expect(page.getByTestId('feedback-success')).toBeVisible();
    expect(bodies).toHaveLength(2); expect(bodies[1].sid).toBe(bodies[0].sid); // one id for the whole form, so the server can tell a retry from a second response
  });
  test('a double click sends one request, and the button shows it is working', async ({ page }) => {
    let posts = 0; await page.route(`${FB_API}/**`, async (r) => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'POST' } }); if (r.request().url().endsWith('/api/student/feedback')) { posts++; await new Promise((x) => setTimeout(x, 800)); return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true}' }); } return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"available":false,"status":"inactive"}' }); });
    await thanks(page); await page.getByTestId('thanks-feedback').click(); await fillForm(page);
    const b = page.getByTestId('feedback-submit'); await b.dblclick({ force: true }); await expect(b).toHaveText('Sending…'); await expect(b).toBeDisabled(); await expect(page.getByTestId('feedback-success')).toBeVisible();
    expect(posts).toBe(1);
  });
});
