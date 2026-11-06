import { sampleConfig } from '../tests/helpers/twinStrategies';
import { initialSave } from '../src/twin/store';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({page})=>{await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));});
test('thank-you sidebar theme is scoped to the active tab',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-19').click();await expect(page.getByTestId('thanks-page')).toBeVisible();
 await expect(page.locator('.sidebar')).toHaveClass(/sidebar-thanks/);await page.screenshot({path:'output/playwright/thanks-sidebar.png'});
 await page.getByTestId('nav-9').click();await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-thanks/);
});
test('SLAM draws an open route, closes explicitly, compares both maps and exposes top view controls',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-9').click();
 await page.getByRole('button',{name:'Learn',exact:true}).click();await expect(page.getByTestId('slam-route-needed')).toContainText('add at least two waypoints');await page.getByRole('button',{name:'Controls',exact:true}).click();
 await expect(page.getByRole('group',{name:'Mobile platform',exact:true})).toBeVisible();
 for(const label of ['Handheld','Vehicle','UAV']) await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'UAV',exact:true}).click();await expect(page.getByLabel('Flight height',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Vehicle',exact:true}).click();
 await expect(page.getByText('Noisy odometry',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Graphite',exact:true})).toHaveCount(0);
 await expect(page.getByRole('toolbar',{name:'View controls'}).getByLabel('Scene opacity',{exact:true})).toBeVisible();
 await page.getByTestId('points-only').click();await expect(page.getByTestId('points-only')).toHaveText('Show scene');await page.getByTestId('points-only').click();
 await page.getByTestId('add-waypoints-tool').click();const plan=page.getByLabel('Top-down plan view',{exact:true});
 await plan.click({position:{x:50,y:80}});await plan.click({position:{x:180,y:80}});await plan.click({position:{x:180,y:130}});
 const before=await page.evaluate(()=> (window as any).__lab.getState().waypoints.length);expect(before).toBe(3);
 await page.getByTestId('close-route').click();await expect(page.getByLabel('Apply loop closure',{exact:true})).toBeChecked();
 const route=await page.evaluate(()=> (window as any).__lab.getState().waypoints);expect(route).toHaveLength(4);expect(route[3]).toEqual(route[0]);
 await page.getByTestId('run-slam').click();await expect(page.getByRole('group',{name:'Loop closure output'})).toBeVisible({timeout:120000});
 await page.getByRole('button',{name:'Without loop closure',exact:true}).click();await expect(page.getByRole('button',{name:'Without loop closure',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:'output/playwright/slam-controls.png'});
});
test('challenge starts with one mission, measures failure, saves equipment, and keeps future controls locked',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('twin-mission-1')).toBeEnabled();for(let i=2;i<=7;i++)await expect(page.getByTestId(`twin-mission-${i}`)).toBeDisabled();
 await expect(page.getByTestId('mission-brief')).toContainText('Design the sensing network');await expect(page.getByTestId('twin-buy-cam-mid')).toHaveCount(0);
 await expect(page.getByTestId('mission-evaluate')).toBeDisabled();
 await expect(page.getByRole('region',{name:'Coverage check'})).toContainText('Add a LiDAR');
 await page.getByLabel('Coverage preview',{exact:true}).selectOption('all');await expect(page.getByLabel('Coverage preview',{exact:true})).toHaveValue('all');
 await page.getByLabel('Coverage preview',{exact:true}).selectOption('critical');
 await page.screenshot({path:'output/playwright/mission-panel-desktop.png'});
 await page.setViewportSize({width:1366,height:900});await page.screenshot({path:'output/playwright/mission-panel-laptop.png'});
 const budget=await page.getByTestId('twin-budget').boundingBox(), check=await page.getByRole('region',{name:'Coverage check'}).boundingBox();
 if(budget&&check)await page.screenshot({path:'output/playwright/mission-panel-detail.png',clip:{x:budget.x-5,y:budget.y-5,width:budget.width+10,height:check.y+check.height-budget.y+10}});
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('mission-evaluate').click();await expect(page.getByTestId('mission-result')).toContainText('Needs improvement',{timeout:120000});
 await expect(page.getByTestId('twin-mission-2')).toBeDisabled();await expect.poll(() => page.evaluate(() => !!JSON.parse(localStorage.getItem('lidar-lab-twin') || '{}').progress?.results?.[0])).toBe(true);await page.reload();await page.getByTestId('nav-18').click();await expect(page.getByTestId('twin-owned')).toContainText('Low-resolution');await expect(page.getByTestId('mission-result')).toContainText('Needs improvement');
 await page.screenshot({path:'output/playwright/mission-one.png'});
});

const openTools = async (page: import('@playwright/test').Page, mission: number, stage: number, blocks: string[] = []) => {
 await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('mission-brief')).toBeVisible();
 const save=initialSave();save.progress.unlocked=mission;save.progress.current=mission;save.stage=stage;
 const cfg=sampleConfig('low');save.design=cfg.design;save.pipeline=cfg.pipeline.filter(b=>blocks.includes(b.kind));
 await page.evaluate(save=>(window as any).__twin.getState().importSave(save),save);
 await expect(page.getByTestId('mission-brief')).toBeVisible();
};
test('catalogue compares real specifications, enforces budget and supports removal and resolution',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByLabel('Compare Low-resolution rotating (16 ch)',{exact:true}).click();await page.getByLabel('Compare Medium-resolution rotating (32 ch)',{exact:true}).click();await expect(page.getByTestId('equipment-compare')).toContainText('Resolution');
 await expect(page.getByTestId('twin-buy-tls')).toBeDisabled();await page.getByTestId('twin-buy-rot32').click();await page.getByTestId('twin-buy-rot32').click();
 await expect(page.getByTestId('twin-owned')).toContainText('LiDAR 2');await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Deploy',exact:true}).click();
 await page.getByTestId('twin-unit-l1').click();await page.getByLabel('Measurement resolution',{exact:true}).selectOption('fine');
 await expect.poll(()=>page.evaluate(()=>(window as any).__twin.getState().design.lidars[0].res)).toBe('fine');
 const tilt=page.getByLabel('Tilt up (+) / down (−)');await expect(tilt).toHaveAttribute('min','-90');await expect(tilt).toHaveAttribute('max','90');
 await expect(page.getByTestId('twin-plan').locator('canvas')).toBeVisible();await page.getByTestId('twin-plan-toggle').click();await expect(page.getByTestId('twin-plan').locator('canvas')).toHaveCount(0);
 await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Equipment',exact:true}).click();await page.getByTestId('twin-remove-l1').click();await expect(page.getByTestId('twin-owned')).not.toContainText('LiDAR 2');
});
test('calibration pairing persists, assistance follows inspection, and output uses camera colours',async({page})=>{
 await openTools(page,4,3,['icp','crop','voxel','sor','ground','planes','euclid','classify']);
 await page.getByTestId('twin-unit-c1').click();await page.getByTestId('twin-pair-l2').click();await expect(page.getByTestId('twin-unit-c1')).toContainText('LiDAR 2');
 await expect(page.getByTestId('twin-cal-auto')).toBeDisabled();await page.getByRole('button',{name:'Inspect marker error',exact:true}).click();await page.getByLabel('Camera x',{exact:true}).fill('0.01');await expect(page.getByTestId('twin-cal-auto')).toBeEnabled();await page.getByTestId('twin-cal-auto').click();
 await expect(page.getByTestId('twin-cal-rms')).toContainText('saved');await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lidar-lab-twin')||'{}').design?.cameras?.[0]?.pairedLidarId)).toBe('l1');
 await page.reload();await page.getByTestId('nav-18').click();await page.getByTestId('twin-unit-c1').click();await expect(page.getByTestId('twin-unit-c1')).toContainText('LiDAR 2');
});
test('processing tools stay mission-specific and retain parallel filters, previews and selection',async({page})=>{
 await openTools(page,2,5,['icp']);
 await page.evaluate(() => { const s=(window as any).__twin.getState();s.set({design:{...s.design,cameras:[]},pipeline:[...s.pipeline,{id:'future-colour',kind:'colour',params:{votes:4,share:60}}]}); });
 await expect(page.getByTestId('mission-evaluate')).toBeEnabled();
 await expect(page.getByTestId('twin-add-phase-4')).toHaveCount(0);await expect(page.getByTestId('twin-add-phase-1')).toHaveCount(0);
 await page.getByTestId('twin-add-phase-2').selectOption('voxel');await page.getByTestId('twin-add-phase-2').selectOption('sor');await page.getByTestId('twin-add-phase-2').selectOption('ror');await page.getByTestId('twin-par-3').click();await page.getByTestId('twin-par-4').click();await expect(page.getByTestId('twin-parallel-group')).toHaveCount(1);
 await page.getByTestId('twin-expand-builder').click();await expect(page.getByTestId('twin-pipe-overlay')).toBeVisible();await page.getByTestId('twin-collapse-builder').click();
 await page.getByRole('button',{name:'Saved pipelines',exact:true}).click();await page.getByTestId('twin-save-pipe').click();await expect(page.getByRole('button',{name:'Pipeline 1',exact:true})).toBeVisible();
 await page.getByTestId('twin-run-canvas').click();await expect(page.getByTestId('twin-canvas-steps')).toBeVisible({timeout:120000});await expect(page.getByTestId('twin-points-2')).toContainText('%');
});
test('an actual connected project unlocks all seven missions and evaluates new final scenarios',async({page})=>{
 test.setTimeout(600000);await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('mission-brief')).toBeVisible();
 const save={...initialSave(),...sampleConfig('low')};await page.evaluate(save=>(window as any).__twin.getState().importSave(save),save);
 for(let mission=0;mission<6;mission++){
  await page.getByTestId('mission-evaluate').click();await expect(page.getByTestId('mission-continue')).toBeVisible({timeout:120000});
  console.log(`Mission ${mission+1} passed`);
  await page.getByTestId('mission-continue').click();await expect(page.getByTestId(`twin-mission-${mission+2}`)).toHaveAttribute('aria-current','step');
 }
 await page.getByTestId('twin-final').click();await expect(page.getByTestId('twin-final-result')).toBeVisible({timeout:150000});await expect(page.getByTestId('twin-final-result')).toContainText('/ 100');
 await expect(page.getByRole('group',{name:'Final scenario'})).toContainText('101');await page.getByRole('group',{name:'Final scenario'}).getByRole('button',{name:'Scenario 202',exact:true}).click();await page.getByRole('group',{name:'Final scenario'}).getByRole('button',{name:'Scenario 101',exact:true}).click();await page.getByTestId('completion-report').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/mission-final.png'});
 const download=page.waitForEvent('download');await page.getByTestId('twin-report').click();expect((await download).suggestedFilename()).toContain('report.md');
 await page.getByTestId('twin-mission-1').click();await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Deploy',exact:true}).click();await page.getByTestId('twin-unit-l1').click();await page.getByLabel('Height',{exact:true}).fill('2');
 await page.getByTestId('twin-mission-7').click();await expect(page.getByTestId('twin-final')).toBeDisabled();await expect(page.getByTestId('twin-final-result')).toHaveCount(0);
});
