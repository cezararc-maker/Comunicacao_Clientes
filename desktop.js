'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
let window, pythonProcess, client;
let restarting=false, initializing=false;
const syncToken=crypto.randomBytes(32).toString('hex');
let state = { status:'desconectado', qr:null, error:null, conversations:[], contactsCount:0, sync:'aguardando' };
const conversations = new Map();
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
 const chat=conversations.get(id)||{id,name:msg._data?.notifyName||id.split('@')[0],messages:[],timestamp:0};
 const entry={id:msg.id?._serialized||String(Date.now()),body:msg.body|| (msg.hasMedia?'[Mídia]':''),fromMe:!!msg.fromMe,timestamp:Number(msg.timestamp)||Date.now()/1000};
 if(!chat.messages.some(m=>m.id===entry.id))chat.messages.push(entry);
 chat.messages=chat.messages.slice(-100);
 chat.timestamp=Math.max(chat.timestamp,entry.timestamp);conversations.set(id,chat);update({});
}
async function syncContactsAndChats(){
 update({sync:'sincronizando',error:null});
 const errors=[];
 let contacts=[];
 try{contacts=await client.getContacts();update({contactsCount:contacts.length,sync:'importando contatos'});}
 catch(e){errors.push('Contatos: '+e.message);}
 try{
  const sanitized=contacts.filter(c=>!c.isGroup&&!c.isMe&&c.id&&c.id.server==='c.us'&&/^\d{10,15}$/.test(c.id.user))
   .map(c=>({telefone:c.id.user,nome:String(c.name||c.pushname||c.shortName||'').trim()}));
  const unique=[...new Map(sanitized.map(c=>[c.telefone,c])).values()];
  if(unique.length){
   const response=await fetch('http://127.0.0.1:8765/api/whatsapp/sync',{
    method:'POST',headers:{'Content-Type':'application/json','X-Sync-Token':syncToken},
    body:JSON.stringify({contatos:unique})
   });
   if(!response.ok)throw Error('Servidor local retornou HTTP '+response.status);
   const result=await response.json();
   update({contactsCount:unique.length,syncResult:result});
  }
 }catch(e){errors.push('Importação: '+e.message);}
 try{
  const chats=await client.getChats();
  for(const c of chats.slice(0,400)){
   const id=c.id?._serialized;
   if(!id)continue;
   const old=conversations.get(id)||{id,messages:[],timestamp:0};
   conversations.set(id,{...old,id,name:c.name||old.name||c.id.user,isGroup:!!c.isGroup,timestamp:c.timestamp||old.timestamp||0});
  }
  update({});
  hydratePhotos(chats.slice(0,100).map(c=>({id:c.id?._serialized})).filter(c=>c.id)).catch(e=>console.error('Fotos:',e.message));
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
 if(!/^(\d+@c\.us|\d+(?:-\d+)?@g\.us)$/.test(chatId)||!text||text.length>10000)throw new Error('Conversa ou mensagem inválida');
 const options={};
 if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
 const sent=await client.sendMessage(chatId,text,options);storeMessage(sent);return true;
});
ipcMain.handle('wa-send-documents',async(e,info)=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 if(state.status!=='conectado')throw Error('Conecte o WhatsApp antes de enviar documentos.');
 let chatId=String(info?.chatId||'');
 if(!/^(\d{10,15}@c\.us|\d+(?:-\d+)?@g\.us)$/.test(chatId))throw Error('Selecione um destinatário válido.');
 if(chatId.endsWith('@c.us')){
  const number=await client.getNumberId(chatId.split('@')[0]);
  if(!number)throw Error('Este telefone não está disponível no WhatsApp.');
  chatId=number._serialized;
 }
 const selection=await dialog.showOpenDialog(window,{title:'Selecionar documentos para enviar',properties:['openFile','multiSelections']});
 if(selection.canceled)return {canceled:true};
 if(selection.filePaths.length>10)throw Error('Selecione no máximo 10 documentos por envio.');
 for(const file of selection.filePaths){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Cada documento deve ser um arquivo de até 20 MB.');}
 const confirmation=await dialog.showMessageBox(window,{type:'question',title:'Enviar documentos',message:'Enviar '+selection.filePaths.length+' documento(s)?',detail:'Destinatário: '+(conversations.get(chatId)?.name||chatId.split('@')[0])+'\n'+selection.filePaths.map(f=>path.basename(f)).join('\n'),buttons:['Cancelar','Enviar'],defaultId:0,cancelId:0});
 if(confirmation.response!==1)return {canceled:true};
 const {MessageMedia}=require('whatsapp-web.js');
 let sent=0;
 for(const file of selection.filePaths){
  try{const msg=await client.sendMessage(chatId,MessageMedia.fromFilePath(file),{sendMediaAsDocument:true});storeMessage(msg);sent++;}
  catch{ return {sent,error:'O envio foi interrompido. Confira os documentos já enviados antes de tentar novamente.'}; }
 }
 return {sent};
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
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{try{pythonProcess?.kill()}catch{}});
