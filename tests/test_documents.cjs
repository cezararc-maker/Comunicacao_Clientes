'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const handlers={},sent=[];let selection={canceled:false,filePaths:['C:/test/document.pdf']},confirmation={response:1},size=100,pickerCalls=0;
const electron={app:{whenReady:()=>({then:()=>{}}),on:()=>{}},BrowserWindow:function(){},ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{showOpenDialog:async()=>{pickerCalls++;return selection},showMessageBox:async()=>confirmation}};
const sandbox={require:name=>name==='./batch_messages'?require('../batch_messages'):name==='./desktop_notifications'?require('../desktop_notifications'):name==='./capture_conversation'?require('../capture_conversation'):name==='./reply_context'?require('../reply_context'):name==='./group_support'?require('../group_support'):name==='./history_store'?require('../history_store'):name==='./whatsapp_compat'?require('../whatsapp_compat'):name==='./media_messages'?require('../media_messages'):name==='./media_ipc'?require('../media_ipc'):name==='./whatsapp_compat'?require('../whatsapp_compat'):name==='./contact_names'?require('../contact_names'):name==='./sync_scope'?require('../sync_scope'):name==='./profile_photos'?{resolvePhoto:async(client,ids)=>({image:await client.getProfilePicUrl(ids[0]),status:'external'})}:name==='electron'?electron:name==='qrcode'?{}:name==='node:fs'?{statSync:()=>({isFile:()=>true,size})}:name==='whatsapp-web.js'?{MessageMedia:{fromFilePath:file=>({file})}}:require(name),process,console,__dirname:path.resolve(__dirname,'..'),recordSend:(...args)=>sent.push(args)};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop.js'),'utf8')+`
window={isDestroyed:()=>false,webContents:{id:1,send:()=>{}}};state.status='conectado';
client={getNumberId:async phone=>({_serialized:phone+'@c.us'}),getProfilePicUrl:async id=>'https://example.com/'+id+'.jpg',sendMessage:async(id,media,options)=>{recordSend(id,media,options);return {fromMe:true,to:id,body:'[Documento]',id:{_serialized:'test-'+Date.now()}}}};
`,sandbox);
const event={sender:{id:1,getURL:()=>'http://127.0.0.1:8765/'}},targets=['5567988888888@c.us','12345@g.us'];
(async()=>{
 await assert.rejects(handlers['wa-select-documents']({sender:{id:2}}),/autorizada/);
 selection={canceled:true};assert((await handlers['wa-select-documents'](event)).canceled);
 selection={canceled:false,filePaths:Array(11).fill('file')};await assert.rejects(handlers['wa-select-documents'](event),/10 documentos/);
 selection={canceled:false,filePaths:['C:/test/document.pdf']};size=21*1024*1024;await assert.rejects(handlers['wa-select-documents'](event),/20 MB/);size=100;
 const selected=await handlers['wa-select-documents'](event);assert.equal(selected.files[0],'document.pdf');assert(!selected.paths);const calls=pickerCalls;
 const info={selectionId:selected.selectionId,chatIds:targets};
 await assert.rejects(handlers['wa-send-documents'](event,{...info,chatIds:['invalid']}),/válidos/);
 confirmation={response:0};assert((await handlers['wa-send-documents'](event,info)).canceled);assert.equal(sent.length,0);
 confirmation={response:1};const result=await handlers['wa-send-documents'](event,info);assert.equal(result.sent,2);assert.equal(pickerCalls,calls);assert.equal(sent[0][0],targets[0]);assert.equal(sent[1][0],targets[1]);assert.equal(sent[0][2].sendMediaAsDocument,true);
 await assert.rejects(handlers['wa-send-documents'](event,info),/expirou/);
 const next=await handlers['wa-select-documents'](event);vm.runInContext("client.sendMessage=async()=>{throw Error('network')}",sandbox);
 const failure=await handlers['wa-send-documents'](event,{selectionId:next.selectionId,chatIds:targets});assert.equal(failure.sent,0);assert(failure.error);
 const photo=await handlers['wa-contact-photos'](event,['5567996373431']);assert.equal(photo['5567996373431'],'https://example.com/5567996373431@c.us.jpg');
 await assert.rejects(handlers['wa-contact-photos'](event,['invalid']),/inválida/);
 vm.runInContext("state.status='desconectado'",sandbox);const offline=await handlers['wa-select-documents'](event);await assert.rejects(handlers['wa-send-documents'](event,{selectionId:offline.selectionId,chatIds:targets}),/Conecte/);
 vm.runInContext("state.status='conectado';globalThis.phoneSaves=[];client.saveOrEditAddressbookContact=async(...args)=>phoneSaves.push(args);window.close=()=>globalThis.windowResult='close';window.minimize=()=>globalThis.windowResult='minimize';window.isMaximized=()=>false;window.maximize=()=>globalThis.windowResult='maximize'",sandbox);
 await handlers['wa-save-contact'](event,{phone:'5567996373431',name:'Contato de teste'});assert.equal(vm.runInContext('phoneSaves[0][3]',sandbox),true);assert.equal(vm.runInContext('phoneSaves[0][0]',sandbox),'5567996373431');await assert.rejects(handlers['wa-save-contact'](event,{phone:'bad',name:'Teste'}),/inválido/);
 for(const action of ['close','minimize','maximize']){await handlers['window-action'](event,action);assert.equal(vm.runInContext('windowResult',sandbox),action);}
 vm.runInContext("conversations.set('111@lid',{id:'111@lid',unreadCount:4,messages:[],timestamp:0})",sandbox);await handlers['wa-mark-read'](event,'111@lid');assert.equal(vm.runInContext("conversations.get('111@lid').unreadCount",sandbox),0);
 console.log('Documents/photos: file-first selection, recipient validation, multiple targets, cancellation, limits, expired token, partial failure, original photo URLs and sender checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
