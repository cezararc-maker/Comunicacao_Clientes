'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {PHONES,SINCE,messageInScope}=require('../sync_scope');
const handlers={},states=[],saved=[],queried=[],ids=new Set(PHONES.map(p=>p+'@c.us'));
assert.equal(new Date(SINCE*1000).toISOString(),'2026-10-09T05:00:00.000Z');
assert(!messageInScope({from:PHONES[0]+'@c.us',timestamp:SINCE-1},ids));
assert(messageInScope({from:PHONES[0]+'@c.us',timestamp:SINCE},ids));
assert(!messageInScope({from:'5567988888888@c.us',timestamp:SINCE+1},ids));
assert(!messageInScope({from:PHONES[0]+'@c.us'},ids));
const electron={app:{whenReady:()=>({then:()=>{}}),on:()=>{}},BrowserWindow:function(){},ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{}};
const localRequire=name=>name==='electron'?electron:name==='qrcode'?{}:name.startsWith('./')?require(path.resolve(__dirname,'..',name)):require(name);
const sandbox={require:localRequire,process,console,__dirname:path.resolve(__dirname,'..'),fetch:async(url,options)=>{
 if(url.endsWith('/api/whatsapp/sync')){saved.push(JSON.parse(options.body).contatos);return {ok:true,json:async()=>({novos:2})};}
 return {ok:true,json:async()=>[]};
},collect:s=>states.push(JSON.parse(JSON.stringify(s))),queried};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop.js'),'utf8')+`
window={isDestroyed:()=>false,webContents:{id:1,send:(_name,state)=>collect(state)}};
client={
 getContacts:()=>{throw Error('Must not scan all contacts')},getChats:()=>{throw Error('Must not scan all chats')},
 getNumberId:async p=>{queried.push(p);return {_serialized:(p==='${PHONES[0]}'?'111':'222')+'@lid'}},
 getContactById:async id=>{const phone=id==='111@lid'?'${PHONES[0]}':'${PHONES[1]}';const pn=phone.slice(0,4)+phone.slice(5);return {id:{_serialized:pn+'@c.us',user:pn},name:'Contato '+phone}},
 getContactLidAndPhone:async()=>[{lid:'111@lid',pn:'${PHONES[0].slice(0,4)+PHONES[0].slice(5)}@c.us'},{lid:'222@lid',pn:'${PHONES[1].slice(0,4)+PHONES[1].slice(5)}@c.us'}],
 getChatById:async id=>({id:{_serialized:id,user:id.split('@')[0]},name:id,isGroup:false,lastMessage:{timestamp:${SINCE}+1},fetchMessages:async options=>{if(options.limit!==100)throw Error('History must be bounded');return [{id:{_serialized:'old-'+id},from:id,timestamp:${SINCE}-1,body:'antiga'},{id:{_serialized:'new-'+id},from:id,timestamp:${SINCE},body:'nova'}]}}),
 getProfilePicUrl:async()=>null
};
`,sandbox);
const event={sender:{id:1,getURL:()=>'http://127.0.0.1:8765/'}};
(async()=>{
 const offline=await handlers['wa-sync'](event);assert.equal(offline.ok,false);assert.match(offline.message,/Aguarde/);assert.equal(queried.length,0);
 vm.runInContext("state.status='conectado'",sandbox);
 const [result,concurrent]=await Promise.all([handlers['wa-sync'](event),handlers['wa-sync'](event)]);assert.equal(result.ok,true);assert.equal(concurrent.ok,true);
 assert.deepEqual(queried,[...PHONES]);assert.deepEqual(saved[0].map(c=>c.telefone),[...PHONES]);
 const final=states.at(-1);assert.equal(final.conversations.length,2);assert(final.conversations.every(c=>c.messages.length===1&&c.messages[0].body==='nova'));
 assert.equal(final.syncProgress.percent,100);assert.equal(final.syncProgress.running,false);assert.equal(final.syncProgress.completed,final.syncProgress.total);
 const progress=states.filter(s=>s.syncProgress.running).map(s=>s.syncProgress.percent);assert(progress.every((p,i)=>i===0||p>=progress[i-1]));
 vm.runInContext("storeMessage({from:'5567988888888@c.us',timestamp:SINCE+1,body:'outside'});storeMessage({from:'12345@g.us',timestamp:SINCE+1,body:'group'});",sandbox);
 assert.equal(states.at(-1).conversations.length,2);
 vm.runInContext("storeMessage({id:{_serialized:'lid-new'},from:'111@lid',timestamp:SINCE+1,body:'LID nova'});",sandbox);
 assert(states.at(-1).conversations.some(c=>c.messages.some(m=>m.body==='LID nova')));
 console.log('Scoped sync: only two contacts queried, no broad scans, cutoff/timezone, old messages excluded, offline response and monotonic measured progress passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
