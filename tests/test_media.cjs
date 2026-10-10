'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {validateMedia,orderedMessages,MAX_MEDIA}=require('../media_messages');
const data=Buffer.from('fixture').toString('base64');
assert.deepEqual(orderedMessages([{timestamp:20},{timestamp:5},{timestamp:10}]).map(m=>m.timestamp),[5,10,20]);
assert.throws(()=>validateMedia({mimetype:'image/svg+xml',data},'image'),/Formato/);
assert.throws(()=>validateMedia({mimetype:'image/png',data:'bad!'},'image'),/inválido/);
assert.throws(()=>validateMedia({mimetype:'image/png',data:Buffer.alloc(MAX_MEDIA+1).toString('base64')},'image'),/16 MB/);
assert.throws(()=>validateMedia({mimetype:'image/png',data:Buffer.alloc(1024*1024+1).toString('base64')},'sticker'),/1 MB/);
const handlers={},sent=[],stored=[];let mime='image/png',size=20,canceled=false,downloads=0;
class MessageMedia{constructor(mimetype,data,filename){Object.assign(this,{mimetype,data,filename});}static fromFilePath(){return new MessageMedia(mime,data,'arquivo');}}
const sandbox={module:{exports:{}},require:name=>name==='./conversation_tools'?require('../conversation_tools'):name==='./history_store'?require('../history_store'):name==='./whatsapp_compat'?require('../whatsapp_compat'):name==='node:fs'?{statSync:()=>({isFile:()=>true,size})}:name==='whatsapp-web.js'?{MessageMedia}:name==='./media_messages'?require('../media_messages'):require(name),Buffer,console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../media_ipc.js'),'utf8'),sandbox);
const state={status:'conectado',conversations:[{id:'111@lid',messages:[{id:'image1',hasMedia:true,type:'image'},{id:'audio1',hasMedia:true,type:'ptt'},{id:'sticker1',hasMedia:true,type:'sticker'}]}]};
const client={sendMessage:async(...args)=>{sent.push(args);return {id:{_serialized:'sent-'+sent.length}}}};
sandbox.module.exports.registerMediaHandlers({ipcMain:{handle:(name,handler)=>handlers[name]=handler},dialog:{showOpenDialog:async()=>({canceled,filePaths:['C:/fixture/photo.png']})},getWindow:()=>({}),safeSender:e=>e.trusted,getClient:()=>client,getState:()=>state,getMessage:()=>({downloadMedia:async()=>{downloads++;await new Promise(r=>setTimeout(r,5));return {mimetype:mime,data}}}),storeMessage:m=>stored.push(m)});
const event={trusted:true};
(async()=>{
 await assert.rejects(handlers['wa-select-media']({trusted:false},{kind:'image'}),/autorizada/);
 canceled=true;assert((await handlers['wa-select-media'](event,{kind:'image'})).canceled);assert.equal(sent.length,0);canceled=false;
 for(const kind of ['image','audio','sticker']){
  mime=kind==='audio'?'audio/mpeg':'image/webp';const selection=await handlers['wa-select-media'](event,{kind});
  assert(selection.preview.startsWith('data:'));assert(!selection.file);assert(!selection.paths);assert.equal(sent.length,stored.length);
  await assert.rejects(handlers['wa-send-media'](event,{selectionId:selection.selectionId,chatId:'222@lid'}),/conversa/);
  const result=await handlers['wa-send-media'](event,{selectionId:selection.selectionId,chatId:'111@lid',caption:'Legenda 😀',quotedId:'reply'});assert(result.ok);
  const options=sent.at(-1)[2];assert.equal(options.sendMediaAsSticker,kind==='sticker');assert.equal(options.sendAudioAsVoice,false);assert.equal(options.quotedMessageId,'reply');assert.equal(options.caption,kind==='image'?'Legenda 😀':undefined);
  await assert.rejects(handlers['wa-send-media'](event,{selectionId:selection.selectionId,chatId:'111@lid'}),/novamente/);
 }
 await handlers['wa-send-media'](event,{kind:'voice',chatId:'111@lid',media:{mimetype:'audio/webm',data}});assert(sent.at(-1)[2].sendAudioAsVoice);
 await assert.rejects(handlers['wa-send-media'](event,{kind:'voice',chatId:'111@lid',media:{mimetype:'image/png',data}}),/Formato/);
 mime='image/png';const selection=await handlers['wa-select-media'](event,{kind:'image'});handlers['wa-discard-media'](event);await assert.rejects(handlers['wa-send-media'](event,{selectionId:selection.selectionId,chatId:'111@lid'}),/novamente/);
 await assert.rejects(handlers['wa-message-media'](event,{chatId:'111@lid',messageId:'old-or-other'}),/indisponível/);
 const [a,b]=await Promise.all([handlers['wa-message-media'](event,{chatId:'111@lid',messageId:'image1'}),handlers['wa-message-media'](event,{chatId:'111@lid',messageId:'image1'})]);assert.equal(downloads,1);assert.equal(a.data,b.data);
 mime='audio/ogg';assert.equal((await handlers['wa-message-media'](event,{chatId:'111@lid',messageId:'audio1'})).mimetype,'audio/ogg');
 mime='image/webp';assert.equal((await handlers['wa-message-media'](event,{chatId:'111@lid',messageId:'sticker1'})).mimetype,'image/webp');
 state.status='desconectado';await assert.rejects(handlers['wa-send-media'](event,{kind:'voice',chatId:'111@lid',media:{mimetype:'audio/webm',data}}),/Conecte/);
 assert.equal(sent.length,4);assert.equal(stored.length,4);
 state.status='conectado';await handlers['wa-send-media'](event,{kind:'clipboard',chatId:'111@lid',media:{mimetype:'image/png',data,filename:'colada.png'}});assert.equal(sent.at(-1)[2].sendAudioAsVoice,false);for(const kind of ['video','document']){mime=kind==='video'?'video/mp4':'application/zip';const selected=await handlers['wa-select-media'](event,{kind});await handlers['wa-send-media'](event,{selectionId:selected.selectionId,chatId:'111@lid'});assert.equal(sent.at(-1)[2].sendMediaAsDocument,kind==='document');}
 const cachedHandlers={};sandbox.module.exports.registerMediaHandlers({ipcMain:{handle:(n,h)=>cachedHandlers[n]=h},dialog:{},getWindow:()=>({}),safeSender:()=>true,getClient:()=>null,getState:()=>({...state,status:'desconectado'}),getMessage:()=>null,storeMessage:()=>{},readMedia:async()=>({mimetype:'image/png',data})});assert.equal((await cachedHandlers['wa-message-media'](event,{chatId:'111@lid',messageId:'image1'})).data,data);
 const {dropKind,createVCard}=require('../conversation_tools');
 assert.equal(dropKind('Arquivo.PDF','application/pdf'),'document');assert.equal(dropKind('arquivo.zip',''),'document');assert.equal(dropKind('foto.webp','image/webp'),'image');assert.throws(()=>dropKind('programa.exe','application/octet-stream'),/não é aceito/);assert.throws(()=>dropKind('foto.png','application/pdf'),/corresponde/);
 const card=createVCard({name:'Ana; Silva\nTEL:intruso',phone:'+55 67 99999-1111'});assert(card.includes('FN:Ana\\; Silva\\nTEL:intruso'));assert.equal(card.split('\r\n').filter(line=>line.startsWith('TEL')).length,1);assert.throws(()=>createVCard({name:'Ana',phone:'123'}),/código do país/);
 let shared=await handlers['wa-send-contact'](event,{chatId:'111@lid',contact:{name:'Ana',phone:'5567999991111'},quotedId:'original'});assert(shared.ok);assert.equal(sent.at(-1)[2].parseVCards,true);assert.equal(sent.at(-1)[2].quotedMessageId,'original');assert(sent.at(-1)[1].includes('BEGIN:VCARD'));
 await assert.rejects(handlers['wa-send-contact'](event,{chatId:'other',contact:{name:'Ana',phone:'5567999991111'}}),/conversa/);
 const beforeDrop=sent.length;let dropped=await handlers['wa-prepare-drop'](event,{chatId:'111@lid',media:{filename:'doc.pdf',mimetype:'application/pdf',data}});assert.equal(dropped.kind,'document');assert.equal(sent.length,beforeDrop);await handlers['wa-send-media'](event,{chatId:'111@lid',selectionId:dropped.selectionId});assert.equal(sent.at(-1)[2].sendMediaAsDocument,true);
 await assert.rejects(handlers['wa-prepare-drop'](event,{chatId:'111@lid',media:{filename:'script.exe',mimetype:'application/octet-stream',data}}),/não é aceito/);await assert.rejects(handlers['wa-prepare-drop'](event,{chatId:'111@lid',media:{filename:'doc.pdf',mimetype:'application/pdf',data:Buffer.alloc(MAX_MEDIA+1).toString('base64')}}),/16 MB/);
 mime='video/mp4';const gif=await handlers['wa-select-media'](event,{kind:'gif'});await handlers['wa-send-media'](event,{chatId:'111@lid',selectionId:gif.selectionId});assert.equal(sent.at(-1)[2].sendVideoAsGif,true);
 await assert.rejects(handlers['wa-reuse-media'](event,{chatId:'111@lid',sourceChatId:'111@lid',messageId:'image1'}),/sincronizadas/);
 state.conversations[0].messages.push({id:'gif1',hasMedia:true,type:'video',isGif:true});let recent=await handlers['wa-reuse-media'](event,{chatId:'111@lid',sourceChatId:'111@lid',messageId:'gif1'});assert.equal(recent.kind,'gif');await handlers['wa-send-media'](event,{chatId:'111@lid',selectionId:recent.selectionId});assert.equal(sent.at(-1)[2].sendVideoAsGif,true);
 console.log('Media: image/audio/sticker/voice options, preview without send, cancellation, scoped downloads, coalescing, size/MIME checks, replies, offline guard and ascending order passed. No real messages sent.');
})().catch(error=>{console.error(error);process.exitCode=1});
