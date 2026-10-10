'use strict';
// Ephemeral activity only: never fetch messages or persist presence in history.
async function installPresence(page, callbackName, chatIds) {
 return page.evaluate(({callbackName,chatIds})=>{
  window.__communicationPresence?.stop();
  let collections;try{collections=window.require('WAWebCollections')}catch{return {supported:false}}
  const bindings=new Map();let stopped=false;
  const emit=(id,type)=>{if(!stopped)Promise.resolve(window[callbackName]({id,type})).catch(()=>{});};
  function bind(){
   for(const id of chatIds){
    const presence=collections.Chat?.get(id)?.presence||collections.Presence?.get(id);
    if(!presence||bindings.get(id)?.presence===presence)continue;
    bindings.get(id)?.dispose();
    const read=()=>{
     if(!presence.hasData){emit(id,null);return;}
     const states=presence.isGroup?presence.chatstates?.getModelsArray?.()||[]:[presence.chatstate];
     const types=states.filter(s=>s&&!s.deny).map(s=>s.type);
     emit(id,types.includes('recording')?'recording':types.includes('composing')?'typing':null);
    };
    presence.on?.('change:chatstate.type change:hasData',read);
    presence.chatstates?.on?.('change:type add remove',read);
    bindings.set(id,{presence,dispose:()=>{presence.off?.('change:chatstate.type change:hasData',read);presence.chatstates?.off?.('change:type add remove',read);}});
    // Subscribe only existing scoped chats; not every entry in the phone book.
    try{Promise.resolve(presence.subscribe?.()).then(read).catch(()=>{})}catch{}
    read();
   }
  }
  bind();const timer=setInterval(bind,2000);
  window.__communicationPresence={stop(){stopped=true;clearInterval(timer);for(const b of bindings.values())b.dispose();bindings.clear();}};
  return {supported:bindings.size>0};
 },{callbackName,chatIds});
}
function createPresenceMonitor({getClient,getChats,onChange,now=Date.now,ttl=25000}){
 let generation=0,timer=null,values={},registered=null;
 const publish=()=>onChange({...values});
 function accept(signal,expected){
  if(expected!==generation||!getChats().includes(signal?.id))return;
  if(!['typing','recording'].includes(signal.type)){if(values[signal.id]){delete values[signal.id];publish();}return;}
  values[signal.id]={type:signal.type,expiresAt:now()+ttl};publish();
 }
 async function stop(){generation++;clearInterval(timer);timer=null;values={};publish();const previous=registered;registered=null;try{await previous?.page.evaluate(()=>window.__communicationPresence?.stop());if(previous?.page.removeExposedFunction)await previous.page.removeExposedFunction(previous.name)}catch{}}
 async function start(){
  await stop();const expected=generation,page=getClient()?.pupPage;if(!page)return {supported:false};
  const callbackName='communicationPresence_'+expected;
  await page.exposeFunction(callbackName,s=>accept(s,expected));
  if(expected!==generation){try{await page.removeExposedFunction(callbackName)}catch{}return {supported:false};}
  registered={page,name:callbackName};
  const result=await installPresence(page,callbackName,getChats());
  if(expected!==generation)return {supported:false};
  timer=setInterval(()=>{let changed=false;for(const [id,v]of Object.entries(values))if(v.expiresAt<=now()){delete values[id];changed=true;}if(changed)publish();},1000);timer.unref?.();
  return result;
 }
 return {start,stop,accept:(signal)=>accept(signal,generation)};
}
module.exports={installPresence,createPresenceMonitor};
