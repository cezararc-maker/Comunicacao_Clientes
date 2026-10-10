'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {usableName,buildDirectory,conversationName}=require('./contact_names');
let window, pythonProcess, client;
let restarting=false, initializing=false;
const syncToken=crypto.randomBytes(32).toString('hex');
let state = { status:'desconectado', qr:null, error:null, conversations:[], contactsCount:0, sync:'aguardando' };
const conversations = new Map();
let contactDirectory=new Map(),localNames=new Map();
const profileCache=new Map();
async function profilePhoto(id){
 if(profileCache.has(id))return profileCache.get(id);
 try{const url=await client.getProfilePicUrl(id);const safe=typeof url==='string'&&url.startsWith('https://')?url:null;profileCache.set(id,safe);return safe;}
 catch{return null}
}
async function hydratePhotos(chats){for(const c of chats){const chat=conversations.get(c.id);if(!chat)continue;chat.photo=await profilePhoto(c.id);update({});}}

function update(patch){state={...state,...patch,conversations:[...conversations.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100)}; if(window && !window.isDestroyed()) window.webContents.send('wa-state', state);}
function safeSender(event){return !!window && event.sender.id === window.webContents.id && event.sender.getURL().startsWith('http://127.0.0.1:8765/');}
function startPython(){
 const args=['app.py'], options={cwd:__dirname,windowsHide:true,env:{...process.env,WA_SYNC_TOKEN:syncToken}};
 if(process.platform==='win32') pythonProcess=spawn('py',['-3',...args],options);
 else pythonProcess=spawn('python3',args,options);
 pythonProcess.on('error',e=>update({error:'Servidor Python: '+e.message}));
 pythonProcess.stderr.on('data',d=>console.error(String(d)));
}
async function awaitServer(){
 for(let i=0;i<80;i++){
  try{const r=await fetch('http://127.0.0.1:8765/api/empresas');if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,350));
 }
 throw new Error('Servidor de cadastros não iniciou. Verifique Python e as dependências.');
}
function storeMessage(msg){
 if(!msg || msg.from==='status@broadcast')return;
 const id=msg.fromMe?msg.to:msg.from;
 if(!id || id==='status@broadcast')return;
 const details=contactDirectory.get(id)||{};
 const chat=conversations.get(id)||{id,name:conversationName({id:{_serialized:id,user:id.split('@')[0]},isGroup:id.endsWith('@g.us'),name:msg._data?.notifyName},details,localNames.get(details.phone)),messages:[],timestamp:0};
 const entry={id:msg.id?._serialized||String(Date.now()),body:msg.body|| (msg.hasMedia?'[Mídia]':''),fromMe:!!msg.fromMe,timestamp:Number(msg.timestamp)||Date.now()/1000};
 if(!chat.messages.some(m=>m.id===entry.id))chat.messages.push(entry);
 chat.messages=chat.messages.slice(-100);
 chat.timestamp=Math.max(chat.timestamp,entry.timestamp);conversations.set(id,chat);update({});
 if(chat.photo===undefined)profilePhoto(id).then(photo=>{chat.photo=photo;update({});}).catch(()=>{});
 if(!contactDirectory.has(id)&&!id.endsWith('@g.us')&&typeof client?.getContactById==='function'){
  client.getContactById(id).then(async contact=>{
   const resolved=await buildDirectory(client,[contact],[]),details=resolved.get(id);
   if(details){for(const [key,value] of resolved)contactDirectory.set(key,value);chat.name=conversationName({id:{_serialized:id,user:id.split('@')[0]}},details,localNames.get(details.phone),chat.name);chat.phone=details.phone;update({});}
  }).catch(()=>{});
 }
}
async function syncContactsAndChats(){
 update({sync:'sincronizando',error:null});
 const errors=[];
 let contacts=[];
 let chats=[];
 try{contacts=await client.getContacts();update({contactsCount:contacts.length,sync:'importando contatos'});}
 catch(e){errors.push('Contatos: '+e.message);}
 try{chats=await client.getChats();}catch(e){errors.push('Conversas: '+e.message);}
 contactDirectory=await buildDirectory(client,contacts,chats.slice(0,400));
 try{
  const unique=[...new Map([...contactDirectory.values()].filter(c=>/^\d{10,15}$/.test(c.phone)).map(c=>[c.phone,{telefone:c.phone,nome:c.savedName||c.publicName||''}])).values()];
  if(unique.length){
   const response=await fetch('http://127.0.0.1:8765/api/whatsapp/sync',{
    method:'POST',headers:{'Content-Type':'application/json','X-Sync-Token':syncToken},
    body:JSON.stringify({contatos:unique})
   });
   if(!response.ok)throw Error('Servidor local retornou HTTP '+response.status);
   const result=await response.json();
   update({contactsCount:unique.length,syncResult:result});
  }
  const localResponse=await fetch('http://127.0.0.1:8765/api/contatos');
  if(!localResponse.ok)throw Error('Falha ao consultar nomes cadastrados');
  localNames=new Map((await localResponse.json()).map(c=>{let phone=String(c.telefone).replace(/\D/g,'');if(!String(c.telefone).startsWith('+')&&(phone.length===10||phone.length===11))phone='55'+phone;return [phone,usableName(c.nome)];}));
 }catch(e){errors.push('Importação: '+e.message);}
 try{
  for(const c of chats.slice(0,400)){
   const id=c.id?._serialized;
   if(!id)continue;
   const old=conversations.get(id)||{id,messages:[],timestamp:0};
   const details=contactDirectory.get(id)||{};
   conversations.set(id,{...old,id,name:conversationName(c,details,localNames.get(details.phone),old.name),phone:details.phone,isGroup:!!c.isGroup,timestamp:c.timestamp||old.timestamp||0});
  }
  update({});
  hydratePhotos([...conversations.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100)).catch(e=>console.error('Fotos:',e.message));
 }catch(e){errors.push('Conversas: '+e.message);}
 if(errors.length)console.error('Detalhes da sincronização:',errors.join(' | '));
 update({sync:errors.length?'parcial':'concluida',error:errors.length?'Alguns contatos ou conversas não puderam ser carregados. Clique em Sincronizar para tentar novamente.':null});
}
async function resetClient(){
 if(initializing||restarting)return;
 restarting=true;update({status:'reconectando',qr:null,error:null});
 try{if(client)await client.destroy()}catch(e){console.error('Falha ao destruir sessão:',e.message)}
 client=null;restarting=false;startWhatsapp();
}
async function startWhatsapp(){
 if(initializing)return;
 initializing=true;
 update({status:'iniciando',qr:null,error:null});
 try {
  const { Client, LocalAuth }=require('whatsapp-web.js');
  client=new Client({authStrategy:new LocalAuth({dataPath:path.join(app.getPath('userData'),'wa-session')}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});
  client.on('qr',async q=>{ try { update({status:'qr',qr:await QRCode.toDataURL(q,{margin:2,width:320}),error:null}); } catch(e){update({status:'erro',error:e.message})} });
  client.on('authenticated',()=>update({status:'autenticado',qr:null,error:null}));
  client.on('ready',async()=>{update({status:'conectado',qr:null,error:null});await syncContactsAndChats();});
  client.on('message',storeMessage);client.on('message_create',storeMessage);
  client.on('disconnected',reason=>update({status:'desconectado',qr:null,error:'Sessão desconectada: '+String(reason)}));
  client.on('auth_failure',msg=>update({status:'erro',error:'Falha de autenticação: '+msg,qr:null}));
  await client.initialize();
 }catch(e){update({status:'erro',error:e.message,qr:null})}
 finally{initializing=false}
}
app.whenReady().then(async()=>{
 startPython();
 window=new BrowserWindow({width:1320,height:830,minWidth:930,minHeight:600,show:false,autoHideMenuBar:true,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:false,preload:path.join(__dirname,'preload.js')}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('http://127.0.0.1:8765/'))event.preventDefault()});
 try{await awaitServer();await window.loadURL('http://127.0.0.1:8765/');window.show();startWhatsapp();}
 catch(e){dialog.showErrorBox('Falha ao iniciar',e.message);app.quit();}
});
ipcMain.handle('wa-state',e=>safeSender(e)?state:null);
ipcMain.handle('wa-reconnect',async e=>{if(!safeSender(e))throw new Error('Janela não autorizada');await resetClient();return true});
ipcMain.handle('wa-sync',async e=>{if(!safeSender(e))throw new Error('Janela não autorizada');if(state.status!=='conectado')throw new Error('WhatsApp não conectado');await syncContactsAndChats();return true});
ipcMain.handle('wa-send',async(e,info)=>{
 if(!safeSender(e))throw new Error('Janela não autorizada');
 if(state.status!=='conectado')throw new Error('Conecte o WhatsApp primeiro');
 const chatId=String(info?.chatId||'');const text=String(info?.text||'').trim();
 if(!/^(\d+@c\.us|\d+@lid|\d+(?:-\d+)?@g\.us)$/.test(chatId)||!text||text.length>10000)throw new Error('Conversa ou mensagem inválida');
 const options={};
 if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
 const sent=await client.sendMessage(chatId,text,options);storeMessage(sent);return true;
});
const documentSelections=new Map();
ipcMain.handle('wa-select-documents',async e=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 const selection=await dialog.showOpenDialog(window,{title:'Selecionar documentos para enviar',properties:['openFile','multiSelections']});
 if(selection.canceled)return {canceled:true};
 if(!selection.filePaths.length||selection.filePaths.length>10)throw Error('Selecione de 1 a 10 documentos por envio.');
 for(const file of selection.filePaths){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Cada documento deve ser um arquivo de até 20 MB.');}
 const selectionId=crypto.randomBytes(24).toString('hex');
 for(const [key,value] of documentSelections){if(Date.now()-value.created>15*60*1000)documentSelections.delete(key);}
 if(documentSelections.size>=10)documentSelections.delete(documentSelections.keys().next().value);
 documentSelections.set(selectionId,{paths:selection.filePaths,created:Date.now()});
 return {selectionId,files:selection.filePaths.map(f=>path.basename(f))};
});
ipcMain.handle('wa-discard-documents',e=>{if(!safeSender(e))throw Error('Janela não autorizada');documentSelections.clear();return true;});
ipcMain.handle('wa-send-documents',async(e,info)=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 if(state.status!=='conectado')throw Error('Conecte o WhatsApp antes de enviar documentos.');
 const selectionId=String(info?.selectionId||''),selection=documentSelections.get(selectionId);
 if(!selection||Date.now()-selection.created>15*60*1000)throw Error('Selecione os documentos novamente. A seleção expirou.');
 const chatIds=Array.isArray(info?.chatIds)?[...new Set(info.chatIds.map(String))]:[];
 if(!chatIds.length||chatIds.length>50||chatIds.some(id=>! /^(\d{10,15}@c\.us|\d+@lid|\d+(?:-\d+)?@g\.us)$/.test(id)))throw Error('Selecione de 1 a 50 contatos ou grupos válidos.');
 const targets=[];
 for(const id of chatIds){
  let chatId=id;
  if(id.endsWith('@c.us')){const number=await client.getNumberId(id.split('@')[0]);if(!number)throw Error('Telefone indisponível no WhatsApp: '+id.split('@')[0]);chatId=number._serialized;}
  const identity=contactDirectory.get(id)?.phone||contactDirectory.get(chatId)?.phone||chatId;
  if(!targets.some(t=>t.identity===identity||t.id===chatId))targets.push({id:chatId,identity,name:conversations.get(id)?.name||localNames.get(id.split('@')[0])||id.split('@')[0]});
 }
 for(const file of selection.paths){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Um documento mudou ou ultrapassa 20 MB. Selecione novamente.');}
 const confirmation=await dialog.showMessageBox(window,{type:'question',title:'Confirmar envio de documentos',message:'Enviar '+selection.paths.length+' documento(s) para '+targets.length+' destinatário(s)?',detail:'Destinatários: '+targets.map(t=>t.name).join(', ')+'\nDocumentos: '+selection.paths.map(f=>path.basename(f)).join(', '),buttons:['Cancelar','Enviar'],defaultId:0,cancelId:0});
 if(confirmation.response!==1)return {canceled:true};
 documentSelections.delete(selectionId);
 const {MessageMedia}=require('whatsapp-web.js');
 let sent=0;
 for(const target of targets){for(const file of selection.paths){
  try{const msg=await client.sendMessage(target.id,MessageMedia.fromFilePath(file),{sendMediaAsDocument:true});storeMessage(msg);sent++;}
  catch{return {sent,total:targets.length*selection.paths.length,error:'O envio foi interrompido. Confira os documentos já enviados antes de tentar novamente.'};}
 }}
 return {sent,total:targets.length*selection.paths.length};
});
ipcMain.handle('wa-create-group',async(e,info)=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 if(state.status!=='conectado')throw Error('WhatsApp desconectado');
 const name=String(info?.name||'').trim();
 const participants=Array.isArray(info?.participants)?info.participants.map(x=>String(x).replace(/\D/g,'')) : [];
 if(!name||name.length>100||participants.length<1||participants.length>100||participants.some(x=>!/^\d{10,15}$/.test(x)))throw Error('Informe o nome do grupo e ao menos um telefone com DDI.');
 const result=await client.createGroup(name,participants.map(x=>x+'@c.us'));
 await syncContactsAndChats();
 return result;
});
ipcMain.handle('wa-reload-photos',async e=>{if(!safeSender(e))throw Error('Janela não autorizada');profileCache.clear();const ids=[...conversations.keys()].slice(0,150);await hydratePhotos(ids.map(id=>({id})));return true;});
ipcMain.handle('wa-contact-photos',async(e,phones)=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 if(state.status!=='conectado')return {};
 if(!Array.isArray(phones)||phones.length>30||phones.some(p=>!/^\d{10,15}$/.test(String(p))))throw Error('Lista de contatos inválida');
 const result={};
 for(let i=0;i<phones.length;i+=5){await Promise.all(phones.slice(i,i+5).map(async phone=>{
  const alias=[...contactDirectory].find(([id,c])=>c.phone===phone&&id.endsWith('@lid'))?.[0]||phone+'@c.us';
  result[phone]=await profilePhoto(alias);
 }));}
 return result;
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{try{pythonProcess?.kill()}catch{}});
