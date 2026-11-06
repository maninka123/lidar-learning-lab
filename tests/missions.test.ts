import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_DESIGN } from '../src/twin/catalogue';
import { pipelineForMission, emptyProgress, recordMission, invalidateProgress, missionFingerprint, currentMissionMetrics, currentPass, readyForFinal, type MissionResult } from '../src/twin/missions';
import { initialSave, parseSave, snapshot, useTwin } from '../src/twin/store';
import { newBlock } from '../src/twin/pipeline';
import { usd } from '../src/twin/pricing';
const cfg = { design: { ...EMPTY_DESIGN, lidars: [{id:'l1',item:'rot32',res:'standard' as const,x:0,y:0,z:1.8,yaw:0,pitch:0}] }, pipeline: ['icp','voxel','euclid','classify','colour','diff','safety'].map(k=>newBlock(k as never)), settings:DEFAULT_SETTINGS };
const pass = (mission: number): MissionResult => ({at:1,fingerprint:missionFingerprint(cfg,mission),level:'passed',score:80,metrics:[],feedback:[]});
const completed = () => {let p=emptyProgress();for(let i=0;i<6;i++)p=recordMission(p,i,pass(i));return p;};
describe('engineering mission progression',()=>{
 it('displays the current budget and equipment cost instead of financial values from an old test',()=>{
  const saved:MissionResult={...pass(0),stale:true,metrics:[{label:'Coverage',value:61.9,target:70,unit:'%'},{label:'Equipment cost',value:2480,target:3000,unit:'credits',lower:true}]};
  for(const budget of [1400,1000]){
   const metrics=currentMissionMetrics(saved,200,budget);
   expect(metrics[0]).toEqual(saved.metrics[0]);expect(metrics[1]).toMatchObject({value:200,target:budget});
  }
  expect(saved.metrics[1]).toMatchObject({value:2480,target:3000});
 });
 it('shows a $7,000 default and migrates old defaults without overwriting new custom budgets',()=>{
  expect(usd(initialSave().settings.budget)).toBe('$7,000');
  for(const budget of [3000,7000]){
   const save=initialSave();save.settings={...save.settings,budget,budgetVersion:undefined};
   expect(usd(parseSave(JSON.stringify(save))!.settings.budget)).toBe('$7,000');
   save.settings.budgetVersion=2;
   expect(parseSave(JSON.stringify(save))!.settings.budget).toBe(budget);
  }
 });
 it('runs only unlocked mission phases, so a legacy future colour block cannot block registration',()=>{
  const pipeline = [newBlock('icp'), newBlock('voxel'), newBlock('classify'), newBlock('colour')];
  expect(pipelineForMission(pipeline,1).map(b=>b.kind)).toEqual(['icp']);
  expect(pipelineForMission(pipeline,2).map(b=>b.kind)).toEqual(['icp','voxel']);
 });
 it('starts with only mission one and never unlocks a failed or skipped mission',()=>{
  const p=emptyProgress();expect(p.unlocked).toBe(0);expect(recordMission(p,0,{...pass(0),level:'needs-improvement'}).unlocked).toBe(0);expect(recordMission(p,2,pass(2))).toEqual(p);
  const next=recordMission(p,0,pass(0));expect(next.unlocked).toBe(1);expect(currentPass(next.results[0])).toBe(true);
 });
 it('keeps history accessible but requires all earlier results current before commissioning or advancing',()=>{
  const p=completed();expect(p.unlocked).toBe(6);expect(readyForFinal(p)).toBe(true);
  const changed={...cfg,design:{...cfg.design,lidars:cfg.design.lidars.map(l=>({...l,x:3}))}};
  const stale=invalidateProgress(p,changed);expect(stale.unlocked).toBe(6);expect(stale.results.slice(0,6).every(r=>r?.stale)).toBe(true);expect(readyForFinal(stale)).toBe(false);
 });
 it('a cleaning change invalidates cleaning and downstream work, retaining coverage and alignment',()=>{
  const next={...cfg,pipeline:cfg.pipeline.map(b=>b.kind==='voxel'?{...b,params:{...b.params,size:.2}}:b)};
  const p=invalidateProgress(completed(),next);expect(p.results[0]?.stale).toBe(false);expect(p.results[1]?.stale).toBe(false);expect(p.results.slice(2,6).every(r=>r?.stale)).toBe(true);
 });
 it('camera changes preserve LiDAR, cleaning and detection validation',()=>{
  const next={...cfg,design:{...cfg.design,lights:[{id:'light',x:3,y:3,z:3}]}};
  const p=invalidateProgress(completed(),next);expect(p.results.slice(0,4).every(currentPass)).toBe(true);expect(p.results[4]?.stale).toBe(true);expect(p.results[5]?.stale).toBe(false);
 });
 it('colour processing does not invalidate geometry-only change and safety assessment',()=>{
  const next={...cfg,pipeline:cfg.pipeline.map(b=>b.kind==='colour'?{...b,params:{...b.params,votes:10}}:b)};
  const p=invalidateProgress(completed(),next);expect(p.results.slice(0,4).every(currentPass)).toBe(true);expect(p.results[4]?.stale).toBe(true);expect(currentPass(p.results[5])).toBe(true);
 });
 it('persists progression, migrates legacy equipment and refuses normal navigation to locked tools',()=>{
  const save={...initialSave(),...cfg,progress:completed()};const restored=parseSave(JSON.stringify(save))!;expect(restored.progress.unlocked).toBe(6);expect(readyForFinal(restored.progress)).toBe(true);
  const legacy=parseSave(JSON.stringify({...save,version:1,progress:undefined,stage:8}))!;expect(legacy.design).toEqual(cfg.design);expect(legacy.pipeline).toEqual(cfg.pipeline);expect(legacy.progress.unlocked).toBe(0);expect(legacy.stage).toBe(1);
  useTwin.getState().reset();useTwin.getState().set({stage:8});expect(useTwin.getState().stage).toBe(1);
  useTwin.getState().importSave(save);expect(snapshot(useTwin.getState()).progress.unlocked).toBe(6);useTwin.getState().reset();
 });
});
