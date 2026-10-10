'use strict';
const assert=require('node:assert/strict');
const {planCapture,captureName}=require('../capture_conversation');
for(const scale of [1,1.25,1.5,2]){
 const start=333.25,end=17345.75,width=840;
 const parts=planCapture({width,height:20000,start,end,scale});
 assert.equal(parts[0].y*scale,Math.round(start*scale));
 assert.equal(parts.reduce((sum,p)=>sum+p.pixels,0),Math.round(end*scale)-Math.round(start*scale));
 parts.slice(1).forEach((part,index)=>assert(Math.abs(part.y-parts[index].y-parts[index].height)<.00001));
 assert(parts.every(p=>p.pixels<=6000));
}
assert.equal(planCapture({width:700,height:600,start:150,end:400}).length,1);
assert.throws(()=>planCapture({width:700,height:600,start:-1,end:400}),/inválido/);
assert.throws(()=>planCapture({width:700,height:600,start:150,end:601.5}),/inválido/);
assert.throws(()=>planCapture({width:3000,height:100000,start:0,end:100000,scale:2}),/grande/);
assert(!/[<>:"/\\|?*]/.test(captureName('Ana: RH / Financeiro')));
console.log('Capture interval, scale, consecutive parts, limits and filename checks passed.');
