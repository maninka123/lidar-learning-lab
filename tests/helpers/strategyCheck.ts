import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect } from 'vitest';
import { runScenario, runFinal } from '../../src/twin/runner';
import { evaluateMission, recordMission, emptyProgress, readyForFinal, currentPass } from '../../src/twin/missions';
import { sampleConfig } from './twinStrategies';

/** One sample strategy through the connected missions and the unseen final variants. Each strategy has its own test file, so they run in parallel. */
export function checkStrategy(type: 'low' | 'balanced' | 'high' | 'poor') {
 const evidence: Record<string, unknown>[] = [];
  const cfg=sampleConfig(type),r=runScenario(cfg,11);
  let progress=emptyProgress();
  for(let mission=0;mission<6;mission++) progress=recordMission(progress,mission,evaluateMission(mission,r,cfg));
  evidence.push({type,cost:r.cost.total,total:r.grade.total,coverage:r.coverage?.critical,rmse:r.registration?.rmse,quality:r.tasks.quality,detect:r.tasks.detect.f1,small:r.tasks.detect.smallRecall,colour:r.tasks.colour.accuracy,change:r.tasks.change.f1,safety:r.tasks.safety.accuracy,missions:progress.results.map(m=>m?.level)});
  writeFileSync(`${tmpdir()}/lidar-mission-validation-${type}.json`,JSON.stringify(evidence,null,2));
  expect(r.ok).toBe(true);
  if(type==='poor') { expect(readyForFinal(progress)).toBe(false); expect(currentPass(progress.results[0])).toBe(false); return; }
  expect(progress.results.slice(0,6).every(currentPass),type).toBe(true);
  expect(readyForFinal(progress)).toBe(true);
  const final=runFinal(cfg);
  const completed=recordMission(progress,6,evaluateMission(6,final.runs[0],cfg,final));
  expect(final.runs.map(r=>r.seed)).toEqual([101,202]);expect(final.runs.every(r=>r.ok)).toBe(true);expect(currentPass(completed.results[6]),`${type}: ${final.grade.total}`).toBe(true);
  Object.assign(evidence[evidence.length-1],{final:final.grade.total,variants:final.runs.map(r=>({seed:r.seed,score:r.grade.total,coverage:r.coverage?.critical,detect:r.tasks.detect.f1,colour:r.tasks.colour.accuracy,change:r.tasks.change.f1,safety:r.tasks.safety.accuracy}))});
  writeFileSync(`${tmpdir()}/lidar-mission-validation-${type}.json`,JSON.stringify(evidence,null,2));
}
