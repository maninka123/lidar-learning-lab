import { test, expect, Page } from '@playwright/test';

declare global { interface Window { __lab: { getState: () => any; setState: (p: any) => void } } }

const go = async (page: Page, tab: number) => { await page.getByTestId(`nav-${tab}`).click(); await page.waitForTimeout(400); };
const state = <T,>(page: Page, fn: (s: any) => T) => page.evaluate((src) => { const f = new Function('s', `return (${src})(s)`); return f(window.__lab.getState()); }, fn.toString());

test.describe('LiDAR Learning Lab', () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('nav-4')).toBeVisible();
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
    await go(page, 7);
    await page.getByTestId('run-mls').click();
    await expect.poll(() => state(page, (s) => s.mls?.cloud?.count ?? 0), { timeout: 90000 }).toBeGreaterThan(500);
    await page.getByText('Loop preset').click();
    await expect(page.getByTestId('points-calc')).toContainText('points per second');
    await page.getByTestId('run-mls').click();
    await expect.poll(() => state(page, (s) => s.mls?.seconds ?? 0), { timeout: 120000 }).toBeGreaterThan(2);
    await expect.poll(() => state(page, (s) => s.mls?.cloud?.count ?? 0)).toBeGreaterThan(1000);
  });

  test('tab 5: SLAM drift + loop closure', async ({ page }) => {
    await go(page, 7);
    await page.getByRole('button', { name: 'SLAM', exact: true }).click();
    await page.evaluate(() => window.__lab.getState().patch({ slamParams: { ...window.__lab.getState().slamParams, loopClosure: true } }));
    await page.getByTestId('run-slam').click();
    await expect.poll(() => state(page, (s) => s.slam?.ateAfter ?? null), { timeout: 120000 }).not.toBeNull();
    const r = await state(page, (s) => ({ b: s.slam.ateBefore, a: s.slam.ateAfter }));
    expect(r.a).toBeLessThan(r.b);
  });

  test('tab 4: point cloud registration - ICP corrects a rigid error', async ({ page }) => {
    await go(page, 5);
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
    await go(page, 4);
    await page.getByText('Noise + outliers + clean').click();
    await expect.poll(() => state(page, (s) => s.proc.quality?.injected ?? 0), { timeout: 60000 }).toBeGreaterThan(100);
    const q = await state(page, (s) => s.proc.quality);
    expect(q.injectedLeft / q.injected).toBeLessThan(0.5);
    await page.getByRole('button', { name: 'Result', exact: true }).click();
    await page.getByTestId('reset-original').click();
    await expect.poll(() => state(page, (s) => s.proc.steps.length)).toBe(0);
    await go(page, 10);
    await page.getByTestId('run-seg').click();
    await expect.poll(() => state(page, (s) => s.seg.gt?.recovered?.length ?? 0), { timeout: 60000 }).toBeGreaterThanOrEqual(3);
  });

  test('tab 7: LiDAR vs reconstruction needs valid alignment before reporting errors', async ({ page }) => {
    await go(page, 15);
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

  test('tab 12: scene graph on the classroom, offline queries, local-llm-fit card and direct DeepSeek inference (mocked)', async ({ page }) => {
    await page.route('**/api/deepseek/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '# Summary\n\n**Room:** a classroom per the graph.\n\n- z near 0 is the floor\n- some tables' } }], usage: { prompt_tokens: 9876, completion_tokens: 21 } }) }));
    await go(page, 11);
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
    await page.getByTestId('gs-send').click();
    await expect(page.getByTestId('gs-answer')).toContainText('graph');
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
  await page.getByTestId('nav-7').click();
  await expect.poll(() => page.evaluate(() => (window as any).__lab.getState().sceneId)).toBe('D');
  await page.getByRole('button', { name: 'SLAM', exact: true }).click();
  await page.getByRole('button', { name: 'Mobile scanning', exact: true }).click();
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
    await go2(page, 13);
    await expect(page.getByTestId('stats-card')).toContainText(/Walls found\s*\d+/, { timeout: 90000 });
    const t = await page.getByTestId('stats-card').innerText();
    expect(parseInt(t.match(/Walls found\s*(\d+)/)![1])).toBeGreaterThanOrEqual(4);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-dxf').click()]);
    expect(dl.suggestedFilename()).toBe('classroom_walls.dxf');
  });
  test('tab 11: change detection finds the edits', async ({ page }) => {
    await go2(page, 14);
    await expect(page.getByTestId('make-scan2')).toBeEnabled({ timeout: 90000 });
    await page.getByTestId('make-scan2').click();
    await expect(page.getByTestId('align-scans')).toBeEnabled({ timeout: 90000 });
    await page.getByTestId('align-scans').click();
    await expect(page.getByText(/after alignment/)).toBeVisible({ timeout: 120000 });
    await page.getByTestId('find-changes').click();
    await expect(page.getByText('4 · What changed')).toBeVisible({ timeout: 120000 });
  });
  test('tab 12: meshing builds a surface', async ({ page }) => {
    await go2(page, 9);
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
  await page.getByTestId('nav-6').click();
  await page.getByTestId('tls-preset-3').click();
  await page.getByRole('button', { name: 'Coarse' }).click();
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
  await page.getByTestId('nav-8').click();
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
  await page.getByTestId('nav-4').click();
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
  await page.getByTestId('nav-10').click();
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
  await page.getByTestId('nav-11').click();
  await page.getByRole('button', { name: '2 Scene graph', exact: true }).click();
  await page.getByRole('button', { name: 'My labelled clusters' }).click();
  await expect(page.getByTestId('graph-view')).toContainText('Chair 1');
  await expect(page.getByTestId('graph-view')).toContainText('Table 1');
});

test('segmentation: planes first, then clusters, as two separate stages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-10').click();
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
  await page.getByTestId('nav-12').click();
  await page.getByTestId('mv-play').click();
  await page.getByTestId('mv-play').click();
  await page.getByRole('button', { name: '2 Clouds', exact: true }).click();
  await expect(page.getByText(/k points in this frame/)).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: '3 Graphs', exact: true }).click();
  await expect(page.getByTestId('seg-stats')).toContainText('ms');
  await expect(page.getByTestId('frame-graph')).toBeVisible();
  await page.getByRole('button', { name: '4 Over time', exact: true }).click();
  await expect(page.getByTestId('track-count')).toContainText(/\d+ tracked objects/);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByRole('button', { name: '5 Results', exact: true }).click();
  await expect(page.getByTestId('events')).toContainText('f');
  await page.getByRole('button', { name: '6 Ask AI', exact: true }).click();
  await page.getByTestId('mv-prompt').click();
  await expect(page.getByTestId('mv-prompt-text')).toContainText('TEMPORAL SCENE GRAPH');
  await page.getByTestId('mv-question').fill('What is moving?');
  await page.getByTestId('mv-ask').click();
  await expect(page.getByTestId('mv-answer')).toContainText('crosses ahead');
  await page.getByTestId('mv-question').fill('And who is closest?');
  await page.getByTestId('mv-ask').click();
  await expect(page.getByTestId('mv-chat').getByText('And who is closest?')).toBeVisible();
  await expect(page.getByTestId('mv-chat').locator('.callout')).toHaveCount(2);
});

test.describe('corner cases', () => {
  test('TLS tab: changing the environment while a scan is running leaves nothing of the old one behind', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-6').click();
    await page.getByTestId('tls-preset-3').click();
    await page.getByRole('button', { name: 'Fine' }).click();
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
    for (let i = 0; i < 16; i++) { await page.getByTestId(`nav-${i}`).click(); await page.waitForTimeout(700); await expect(page.locator('canvas').first()).toBeVisible(); }
    expect(bad).toEqual([]);
  });

  test('TLS tab: needs a station, works with just one, and the city is not left selected in other tabs', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-6').click();
    await expect(page.getByTestId('scan-stations')).toBeDisabled();
    await page.getByTestId('add-stations-tool').click();
    await page.getByTestId('environment-menu').click();
    await page.getByTestId('env-A').click();
    await page.evaluate(() => (window as any).__lab.getState().patch({ pendingStation: [0, 0] }));
    await page.getByRole('button', { name: 'Coarse' }).click();
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

  test('CAD with a slice at the ceiling, change detection without edits', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-13').click();
    await expect(page.getByTestId('stats-card')).toContainText(/Walls found\s*\d+/, { timeout: 90000 });
    await page.getByTestId('nav-14').click();
    await expect(page.getByTestId('make-scan2')).toBeEnabled({ timeout: 90000 });
    for (const name of ['One object removed', 'One object moved', 'A new box added', 'Scanner position slightly off']) await page.getByText(name, { exact: true }).click();
    await page.getByTestId('make-scan2').click();
    await page.getByTestId('find-changes').click();
    await expect(page.getByText('4 · What changed')).toBeVisible({ timeout: 120000 });
  });
});
