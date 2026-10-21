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
    await page.evaluate(() => window.__lab.getState().setPreset('planar'));
    await expect(page.getByText('Vertical FOV', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.__lab.getState().setPreset('rot32'));
    await page.getByTestId('log-scan').click();
    await expect(page.getByTestId('scan-log')).toBeVisible();
  });

  test('tab 2: pick points, measure, colour modes and export', async ({ page }) => {
    await go(page, 1);
    await page.getByTestId('run-scan').click();
    await expect.poll(() => state(page, (s) => !!s.clouds.scan)).toBe(true);
    await go(page, 2);
    await page.getByTestId('pick-mode').click();
    await page.evaluate(() => {
      const s = window.__lab.getState(); const c = s.clouds.scan;
      const picks = [0, 500, 1500, 4000, 9000].map((i) => ({ cloudId: c.id, index: i, pos: [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]] }));
      s.patch({ picks });
    });
    await expect(page.getByTestId('distance-table')).toContainText('Path length');
    await expect(page.getByTestId('point-info')).toContainText('Intensity');
    await expect(page.getByTestId('point-info')).toContainText('RGB');
    const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.getByTestId('export-menu').click(); await page.getByTestId('export-ply').click(); })()]);
    expect(dl.suggestedFilename()).toMatch(/\.ply$/);
  });

  test('tab 3: two TLS stations then an MLS trajectory', async ({ page }) => {
    await go(page, 3);
    await page.getByTestId('add-station-here').click();
    await expect.poll(() => state(page, (s) => s.stations.length)).toBe(1);
    await page.evaluate(() => window.__lab.getState().setPose({ x: -2.6, y: -1.8 }));
    await page.getByTestId('add-station-here').click();
    await expect.poll(() => state(page, (s) => s.stations.length)).toBe(2);
    await expect.poll(() => state(page, (s) => s.tlsCoverage?.coveredPct ?? 0)).toBeGreaterThan(30);
    await page.getByText('Moving (MLS)').click();
    await page.getByText('Loop preset').click();
    await page.getByTestId('run-mls').click();
    await expect.poll(() => state(page, (s) => s.mls?.cloud?.count ?? 0), { timeout: 120000 }).toBeGreaterThan(1000);
    await page.getByText('Compare', { exact: true }).click();
    await expect(page.getByTestId('compare-table')).toContainText('Coverage');
  });

  test('tab 4: SLAM drift + loop closure, and ICP corrects a rigid error', async ({ page }) => {
    await go(page, 4);
    await page.evaluate(() => window.__lab.getState().patch({ slamParams: { ...window.__lab.getState().slamParams, loopClosure: true } }));
    await page.getByTestId('run-slam').click();
    await expect.poll(() => state(page, (s) => s.slam?.ateAfter ?? null), { timeout: 120000 }).not.toBeNull();
    const r = await state(page, (s) => ({ b: s.slam.ateBefore, a: s.slam.ateAfter }));
    expect(r.a).toBeLessThan(r.b);
    await page.getByText('Registration (ICP)').click();
    await expect.poll(() => state(page, (s) => !!s.reg.A && !!s.reg.B)).toBe(true);
    await page.getByTestId('run-icp').click();
    await expect.poll(() => state(page, (s) => s.reg.after?.rmse ?? null), { timeout: 120000 }).not.toBeNull();
    const reg = await state(page, (s) => ({ b: s.reg.before.rmse, a: s.reg.after.rmse, e: s.reg.recoveredErr }));
    expect(reg.a).toBeLessThan(reg.b * 0.5);
    expect(reg.e.t).toBeLessThan(0.05);
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
    await page.getByTestId('reset-original').click();
    await expect.poll(() => state(page, (s) => s.proc.steps.length)).toBe(0);
    await go(page, 6);
    await page.getByTestId('run-seg').click();
    await expect.poll(() => state(page, (s) => s.seg.gt?.recovered?.length ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(3);
  });

  test('tab 7: LiDAR vs reconstruction needs valid alignment before reporting errors', async ({ page }) => {
    await go(page, 7);
    await expect.poll(() => state(page, (s) => !!s.recon.lidar), { timeout: 60000 }).toBe(true);
    await page.getByTestId('reconstruct').click();
    await expect.poll(() => state(page, (s) => !!s.recon.out), { timeout: 60000 }).toBe(true);
    await expect(page.getByTestId('recon-stats')).toHaveCount(0); // no statistics before alignment
    await page.getByTestId('align-recon').click();
    await expect(page.getByTestId('recon-stats')).toBeVisible({ timeout: 90000 });
  });

  test('tab 8: scene graph, node selection and offline queries (incl. local-llm-fit card)', async ({ page }) => {
    await go(page, 8);
    await page.getByTestId('node-table-1').click();
    await expect(page.getByTestId('node-details')).toContainText('table-1');
    await expect.poll(() => state(page, (s) => s.selectedObjectId)).toBe('table-1');
    await page.getByTestId('query-input').fill('Which objects intersect the walking corridor?');
    await page.getByTestId('ask').click();
    await expect(page.getByTestId('answer')).toContainText(/Box in corridor/i);
    await page.getByText('Which object is closest to the scanner?').first().click();
    await expect(page.getByTestId('answer')).toContainText('closest');
    await page.getByText('3D AI with a real LLM').click();
    const link = page.getByTestId('llm-fit-link');
    await expect(link).toHaveAttribute('href', 'https://maninka123.github.io/local-llm-fit/');
  });

  test('tab 9: challenge dashboard and summary downloads', async ({ page }) => {
    await go(page, 9);
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
    await page.getByTestId('environment-menu').click();
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
