import { sampleConfig } from '../tests/helpers/twinStrategies';
import { initialSave } from '../src/twin/store';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({page})=>{await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));});
test('saved mission targets and all budget displays follow the current admin budget',async({page})=>{
 const save=initialSave();save.settings={...save.settings,budget:3000,budgetVersion:undefined};save.design={...save.design,cameras:[]};
 save.progress.results[0]={at:1,fingerprint:'previous-project',level:'needs-improvement',score:50,stale:true,metrics:[{label:'Critical-area measured coverage',value:61.9,target:70,unit:'%'},{label:'Equipment cost',value:2480,target:3000,unit:'credits',lower:true}],feedback:[]};
 await page.addInitScript(save=>localStorage.setItem('lidar-lab-twin',JSON.stringify(save)),save);
 await page.goto('/');await page.getByTestId('nav-18').click();
 const bill=page.getByRole('table',{name:'Your bill',exact:true});
 const assertBudget=async(amount:string)=>{
  await expect(bill.locator('.bill-row').filter({hasText:'Budget'}).locator('.bill-amt')).toHaveText(amount);
  await expect(bill.locator('.bill-row').filter({hasText:'Remaining'}).locator('.bill-amt')).toHaveText(amount);
  await expect(page.getByTestId('twin-budget')).toContainText(`Total ${amount}`);
 };
 await assertBudget('$8,000');await expect(page.getByTestId('mission-result')).toHaveCount(0);await expect(page.getByTestId('mission-not-tested')).toBeVisible();
 await page.evaluate(()=>{const s=(window as any).__twin.getState();s.set({settings:{...s.settings,budget:1000}});});
 await assertBudget('$5,000');
 await page.evaluate(()=>{const s=(window as any).__twin.getState();s.set({settings:{...s.settings,budget:1600}});});
 await assertBudget('$8,000');
 await expect(bill.locator('.bill-head')).toContainText('US$');
 await bill.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/budget-8000.png'});
 await page.getByTestId('twin-buy-rot16').click();
 await expect(page.getByTestId('mission-result').locator('.mission-metric').filter({hasText:'Equipment cost'})).toHaveCount(0); // the budget card already shows the spending
 await page.getByTestId('twin-remove-l1').click();
 await expect(page.getByTestId('mission-result')).toHaveCount(0);await expect(page.getByTestId('mission-not-tested')).toBeVisible();
 await expect(page.getByText('61.9 %',{exact:true})).toHaveCount(0);
 await page.screenshot({path:'output/playwright/no-sensor-results.png'});
});
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
 await expect(page.getByLabel('Coverage preview',{exact:true})).toHaveCount(0);
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
 const cfg=sampleConfig('low');save.design=cfg.design;save.settings=cfg.settings;save.pipeline=cfg.pipeline.filter(b=>blocks.includes(b.kind));
 await page.evaluate(save=>(window as any).__twin.getState().importSave(save),save);
 await expect(page.getByTestId('mission-brief')).toBeVisible();
};
test('catalogue compares real specifications, enforces budget and supports removal and resolution',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByLabel('Compare Low-resolution rotating (16 ch)',{exact:true}).click();await page.getByLabel('Compare Medium-resolution rotating (32 ch)',{exact:true}).click();await expect(page.getByTestId('equipment-compare')).toContainText('Resolution');
 for(const retired of ['tls','tls-hire','mobile32'])await expect(page.getByTestId(`twin-buy-${retired}`)).toHaveCount(0);await page.getByTestId('twin-buy-rot32').click();await page.getByTestId('twin-buy-rot32').click();
 await expect(page.getByTestId('twin-owned')).toContainText('LiDAR 2');await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Deploy',exact:true}).click();
 await page.getByTestId('twin-unit-l1').click();await expect(page.getByLabel('Measurement resolution',{exact:true})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).__twin.getState().design.lidars[0].res)).toBe('standard');
 const tilt=page.getByLabel('Tilt up (+) / down (−)');await expect(tilt).toHaveAttribute('min','-90');await expect(tilt).toHaveAttribute('max','90');
 await expect(page.getByTestId('twin-plan').locator('canvas')).toBeVisible();await page.getByTestId('twin-plan-toggle').click();await expect(page.getByTestId('twin-plan').locator('canvas')).toHaveCount(0);
 await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Equipment',exact:true}).click();await page.getByTestId('twin-remove-l1').click();await expect(page.getByTestId('twin-owned')).not.toContainText('LiDAR 2');
});
test('only fixed LiDARs are sold, and the budget stops purchases',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('mission-brief')).toBeVisible();
 await page.evaluate(()=>{const s=(window as any).__twin.getState();s.set({settings:{...s.settings,budget:3000}});});
 await page.getByTestId('twin-buy-rot128').click();await page.getByTestId('twin-buy-rot128').click();
 await expect(page.getByTestId('twin-buy-rot128')).toBeDisabled();
});
test('alignment focuses one scan, reviews results, and resets dependent scans when retried or retuned',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await openTools(page,1,5,['icp']);
 await expect(page.getByTestId('align-panel')).toContainText('Start with a scan');
 await expect(page.getByTestId('mission-evaluate')).toBeDisabled();
 await page.getByTestId('align-go-acquire').click();
 const acquire=await page.getByTestId('twin-acquire').boundingBox();expect(acquire!.y+acquire!.height).toBeLessThan(900);
 await page.getByTestId('twin-acquire').click();await expect(page.getByTestId('twin-survey')).toBeVisible();
 await page.getByTestId('align-open').click();await expect(page.getByTestId('align-next')).toBeDisabled();
 await page.getByTestId('align-scan-1').click();await expect(page.getByTestId('align-result-1')).toBeVisible();
 const next=await page.getByTestId('align-next').boundingBox();expect(next!.y+next!.height).toBeLessThan(900);
 await page.screenshot({path:'output/playwright/alignment-laptop.png'});
 await page.getByTestId('align-next').click();await expect(page.getByTestId('align-result-1')).toHaveCount(0);
 await page.getByTestId('align-scan-2').click();await expect(page.getByTestId('align-summary')).toBeVisible();
 await expect(page.getByTestId('mission-evaluate')).toBeEnabled();
 await page.getByRole('button',{name:'Previous scan',exact:true}).click();await page.getByTestId('align-redo-1').click();
 await expect(page.getByRole('progressbar',{name:'Scans tested'})).toHaveAttribute('aria-valuenow','1');
 await expect(page.getByTestId('align-summary')).toHaveCount(0);await expect(page.getByTestId('mission-evaluate')).toBeDisabled();
 await page.getByTestId('align-settings').locator('summary').click();await page.getByLabel('Iterations',{exact:true}).focus();await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('progressbar',{name:'Scans tested'})).toHaveAttribute('aria-valuenow','0');
 await expect(page.getByTestId('align-result-1')).toHaveCount(0);await expect(page.getByTestId('align-next')).toBeDisabled();
 await page.getByTestId('align-scan-1').click();await expect(page.getByTestId('align-result-1')).toBeVisible();
 await page.getByTestId('align-reset').click();await expect(page.getByRole('progressbar',{name:'Scans tested'})).toHaveAttribute('aria-valuenow','0');
});
test('critical inspection bay includes a camera, keeps the LiDARs fixed and registers the camera with the combined cloud',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();await expect(page.getByTestId('mission-brief')).toBeVisible();
 const save=initialSave();save.progress.current=4;save.progress.unlocked=4;save.stage=2;save.design={...save.design,lidars:sampleConfig('low').design.lidars};
 await page.evaluate(save=>(window as any).__twin.getState().importSave(save),save);
 const task=page.getByTestId('inspection-mission');await expect(task).toContainText('already yours');
 await expect(page.getByTestId('twin-unit-c1')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('twin-unit-l1')).toHaveCount(0);
 await expect(page.getByTestId('twin-place')).toBeVisible();await expect(page.getByLabel('Height',{exact:true})).toBeVisible();
 await page.getByTestId('inspection-calibrate').click();await expect(page.getByTestId('twin-combined-note')).toBeVisible();await expect(page.getByTestId('twin-pair-l1')).toHaveCount(0);
 await expect(page.getByTestId('twin-cal-auto')).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>(window as any).__twin.getState().design.cameras[0].pairedLidarId)).toBe('all');
 await page.screenshot({path:'output/playwright/critical-camera-bay.png'});
});
test('assisted calibration only opens once the error is below 10 px, and the large view opens',async({page})=>{
 await openTools(page,4,3,['icp','crop','voxel','sor','ground','planes','euclid','classify']);
 await expect(page.getByTestId('twin-cal-auto')).toBeEnabled(); // the sample camera is already well below 10 px
 await page.evaluate(()=>{const st=(window as any).__twin.getState(),d=st.design;st.set({design:{...d,cameras:d.cameras.map((c:any,i:number)=>i?c:{...c,cal:{...c.cal,est:{...c.cal.est,yawDeg:c.cal.est.yawDeg+9},done:false}})}});}); // far off: well over 10 px
 await expect(page.getByTestId('twin-cal-auto')).toBeDisabled();await expect(page.getByTestId('twin-cal-save')).toHaveCount(0);
 await page.getByTestId('twin-cal-enlarge').click();await expect(page.getByTestId('twin-cal-pop')).toBeVisible();await expect(page.getByLabel('Roll (lean sideways)',{exact:true})).toBeVisible();
 await page.getByTestId('twin-cal-close').click();await expect(page.getByTestId('twin-cal-pop')).toHaveCount(0);
});
test('processing tools stay mission-specific, always run in sequence in the cleaning mission, and keep previews and selection',async({page})=>{
 await openTools(page,2,5,['icp']);
 await page.evaluate(() => { const s=(window as any).__twin.getState();s.set({design:{...s.design,cameras:[]},pipeline:[...s.pipeline,{id:'future-colour',kind:'colour',params:{votes:4,share:60}}]}); });
 await expect(page.getByTestId('mission-evaluate')).toBeEnabled();
 await expect(page.getByTestId('twin-add-phase-4')).toHaveCount(0);await expect(page.getByTestId('twin-add-phase-1')).toHaveCount(0);
 await page.getByTestId('twin-add-phase-2').selectOption('voxel');await page.getByTestId('twin-add-phase-2').selectOption('sor');await page.getByTestId('twin-add-phase-2').selectOption('ror');await expect(page.getByTestId('twin-par-3')).toHaveCount(0);await expect(page.getByTestId('twin-seq-3')).toHaveCount(0);await expect(page.getByTestId('twin-parallel-group')).toHaveCount(0); // no choice between in sequence and in parallel
 await page.getByTestId('twin-expand-builder').click();await expect(page.getByTestId('twin-pipe-overlay')).toBeVisible();await page.getByTestId('twin-collapse-builder').click();
 await page.getByRole('button',{name:'Saved pipelines',exact:true}).click();await page.getByTestId('twin-save-pipe').click();await expect(page.getByRole('button',{name:'Pipeline 1',exact:true})).toBeVisible();
 await page.getByTestId('twin-run-canvas').click();await expect(page.getByTestId('twin-canvas-steps')).toBeVisible({timeout:120000});await expect(page.getByTestId('twin-points-2')).toContainText('%');
});
test('an actual connected project unlocks all seven missions and evaluates new final scenarios',async({page})=>{
 test.setTimeout(600000);await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('mission-brief')).toBeVisible();
 const save={...initialSave(),...sampleConfig('low')};await page.evaluate(save=>(window as any).__twin.getState().importSave(save),save);
 for(let mission=0;mission<6;mission++){
  if(mission===1){
   await expect(page.getByTestId('mission-evaluate')).toHaveCount(0); // not judged while the scans are only being acquired
   await page.getByTestId('twin-acquire').click();await expect(page.getByTestId('twin-survey')).toBeVisible();
   await page.getByTestId('align-open').click();
   for(let k=1;k<save.design.lidars.length;k++){
    await expect(page.getByTestId(`align-row-${k}`)).toBeVisible();
    await page.getByTestId(`align-scan-${k}`).click();await expect(page.getByTestId(`align-result-${k}`)).toBeVisible();
    await expect(page.getByTestId(`align-result-${k}`)).toContainText('Position error');
    const preview=page.getByRole('group',{name:'Alignment preview',exact:true});
    await preview.getByRole('button',{name:'Before alignment',exact:true}).click();
    await expect(preview.getByRole('button',{name:'Before alignment',exact:true})).toHaveAttribute('aria-pressed','true');
    await preview.getByRole('button',{name:'After alignment',exact:true}).click();
    if(k===1)await page.screenshot({path:'output/playwright/alignment-one-scan.png'});
    if(k<save.design.lidars.length-1)await page.getByTestId('align-next').click();
   }
   await expect(page.getByTestId('align-summary')).toBeVisible();
  }
  if(mission===5)await page.getByTestId('twin-show-changes').click();else await page.getByTestId('mission-evaluate').click();
  await expect(page.getByTestId('mission-continue')).toBeVisible({timeout:240000});
  console.log(`Mission ${mission+1} passed`);
  await page.getByTestId('mission-continue').click();await expect(page.getByTestId(`twin-mission-${mission+2}`)).toHaveAttribute('aria-current','step');
 }
 await page.getByTestId('twin-final').click();await expect(page.getByTestId('twin-final-result')).toBeVisible({timeout:150000});await expect(page.getByTestId('twin-total')).toContainText('/ 100');await expect(page.getByTestId('score-breakdown')).toBeVisible();
 await expect(page.getByRole('group',{name:'Final scenario'})).toContainText('101');await page.getByRole('group',{name:'Final scenario'}).getByRole('button',{name:'Scenario 202',exact:true}).click();await page.getByRole('group',{name:'Final scenario'}).getByRole('button',{name:'Scenario 101',exact:true}).click();await page.getByTestId('completion-report').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/mission-final.png'});
 const download=page.waitForEvent('download');await page.getByTestId('twin-report').click();expect((await download).suggestedFilename()).toContain('report.md');
 await page.getByTestId('twin-mission-1').click();await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Deploy',exact:true}).click();await page.getByTestId('twin-unit-l1').click();await page.getByLabel('Height',{exact:true}).fill('2');
 await page.getByTestId('twin-mission-7').click();await expect(page.getByTestId('twin-final')).toBeDisabled();await expect(page.getByTestId('twin-final-result')).toHaveCount(0);
});
test('the roof switch, the Deploy step order and the mandatory camera in the bill',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await expect(page.getByTestId('twin-roof')).toHaveAttribute('aria-checked','true');await page.getByTestId('twin-roof').click();await expect(page.getByTestId('twin-roof')).toHaveAttribute('aria-checked','false');await expect(page.getByTestId('twin-roof')).toContainText('Off');
 await expect(page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:/Deploy/})).toBeDisabled();
 await expect(page.getByTestId('twin-pick-first')).toBeVisible();
 await page.getByTestId('twin-buy-rot16').click();
 await expect(page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:/Deploy/})).toBeEnabled();
 await page.getByTestId('twin-next-deploy').click();await expect(page.getByTestId('twin-unit-l1')).toBeVisible();
 await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Equipment',exact:true}).click();
 await expect(page.getByTestId('twin-mandatory-note')).toContainText('$590');
 await expect(page.getByTestId('twin-owned')).toContainText('Mandatory');await expect(page.getByTestId('twin-remove-c1')).toHaveCount(0);
});
test('challenge statistics remain horizontal and contained at desktop and laptop widths',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();await page.getByTestId('twin-buy-rot16').click();
 await page.getByTestId('twin-next-deploy').click();await page.getByTestId('twin-roof').click();
 await page.getByTestId('mission-evaluate').click();await expect(page.getByTestId('mission-result')).toBeVisible({timeout:120000});
 const card=page.getByTestId('stats-card'), grid=card.locator('.stats-grid');await expect(grid.locator('.stat')).toHaveCount(4);
 for(const width of [1440,1300,1000]){
  await page.setViewportSize({width,height:900});
  const tiles=await grid.locator('.stat').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top})));
  expect(Math.max(...tiles.map(t=>t.top))-Math.min(...tiles.map(t=>t.top))).toBeLessThan(2);
  const layout=await grid.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth,overflow:getComputedStyle(el).overflowX}));
  expect(layout.content<=layout.width+1 || ['auto','scroll'].includes(layout.overflow)).toBe(true);
  const bounds=await card.boundingBox(), stage=await page.getByTestId('stage').boundingBox();
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(stage!.x+stage!.width);
  await page.screenshot({path:`output/playwright/challenge-stats-${width}.png`});
 }
 await page.getByTestId('stats-toggle').click();await expect(grid).toHaveCount(0);
 await page.getByTestId('stats-toggle').click();await expect(grid.locator('.stat')).toHaveCount(4);
});
test('scene LiDAR names and colours match all six equipment selectors',async({page})=>{
 await page.addInitScript(()=>{
  const draw=CanvasRenderingContext2D.prototype.fillText;
  (window as any).__drawnSensorLabels=[];
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,maxWidth){
   const size=Number(this.font.match(/([\d.]+)px/)?.[1]??0);
   if(size>20 && /^(LiDAR|Scanner) \d+$/.test(text)) (window as any).__drawnSensorLabels.push({text,colour:this.strokeStyle});
   if(maxWidth===undefined)draw.call(this,text,x,y);else draw.call(this,text,x,y,maxWidth);
  };
 });
 await page.goto('/');await page.getByTestId('nav-18').click();await expect(page.getByTestId('mission-brief')).toBeVisible();
 // Separate test storage; a larger allowance lets this exercise the entire six-colour palette.
 await page.evaluate(()=>{const state=(window as any).__twin.getState();state.set({settings:{...state.settings,budget:2000}});});
 for(let i=0;i<6;i++)await page.getByTestId('twin-buy-rot16').click();
 await page.getByTestId('twin-next-deploy').click();
 for(let i=1;i<=6;i++){
  const selector=page.getByTestId(`twin-unit-l${i}`);await expect(selector).toHaveText(`LiDAR ${i}`);
  const colour=await selector.evaluate(el=>{const ctx=document.createElement('canvas').getContext('2d')!;ctx.strokeStyle=getComputedStyle(el).borderColor;return ctx.strokeStyle;});
  await expect.poll(()=>page.evaluate(name=>(window as any).__drawnSensorLabels.filter((label:any)=>label.text===name).at(-1)?.colour,`LiDAR ${i}`)).toBe(colour);
 }
 expect(await page.evaluate(()=>(window as any).__drawnSensorLabels.some((label:any)=>label.text.startsWith('Scanner ')))).toBe(false);
 await page.getByTestId('twin-roof').click();await page.screenshot({path:'output/playwright/lidar-names-colours.png'});
});
test('challenge grid and axes are fixed on without toolbar toggles',async({page})=>{
 await page.goto('/');await page.getByTestId('nav-18').click();await expect(page.getByTestId('mission-brief')).toBeVisible();
 await page.evaluate(()=>(window as any).__lab.getState().setView({showGrid:false,showAxes:false}));
 const toolbar=page.getByRole('toolbar',{name:'View controls',exact:true});
 await expect(toolbar.getByRole('button',{name:'Toggle grid',exact:true})).toHaveCount(0);
 await expect(toolbar.getByRole('button',{name:'Toggle axes',exact:true})).toHaveCount(0);
 await expect(page.getByTestId('view-home')).toBeVisible();await expect(page.getByTestId('view-pan')).toBeVisible();
 await toolbar.getByRole('button',{name:'Points',exact:true}).click();
 await page.screenshot({path:'output/playwright/challenge-fixed-grid-axes.png'});
 await page.getByTestId('nav-9').click();
 await expect(toolbar.getByRole('button',{name:'Toggle grid',exact:true})).toBeVisible();
 await expect(toolbar.getByRole('button',{name:'Toggle axes',exact:true})).toBeVisible();
});
test('a unit can be moved again and again: the plan always moves it, and the place button stays on until pressed again or another unit is chosen',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('twin-buy-rot32').click();
 await page.getByTestId('twin-next-deploy').click();await page.getByTestId('twin-unit-l1').click();
 const pos=()=>page.evaluate(()=>{const u=(window as any).__twin.getState().design.lidars[0];return [Math.round(u.x*10),Math.round(u.y*10)];});
 const plan=page.getByLabel('Top-down plan view',{exact:true});
 const p0=await pos();
 await plan.click({position:{x:60,y:60}});const p1=await pos();expect(p1).not.toEqual(p0);
 await plan.click({position:{x:200,y:120}});const p2=await pos();expect(p2).not.toEqual(p1);   // again, without pressing anything
 const arm=page.getByTestId('twin-place');
 await arm.click();await expect(arm).toContainText('Placing LiDAR 1');
 await plan.click({position:{x:100,y:150}});await expect(arm).toContainText('Placing LiDAR 1');   // still on: it keeps moving that LiDAR
 const p3=await pos();expect(p3).not.toEqual(p2);
 await plan.click({position:{x:140,y:70}});await expect(arm).toContainText('Placing LiDAR 1');expect(await pos()).not.toEqual(p3);
 await arm.click();await expect(arm).toContainText('Place LiDAR 1 by clicking');                  // pressed again: off
 await arm.click();await expect(arm).toContainText('Placing LiDAR 1');
 await page.getByTestId('twin-unit-l2').click();await expect(arm).toContainText('Place LiDAR 2 by clicking'); // a different button: off
});

test('one LiDAR can be shown alone: only the points it sees, with its own legend',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('twin-buy-rot32').click();
 await page.getByTestId('twin-next-deploy').click();await page.getByTestId('twin-unit-l2').click();
 const solo=page.getByRole('switch').or(page.getByLabel(/Show only LiDAR 2/));
 await page.getByLabel("Show only LiDAR 2's points",{exact:false}).check({force:true});
 await expect(page.getByLabel('Legend')).toContainText('Only what LiDAR 2 sees');await expect(page.getByLabel('Legend')).not.toContainText('Not seen');
 await page.getByTestId('twin-unit-l1').click();await expect(page.getByLabel('Legend')).toContainText('Only what LiDAR 1 sees'); // it follows the selection
 await page.getByLabel("Show only LiDAR 1's points",{exact:false}).uncheck({force:true});await expect(page.getByLabel('Legend')).toContainText('No LiDAR sees it');
 void solo;
});

test('the same LiDAR can be bought again and again, with a count and a way to take one back',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 const buy=page.getByTestId('twin-buy-rot16');
 await expect(buy).toContainText('Add');await expect(page.getByTestId('twin-count-rot16')).toHaveCount(0);
 await buy.click();await expect(page.getByTestId('twin-count-rot16')).toHaveText('×1');await expect(buy).toContainText('Add another');
 await buy.click();await buy.click();await expect(page.getByTestId('twin-count-rot16')).toHaveText('×3');
 expect(await page.evaluate(()=>(window as any).__twin.getState().design.lidars.filter((u:any)=>u.item==='rot16').length)).toBe(3);
 await page.getByTestId('twin-less-rot16').click();await expect(page.getByTestId('twin-count-rot16')).toHaveText('×2');
});

test('each LiDAR, area by area: a details section that fills in after the measured test',async({page})=>{
 test.setTimeout(170000);
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('twin-buy-rot32').click();
 const box=page.getByTestId('mission-breakdown');await box.getByText('Each LiDAR, area by area').click();
 await expect(box).toContainText('Run the test');
 await page.getByTestId('mission-evaluate').click();await expect(page.getByTestId('mission-result')).toBeVisible({timeout:140000});
 await expect(box.getByRole('row',{name:/LiDAR 1/})).toBeVisible();await expect(box.getByRole('row',{name:/LiDAR 2/})).toBeVisible();await expect(box.getByRole('row',{name:/All together/})).toContainText('pts/m²');
 await expect(box).toContainText('Production');await expect(box).toContainText('Inspection');await expect(box).toContainText('Loading');
});
test('clicking the 3D view places the unit on the floor where you point, with the roof on or off, and Escape ends placing',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('twin-buy-rot32').click();
 await page.getByTestId('twin-next-deploy').click();await page.getByTestId('twin-unit-l1').click();
 const pos=()=>page.evaluate(()=>{const u=(window as any).__twin.getState().design.lidars[0];return [+u.x.toFixed(1),+u.y.toFixed(1)];});
 const box=(await page.locator('canvas').first().boundingBox())!;      // the first canvas is the 3D view; the small plan is the last one
 const click=async(fx:number,fy:number)=>{await page.mouse.click(box.x+box.width*fx,box.y+box.height*fy);await page.waitForTimeout(500);return pos();};
 const start=await pos();
 await page.getByTestId('twin-place').click();
 await expect(page.getByRole('button',{name:/^Done/})).toHaveCount(0);   // no second "Done" mode to get out of step
 const onRoof=await click(0.5,0.6);expect(onRoof).not.toEqual(start);expect(Math.abs(onRoof[1])).toBeLessThan(7.7);  // on the floor, not stuck against a wall
 await page.getByTestId('twin-roof').click();                               // roof off, still placing
 expect(await click(0.5,0.6)).toEqual(onRoof);                              // the same click lands in the same place
 await page.keyboard.press('Escape');await expect(page.getByTestId('twin-place')).toContainText('Place LiDAR 1 by clicking');
 const after=await pos();await page.mouse.click(box.x+box.width*0.6,box.y+box.height*0.5);await page.waitForTimeout(400);expect(await pos()).toEqual(after); // not placing any more
});

test('the Deploy legend: click an item to show only that kind of point, click again for everything',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.getByTestId('twin-buy-rot16').click();await page.getByTestId('twin-buy-rot32').click();
 await page.getByTestId('twin-next-deploy').click();
 for(const k of [0,1,2]){await expect(page.getByTestId(`legend-item-${k}`)).toHaveAttribute('aria-pressed','false');}
 await page.getByTestId('legend-item-0').click();
 await expect(page.getByTestId('legend-item-0')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('legend-item-1')).toHaveClass(/dim/);
 await page.getByTestId('legend-item-2').click();await expect(page.getByTestId('legend-item-2')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('legend-item-0')).toHaveClass(/dim/);
 await page.getByTestId('legend-item-2').click();for(const k of [0,1,2]){await expect(page.getByTestId(`legend-item-${k}`)).toHaveAttribute('aria-pressed','false');await expect(page.getByTestId(`legend-item-${k}`)).not.toHaveClass(/dim/);}
 await page.getByTestId('legend-item-1').click();await page.getByRole('group',{name:'Mission tools'}).getByRole('button',{name:'Equipment',exact:true}).click();
 await expect(page.getByTestId('legend-item-1')).toHaveCount(0);   // leaving the step clears the choice
});
test('each LiDAR has a picture: a button opens a popup that closes with Escape',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 for(const id of ['rot16','rot32','hdl64','rot128','mid360','avia']){
  await page.getByTestId(`twin-look-${id}`).scrollIntoViewIfNeeded();await page.getByTestId(`twin-look-${id}`).click();
  const box=page.getByTestId('lidar-preview');await expect(box).toBeVisible();await expect(box).toContainText('Side view');await expect(box).toContainText('From above');
  await page.keyboard.press('Escape');await expect(page.getByTestId('lidar-preview')).toHaveCount(0);
 }
 await page.getByTestId('twin-look-hdl64').click();await page.getByTestId('lidar-preview-close').click();await expect(page.getByTestId('lidar-preview')).toHaveCount(0);
});
test('registration settings are per scan: the next scan can have its own, and scans already aligned keep theirs',async({page})=>{
 test.setTimeout(170000);
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();
 await page.waitForFunction(()=>(window as any).__twin);
 {const save=initialSave();save.progress.unlocked=1;save.progress.current=1;save.stage=4;
  const mk=(item:string,i:number)=>({id:'l'+i,item,res:'standard' as const,x:[0,7,-7][i],y:[-2,3,5][i],z:1.8,yaw:0,pitch:0});
  save.design={...save.design,lidars:[mk('rot32',0),mk('rot16',1),mk('rot16',2)]};await page.evaluate(s=>(window as any).__twin.getState().importSave(s),save);}
 await page.getByTestId('twin-acquire').click();await expect(page.getByTestId('twin-survey')).toBeVisible({timeout:90000});
 await page.getByRole('button',{name:/Continue to alignment/}).click();
 const trim=()=>page.getByLabel('Keep best pairs',{exact:false});
 await page.getByTestId('align-scan-1').click();await expect(page.getByTestId('align-result-1')).toBeVisible({timeout:60000});
 await page.getByTestId('align-next').click();                                   // scan 2: its own settings
 await page.getByTestId('align-settings').locator('summary').click();
 await expect(page.getByTestId('align-settings')).toContainText('Settings for LiDAR 3');
 await trim().fill('80');
 const kept=await page.evaluate(()=>{const b=(window as any).__twin.getState().pipeline.find((x:any)=>x.kind==='icp');return {s1:b.perScan?.['1']?.trim,s2:b.perScan?.['2']?.trim};});
 expect(kept.s1).toBe(60);expect(kept.s2).toBe(80);                              // scan 1 keeps 60, scan 2 has 80
 await page.getByRole('button',{name:'Previous scan'}).click();
 await expect(page.getByTestId('align-result-1')).toBeVisible();                  // scan 1 is still aligned
 await expect(page.getByTestId('align-settings')).toContainText('Settings for LiDAR 2');
 await expect(trim()).toHaveValue('60');                                          // and shows its own setting
});
test('in the cleaning mission an older save that ran blocks in parallel is put back in sequence, and there is no choice to make',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('lidar-lab-intro-last',String(Date.now())));
 await page.goto('/');await page.getByTestId('nav-18').click();await page.waitForFunction(()=>(window as any).__twin);
 {const save=initialSave();save.progress.unlocked=2;save.progress.current=2;save.stage=5;
  const mk=(item:string,i:number)=>({id:'l'+i,item,res:'standard' as const,x:[0,7][i],y:[-2,3][i],z:1.8,yaw:0,pitch:0});
  save.design={...save.design,lidars:[mk('rot32',0),mk('rot16',1)]};
  const b=(id:string,kind:string,params:any,parallel?:boolean)=>({id,kind,params,parallel});
  save.pipeline=[b('r','icp',{}),b('v','voxel',{size:0.1},true),b('s','sor',{},true)] as any;await page.evaluate(s=>(window as any).__twin.getState().importSave(s),save);}
 await expect.poll(()=>page.evaluate(()=>(window as any).__twin.getState().pipeline.some((x:any)=>x.parallel))).toBe(false);
 await expect(page.getByTestId('twin-parallel-group')).toHaveCount(0);await expect(page.getByTestId('twin-par-2')).toHaveCount(0);
});
