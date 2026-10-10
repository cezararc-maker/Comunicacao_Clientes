'use strict';
const assert=require('node:assert/strict');
const {serializedId,normalizeMessage,installWebCompatibility,downloadMediaCompat}=require('../whatsapp_compat');
const {createHistoryStore}=require('../history_store');
(async()=>{
 assert.equal(serializedId({$1:'new-key'}),'new-key');assert.equal(normalizeMessage({id:{$1:'new-key'}}).id._serialized,'new-key');
 const original=global.window;class Key{constructor(){this.$1='serialized'}}
 let options;global.window={require:name=>name==='WAWebMsgKey'?Key:name==='WAWebCollections'?{Msg:{get:()=>({directPath:'path',mimetype:'audio/ogg; codecs=opus',type:'ptt'})}}:{downloadManager:{downloadAndMaybeDecrypt:async info=>{options=info;return new Uint8Array([1,2,3]).buffer}}},WWebJS:{arrayBufferToBase64Async:async bytes=>Buffer.from(bytes).toString('base64')}};
 try{const client={pupPage:{evaluate:(fn,...args)=>fn(...args)}};await installWebCompatibility(client);assert.equal(new Key()._serialized,'serialized');const media=await downloadMediaCompat(client,{id:{$1:'new-key'},downloadMedia:async()=>{throw Error('InvalidMediaFileType')}},'new-key');assert.equal(options.mimetype,'audio/ogg; codecs=opus');assert.equal(media.data,'AQID');}finally{global.window=original;}
 let stored=[];const cache=new Map();const fakeFetch=async(url,info)=>{const route=url.split('/api/whatsapp/')[1];if(info.method==='POST'){if(route==='historico')stored=JSON.parse(info.body).conversations;else cache.set(route,JSON.parse(info.body));}return {ok:true,json:async()=>route==='historico'?stored:cache.get(route)||null};};
 const first=createHistoryStore({token:'test',fetchApi:fakeFetch});const chats=[{id:'1@lid',messages:[{id:'one',timestamp:1}]}];first.queue(chats);chats[0].messages=[];await first.flush();await first.saveMedia('one',{mimetype:'image/png',data:'AQID'});
 const restarted=createHistoryStore({token:'test',fetchApi:fakeFetch});assert.equal((await restarted.load())[0].messages[0].id,'one');assert.equal((await restarted.readMedia('one')).data,'AQID');
 console.log('History/compatibility: immutable queued snapshot, restart, media cache, new serialized ID and real download MIME fallback passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
