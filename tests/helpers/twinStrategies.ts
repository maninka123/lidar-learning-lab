import { EMPTY_DESIGN, DEFAULT_SETTINGS, HW_SEED, cameraItem, type TwinDesign, type LidarUnit, type CameraUnit } from '../../src/twin/catalogue';
import { newBlock, type BlockKind } from '../../src/twin/pipeline';
import { calibrationTarget, autoCalibrate, nominalOf } from '../../src/twin/camera';
const lid = (item: string, x: number, y: number, i: number): LidarUnit => ({ id: `l${i}`, item, res: 'standard', x, y, z: 1.8, yaw: 0, pitch: 0 });
export function sampleConfig(type: string) {
 const positions = [[0,-2],[7,3],[-7,5],[7,-1],[-7,-1],[1,5]];
 const types = type === 'low' ? ['tls-hire','tls-hire','mid360','mid360','mid360','mid360'] : type === 'balanced' ? ['tls-hire','tls-hire','mid360','mid360','rot32','rot32'] : type === 'high' ? ['tls-hire','tls-hire','rot128','mid360'] : ['rot16'];
 const lidars = types.map((t,i) => lid(t, positions[i][0], positions[i][1], i));
 const cameras: CameraUnit[] = [[0,-3,-90],[7,3,90],[-6,0,-90],[5,3,70]].map(([x,y,yaw],i) => {
  const c: CameraUnit = { id: `c${i}`, item: i===3?'cam-lowlight':'cam-mid', x,y,z:1.8,yaw:yaw*Math.PI/180,pitch:0,kit:false,pairedLidarId:lidars[(i===2?0:i===3?1:i)%lidars.length].id,cal:{ est:{tx:x,ty:y,tz:1.8,yawDeg:yaw,pitchDeg:0},fov:70,done:false} };
  const r=autoCalibrate(calibrationTarget(c, HW_SEED, i, []), nominalOf(c),cameraItem(c.item).fov); c.cal={est:r.e,fov:r.fov,done:true};return c;
 });
 const design: TwinDesign = { ...EMPTY_DESIGN, lidars, cameras: type==='poor'?[]:cameras, lights:[{id:'lamp',x:7,y:5,z:3}] };
 const pipeline = (['icp','crop','voxel','sor','ground','planes','euclid','classify','colour','diff','safety'] as BlockKind[]).filter(k=>type!=='poor'||!['colour','diff','safety'].includes(k)).map(k=>{const b=newBlock(k);if(k==='crop')b.params.zmax=3;if(k==='voxel')b.params.size=.06;if(k==='euclid'){b.params.radius=.24;b.params.min=10;}if(k==='classify')b.params.minpts=10;if(k==='diff'){b.params.thr=type === 'balanced' ? .45 : .3;b.params.min=type === 'balanced' ? 70 : 50;}if(k==='colour'){b.params.votes=2;b.params.share=50;}return b;});
 return { design, pipeline, settings:DEFAULT_SETTINGS };
}
