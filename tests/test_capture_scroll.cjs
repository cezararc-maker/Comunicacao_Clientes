'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
(async()=>{
 const positions=[],area={clientWidth:800,clientHeight:400,scrollHeight:2000,clientTop:0,children:[],dataset:{followBottom:'0'},getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[],addEventListener:()=>{}};let top=200;Object.defineProperty(area,'scrollTop',{get:()=>top,set:value=>{top=Math.max(0,Math.min(1600,value));positions.push(top);}});
 const controls={};const $=id=>id==='wamessages'?area:controls[id]||(controls[id]={value:2,classList:{add(){},remove(){}},close(){},addEventListener(){}});
 let begin,finished;
 const context=vm.createContext({console,Date,Math,Number,Promise,setTimeout:fn=>setImmediate(fn),setInterval,clearInterval,waChat:'chat',waState:{conversations:[{id:'chat',name:'Teste',messages:[{id:'one'}]}]},activeMediaJobs:0,mediaJobs:[],$,hideCompanyBalloon(){},aviso:message=>{throw Error(message)},document:{fonts:{ready:Promise.resolve()},querySelectorAll:()=>[],getElementById:$},window:{desktopApi:{captureBegin:async info=>{begin=info;return {id:'test'};},captureCancel:async()=>{}}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/capture_ui.js'),'utf8'),context);
 vm.runInContext("captureSnapshot=()=>({height:2000,width:800,html:'snapshot'});finishCapture=async()=>{globalThis.finishedAt=$('wamessages').scrollTop;globalThis.finishedEnd=captureSession.end;};",context);
 await vm.runInContext("startCapture('auto')",context);finished=context.finishedAt;
 assert.equal(begin.start,200);assert.equal(finished,1600);assert.equal(context.finishedEnd,2000);assert(positions.length>3);assert(positions.every((position,i)=>!i||position>=positions[i-1]));assert(positions.some(position=>position>200&&position<1600));
 console.log('Automatic capture: original start preserved, incremental visible scrolling and complete final interval passed. No real app interaction.');
})().catch(error=>{console.error(error);process.exitCode=1});
