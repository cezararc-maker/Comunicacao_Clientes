'use strict';
const assert=require('node:assert/strict');
const {installPresence,createPresenceMonitor}=require('../chat_presence');
(async()=>{
 let reads=0,callback=null,subscribed=0,removed=0;const events=new Map();
 const presence={hasData:true,isGroup:false,chatstate:{type:'composing'},subscribe:()=>{subscribed++},on:(e,fn)=>events.set(e,fn),off:e=>{events.delete(e);removed++}};
 const signals=[];global.window={require:()=>({Chat:{get:id=>id==='test@c.us'?{presence}:null}}),receive:s=>signals.push(s)};
 const page={evaluate:async(fn,arg)=>{reads++;return fn(arg)},exposeFunction:async(name,fn)=>{callback=fn;window[name]=fn},removeExposedFunction:async(name)=>delete window[name]};
 const result=await installPresence(page,'receive',['test@c.us']);assert(result.supported);assert.equal(subscribed,1);assert.equal(signals.at(-1).type,'typing');
 presence.chatstate.type='recording';events.values().next().value();assert.equal(signals.at(-1).type,'recording');
 presence.chatstate.type='paused';events.values().next().value();assert.equal(signals.at(-1).type,null);
 window.__communicationPresence.stop();assert.equal(events.size,0);assert(removed);
 let time=0,latest;const monitor=createPresenceMonitor({getClient:()=>({pupPage:page}),getChats:()=>['test@c.us'],onChange:v=>latest=v,now:()=>time,ttl:10});
 await monitor.start();callback({id:'other@c.us',type:'typing'});assert(!latest['other@c.us']);callback({id:'test@c.us',type:'recording'});assert.equal(latest['test@c.us'].type,'recording');
 time=11;await new Promise(r=>setTimeout(r,1100));assert.deepEqual(latest,{});
 callback({id:'test@c.us',type:'typing'});const old=callback;await monitor.stop();assert.deepEqual(latest,{});old({id:'test@c.us',type:'recording'});assert.deepEqual(latest,{});
 delete global.window;console.log('Presence: typing, recording, pause, scope, expiry, teardown and stale callbacks OK');
})().catch(e=>{console.error(e);process.exitCode=1});
