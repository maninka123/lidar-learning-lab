import { test, expect, Page } from '@playwright/test';

declare global { interface Window { __lab: { getState: () => any; setState: (p: any) => void } } }

const go = async (page: Page, tab: number) => { await page.getByTestId(`nav-${tab}`).click(); await page.waitForTimeout(400); };
const state = <T,>(page: Page, fn: (s: any) => T) => page.evaluate((src) => { const f = new Function('s', `return (${src})(s)`); return f(window.__lab.getState()); }, fn.toString());

test.describe('LiDAR Learning Lab', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('nav-9')).toBeVisible();
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
    await page.getByTestId('mat-glass').click();
    await expect(page.getByTestId('person-points')).toContainText('0 points · gap');
    await page.getByTestId('mat-white').click();
    await page.getByTestId('raw-toggle').click();
    await expect(page.getByTestId('raw-view')).toContainText('DATA ascii');
    await expect(page.getByTestId('raw-view')).toContainText('FIELDS x y z intensity');
    await page.getByTestId('raw-toggle').click();
    await page.getByTestId('points-only').click();
    await page.getByTestId('points-only').click();
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

  test('tab 5: mobile scanning - single scan then a moving trajectory', async ({ page }) => {
    await go(page, 5);
    await page.getByTestId('run-mls').click();
    await expect.poll(() => state(page, (s) => s.mls?.cloud?.count ?? 0), { timeout: 90000 }).toBeGreaterThan(500);
    await page.getByText('Loop preset').click();
    await page.getByTestId('run-mls').click();
    await expect.poll(() => state(page, (s) => s.mls?.seconds ?? 0), { timeout: 120000 }).toBeGreaterThan(2);
    await expect.poll(() => state(page, (s) => s.mls?.cloud?.count ?? 0)).toBeGreaterThan(1000);
  });

  test('tab 5: SLAM drift + loop closure', async ({ page }) => {
    await go(page, 5);
    await page.getByRole('button', { name: 'SLAM', exact: true }).click();
    await page.evaluate(() => window.__lab.getState().patch({ slamParams: { ...window.__lab.getState().slamParams, loopClosure: true } }));
    await page.getByTestId('run-slam').click();
    await expect.poll(() => state(page, (s) => s.slam?.ateAfter ?? null), { timeout: 120000 }).not.toBeNull();
    const r = await state(page, (s) => ({ b: s.slam.ateBefore, a: s.slam.ateAfter }));
    expect(r.a).toBeLessThan(r.b);
  });

  test('tab 4: point cloud registration - ICP corrects a rigid error', async ({ page }) => {
    await go(page, 4);
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
    await go(page, 6);
    await page.getByText('Noise + outliers + clean').click();
    await expect.poll(() => state(page, (s) => s.proc.quality?.injected ?? 0), { timeout: 60000 }).toBeGreaterThan(100);
    const q = await state(page, (s) => s.proc.quality);
    expect(q.injectedLeft / q.injected).toBeLessThan(0.5);
    await page.getByRole('button', { name: 'Result', exact: true }).click();
    await page.getByTestId('reset-original').click();
    await expect.poll(() => state(page, (s) => s.proc.steps.length)).toBe(0);
    await go(page, 7);
    await page.getByTestId('run-seg').click();
    await expect.poll(() => state(page, (s) => s.seg.gt?.recovered?.length ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(3);
  });

  test('tab 7: LiDAR vs reconstruction needs valid alignment before reporting errors', async ({ page }) => {
    await go(page, 8);
    await expect(page.getByRole('button', { name: 'Exercise' })).toHaveCount(0);
    await expect.poll(() => state(page, (s) => !!s.recon.lidar), { timeout: 60000 }).toBe(true);
    await page.getByTestId('reconstruct').click();
    await expect.poll(() => state(page, (s) => !!s.recon.out), { timeout: 60000 }).toBe(true);
    await page.getByTestId('mesh-toolbar').click();
    await expect.poll(() => page.getByTestId('photo-strip').count()).toBe(1);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByTestId('recon-stats')).toHaveCount(0); // no statistics before alignment
    await page.getByTestId('align-recon').click();
    await expect(page.getByTestId('recon-stats')).toBeVisible({ timeout: 90000 });
  });

  test('tab 8: scene graph, node selection and offline queries (incl. local-llm-fit card)', async ({ page }) => {
    await go(page, 9);
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await page.getByTestId('node-table-1').click();
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('node-details')).toContainText('table-1');
    await expect.poll(() => state(page, (s) => s.selectedObjectId)).toBe('table-1');
    await page.getByTestId('query-input').fill('Which objects intersect the walking corridor?');
    await page.getByTestId('ask').click();
    await expect(page.getByTestId('answer')).toContainText(/Box in corridor/i);
    await page.getByText('Which object is closest to the scanner?').first().click();
    await expect(page.getByTestId('answer')).toContainText('closest');
    await page.getByRole('button', { name: 'LLM', exact: true }).click();
    const link = page.getByTestId('llm-fit-link');
    await expect(link).toHaveAttribute('href', 'https://maninka123.github.io/local-llm-fit/');
  });

  test('tab 9: challenge dashboard and summary downloads', async ({ page }) => {
    await go(page, 10);
    await expect(page.getByTestId('challenges-page')).toContainText('of 9 challenges complete');
    const [j] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-json').click()]);
    expect(j.suggestedFilename()).toBe('lidar-lab-summary.json');
    const [p] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-pdf').click()]);
    expect(p.suggestedFilename()).toBe('lidar-lab-summary.pdf');
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
