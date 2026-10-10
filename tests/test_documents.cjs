'use strict';
// Exercise IPC without starting Electron, opening dialogs or contacting WhatsApp.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const handlers={},sent=[];
let selection={canceled:false,filePaths:['C:/test/document.pdf']},confirmation={response:1},size=100;
const electron={app:{whenReady:()=>({then:()=>{}}),on:()=>{}},BrowserWindow:function(){},ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{showOpenDialog:async()=>selection,showMessageBox:async()=>confirmation}};
const sandbox={require:name=>name==='electron'?electron:name==='qrcode'?{}:name==='node:fs'?{statSync:()=>({isFile:()=>true,size})}:name==='whatsapp-web.js'?{MessageMedia:{fromFilePath:file=>({file})}}:require(name),process,console,__dirname:path.resolve(__dirname,'..')};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../desktop.js'),'utf8')+`
window={isDestroyed:()=>false,webContents:{id:1,send:()=>{}}};
state.status='conectado';
client={getNumberId:async()=>({_serialized:'5567988888888@c.us'}),sendMessage:async(id,media,options)=>{recordSend(id,media,options);return {fromMe:true,to:id,body:'[Documento]',id:{_serialized:'test-'+Date.now()}}}};
`,Object.assign(sandbox,{recordSend:(...args)=>sent.push(args)}));
const event={sender:{id:1,getURL:()=>'http://127.0.0.1:8765/'}},info={chatId:'5567988888888@c.us'};
(async()=>{
 await assert.rejects(handlers['wa-send-documents']({sender:{id:2}},info),/autorizada/);
 await assert.rejects(handlers['wa-send-documents'](event,{chatId:'invalid'}),/destinatário/);
 selection={canceled:true};assert((await handlers['wa-send-documents'](event,info)).canceled);
 selection={canceled:false,filePaths:Array(11).fill('file')};await assert.rejects(handlers['wa-send-documents'](event,info),/10 documentos/);
 selection={canceled:false,filePaths:['C:/test/document.pdf']};size=21*1024*1024;await assert.rejects(handlers['wa-send-documents'](event,info),/20 MB/);
 size=100;confirmation={response:0};assert((await handlers['wa-send-documents'](event,info)).canceled);assert.equal(sent.length,0);
 confirmation={response:1};assert.equal((await handlers['wa-send-documents'](event,info)).sent,1);assert.equal(sent[0][0],info.chatId);assert.equal(sent[0][2].sendMediaAsDocument,true);
 vm.runInContext("client.sendMessage=async()=>{throw Error('network')}",sandbox);
 const failure=await handlers['wa-send-documents'](event,info);assert.equal(failure.sent,0);assert(failure.error);
 vm.runInContext("state.status='desconectado'",sandbox);await assert.rejects(handlers['wa-send-documents'](event,info),/Conecte/);
 console.log('Document IPC: sender validation, recipient, cancellation, size/count limits, confirmation, sending and failure handling passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
