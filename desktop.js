'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {usableName,buildDirectory,conversationName}=require('./contact_names');
const {PHONES,SINCE,phoneInScope,messageInScope}=require('./sync_scope');
const {resolvePhoto}=require('./profile_photos');
const {getScopedChat,serializedId,normalizeMessage,installWebCompatibility}=require('./whatsapp_compat');
const {replyContext}=require('./reply_context');
const {TEST_GROUP,findTestGroup,registerGroupHandlers}=require('./group_support');
const {createHistoryStore}=require('./history_store');
const {orderedMessages,mediaLabel}=require('./media_messages');
const {registerMediaHandlers}=require('./media_ipc');
const {registerCaptureHandlers}=require('./capture_conversation');
let window, pythonProcess, client;
let restarting=false, initializing=false,syncJob=null;
const allowedChatIds=new Set(PHONES.map(p=>p+'@c.us'));
let photoDiagnostics={};
const syncToken=crypto.randomBytes(32).toString('hex');
let state = { status:'desconectado', qr:null, error:null, conversations:[], contactsCount:0, sync:'aguardando',syncProgress:{running:false,completed:0,total:10,percent:0,label:'Aguardando conexão'},testScope:{phones:PHONES,groupName:TEST_GROUP,since:SINCE},photos:{} };
const conversations = new Map();
const mediaMessages=new Map();
let historyReady=false,photoTimer=null,photoRefreshing=false;
let readActiveChatId=null;const acknowledgments=new Map();
const history=createHistoryStore({token:syncToken,onError:error=>update({error:error.message})});
let contactDirectory=new Map(),localNames=new Map();
const profileCache=new Map(),profileRequests=new Map();
async function profilePhoto(id){
 const phone=contactDirectory.get(id)?.phone||id.split('@')[0];
 if(!phoneInScope(phone)&&!allowedChatIds.has(id))return null;
 const cached=profileCache.get(phone);
 if(cached&&Date.now()-cached.time<5*60*1000)return cached.image;
 if(profileRequests.has(phone))return profileRequests.get(phone);
 const activeClient=client;
 const job=(async()=>{
  const aliases=[...contactDirectory].filter(([key,c])=>c.phone===phone).map(([key])=>key);
  const result=await resolvePhoto(activeClient,[id,phone+'@c.us',...aliases]);
  photoDiagnostics[phone]=result.status;update({photos:{...photoDiagnostics}});
  if(result.error&&!result.image)console.error('Foto de teste:',phone,result.error);
  if(result.image)profileCache.set(phone,{image:result.image,time:Date.now()});
  return result.image;
 })();
 profileRequests.set(phone,job);
 try{return await job;}finally{if(profileRequests.get(phone)===job)profileRequests.delete(phone);}
}
async function hydratePhotos(chats){for(const c of chats){const chat=conversations.get(c.id);if(!chat)continue;chat.photo=await profilePhoto(c.id);update({});}}

function update(patch){state={...state,...patch,conversations:[...conversations.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100)}; if(window && !window.isDestroyed()) window.webContents.send('wa-state', state);if(historyReady)history.queue(state.conversations);}
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
function storeMessage(msg,historical=false,quotedId=null){
 normalizeMessage(msg);
 if(!messageInScope(msg,allowedChatIds))return;
 let id=msg.fromMe?msg.to:msg.from;
 if(!id || id==='status@broadcast')return;
 const details=contactDirectory.get(id)||{};
 const existing=[...conversations.values()].find(c=>details.phone&&c.phone===details.phone);if(existing)id=existing.id;
 const chat=conversations.get(id)||{id,name:conversationName({id:{_serialized:id,user:id.split('@')[0]},isGroup:id.endsWith('@g.us'),name:msg._data?.notifyName},details,localNames.get(details.phone)),messages:[],timestamp:0};
 const messageId=serializedId(msg.id);if(!messageId)return;
 const entry={id:messageId,body:msg.body||'',fromMe:!!msg.fromMe,timestamp:Number(msg.timestamp),type:msg.type||'chat',hasMedia:!!msg.hasMedia,mediaLabel:msg.hasMedia?mediaLabel(msg.type):'',filename:msg._data?.filename||'',ack:acknowledgments.get(messageId)??Number(msg.ack??0)};
 entry.author=msg.author||'';entry.authorName=msg._data?.notifyName||(msg.fromMe?'Você':chat.isGroup?(contactDirectory.get(msg.author)?.savedName||String(msg.author||'').split('@')[0]):chat.name);entry.reply=replyContext(msg,chat.messages,quotedId);
 const previous=chat.messages.findIndex(m=>m.id===entry.id);if(previous<0){chat.messages.push(entry);if(!historical&&!entry.fromMe&&!(id===readActiveChatId&&window?.isFocused?.()))chat.unreadCount=(chat.unreadCount||0)+1;}else chat.messages[previous]={...chat.messages[previous],...entry};
 chat.messages=orderedMessages(chat.messages);
 if(msg.hasMedia)mediaMessages.set(entry.id,msg);
 const retained=new Set([...conversations.values()].flatMap(c=>c.messages.map(m=>m.id)).concat(chat.messages.map(m=>m.id)));
 for(const key of mediaMessages.keys())if(!retained.has(key))mediaMessages.delete(key);
 chat.timestamp=Math.max(chat.timestamp,entry.timestamp);conversations.set(id,chat);update({});
 if(chat.photo===undefined&&!state.syncProgress?.running)profilePhoto(id).then(photo=>{chat.photo=photo;update({});}).catch(()=>{});
 if(!contactDirectory.has(id)&&!id.endsWith('@g.us')&&typeof client?.getContactById==='function'){
  client.getContactById(id).then(async contact=>{
   const resolved=await buildDirectory(client,[contact],[]),details=resolved.get(id);
   if(details){for(const [key,value] of resolved)contactDirectory.set(key,value);chat.name=conversationName({id:{_serialized:id,user:id.split('@')[0]}},details,localNames.get(details.phone),chat.name);chat.phone=details.phone;update({});}
  }).catch(()=>{});
 }
}
function syncContactsAndChats(){
 if(syncJob)return syncJob;
 syncJob=performScopedSync().finally(()=>{syncJob=null});return syncJob;
}
async function performScopedSync(){
 const total=PHONES.length*3+4;let completed=0;
 const progress=label=>update({syncProgress:{running:true,completed,total,percent:Math.round(completed/total*100),label}});
 const step=label=>{completed++;progress(label)};
 update({sync:'sincronizando',error:null,photos:{},contactsCount:0});photoDiagnostics={};progress('Consultando os dois contatos de teste');
 const errors=[],contacts=[],chats=[],targets=[];
 try{
  for(const phone of PHONES){
   let id=phone+'@c.us';
   try{const number=await client.getNumberId(phone);if(!number)throw Error('Número indisponível no WhatsApp');id=number._serialized;allowedChatIds.add(id);
    const contact=await client.getContactById(id);contacts.push(contact);const target={phone,id,contact,chat:null};targets.push(target);
    try{const chat=await getScopedChat(client,contact.id?._serialized||id);if(chat){chats.push(chat);target.chat=chat;allowedChatIds.add(chat.id._serialized);}}
    catch(error){errors.push('Conversa '+phone);console.error('Conversa de teste:',phone,error.message);const chat={id:{_serialized:id,user:phone},name:contact.name,isGroup:false,fetchMessages:async()=>[]};chats.push(chat);target.chat=chat;}
   }catch(error){errors.push('Contato '+phone);console.error('Contato de teste:',phone,error.message);}
   step('Contatos consultados: '+contacts.length+' de '+PHONES.length);
  }
  contactDirectory=await buildDirectory(client,contacts,chats);
  for(const target of targets){const details={...(contactDirectory.get(target.id)||contactDirectory.get(target.contact.id?._serialized)||{}),phone:target.phone};for(const alias of [target.id,target.contact.id?._serialized,target.chat?.id?._serialized,target.phone+'@c.us'].filter(Boolean)){contactDirectory.set(alias,details);allowedChatIds.add(alias);}}
  if(typeof client.getContactLidAndPhone==='function'){
   try{for(const pair of await client.getContactLidAndPhone([...allowedChatIds].filter(id=>!id.endsWith('@g.us')))){
    const details=contactDirectory.get(pair.lid)||contactDirectory.get(pair.pn);
    if(pair.lid&&pair.pn&&details&&phoneInScope(details.phone)){
     for(const alias of [pair.lid,pair.pn]){allowedChatIds.add(alias);contactDirectory.set(alias,details);}
    }
   }}catch(error){console.error('Identificadores de teste:',error.message);}
  }
  step('Nomes dos contatos identificados');
  const unique=[...new Map([...contactDirectory.values()].filter(c=>phoneInScope(c.phone)).map(c=>[c.phone,{telefone:c.phone,nome:c.savedName||c.publicName||''}])).values()];
  if(unique.length){const response=await fetch('http://127.0.0.1:8765/api/whatsapp/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Sync-Token':syncToken},body:JSON.stringify({contatos:unique})});if(!response.ok)throw Error('Falha ao salvar contatos');update({contactsCount:unique.length,syncResult:await response.json()});}
  const response=await fetch('http://127.0.0.1:8765/api/contatos?telefones='+PHONES.join(','));if(!response.ok)throw Error('Falha ao consultar os cadastros');
  localNames=new Map((await response.json()).map(c=>{let phone=String(c.telefone).replace(/\D/g,'');if(!String(c.telefone).startsWith('+')&&(phone.length===10||phone.length===11))phone='55'+phone;return [phone,usableName(c.nome)];}));
  step('Cadastros de teste atualizados');
  for(let i=0;i<PHONES.length;i++){
   const chat=targets.find(t=>t.phone===PHONES[i])?.chat;
   if(chat){
    const id=chat.id._serialized,details=contactDirectory.get(id)||{};
    const old=conversations.get(id)||{messages:[],timestamp:0};
    conversations.set(id,{...old,id,name:conversationName(chat,details,localNames.get(details.phone),old.name),phone:details.phone,isGroup:false,messages:old.messages.filter(m=>m.timestamp>=SINCE),timestamp:old.timestamp});
    try{if(!chat.lastMessage||Number(chat.lastMessage.timestamp)>=SINCE){const messages=await chat.fetchMessages({limit:100});for(const msg of messages)storeMessage(msg,true);}}
    catch(error){errors.push('Mensagens '+(details.phone||id));console.error('Mensagens de teste:',error.message);}
   }
   step('Mensagens recentes: '+(i+1)+' de '+PHONES.length+' contatos');
  }
  for(let i=0;i<PHONES.length;i++){
   const phone=PHONES[i],chat=[...conversations.values()].find(c=>c.phone===phone)||chats.find(c=>c.id.user===phone);
   const image=await profilePhoto(chat?.id?._serialized||chat?.id||phone+'@c.us');
   for(const c of conversations.values()){if(c.phone===phone)c.photo=image;}
   step('Fotos consultadas: '+(i+1)+' de '+PHONES.length);
  }
  try{const group=await findTestGroup(client);if(group){const id=serializedId(group.id);allowedChatIds.add(id);const old=conversations.get(id)||{messages:[],timestamp:0};conversations.set(id,{...old,id,name:TEST_GROUP,isGroup:true,description:group.description||'',messages:old.messages.filter(m=>m.timestamp>=SINCE)});if(!group.lastMessage||group.lastMessage.timestamp>=SINCE)for(const msg of await group.fetchMessages({limit:100}))storeMessage(msg,true);}else if(client.pupPage)errors.push('Grupo Teste app não encontrado');}catch(error){errors.push('Grupo Teste app');console.error('Grupo de teste:',error.message);}step('Grupo Teste app consultado');
  step('Sincronização finalizada');
  update({sync:errors.length?'parcial':'concluida',error:errors.length?'Não foi possível carregar: '+errors.join(', ')+'. Tente sincronizar novamente.':null,syncProgress:{running:false,completed,total,percent:100,label:errors.length?'Concluída com pendências':'Sincronização concluída'}});
  return {ok:!errors.length,message:errors.length?'Sincronização concluída com pendências.':'Dois contatos de teste sincronizados.'};
 }catch(error){console.error('Sincronização de teste:',error.message);update({sync:'parcial',error:'A sincronização foi interrompida. Verifique a conexão e tente novamente.',syncProgress:{running:false,completed,total,percent:Math.round(completed/total*100),label:'Sincronização interrompida'}});return {ok:false,message:'A sincronização foi interrompida. Tente novamente.'};}
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
  client.on('loading_screen',(percent,message)=>update({connectionLoading:Number(percent)||0,connectionMessage:'Carregando WhatsApp'}));
  client.on('ready',async()=>{await installWebCompatibility(client);profileCache.clear();update({status:'conectado',qr:null,error:null});await syncContactsAndChats();clearInterval(photoTimer);photoTimer=setInterval(refreshProfilePhotos,60000);photoTimer.unref?.();});
  client.on('message_ack',(msg,ack)=>{const id=serializedId(msg.id);if(!id)return;acknowledgments.set(id,Number(ack));if(acknowledgments.size>2000)acknowledgments.delete(acknowledgments.keys().next().value);for(const chat of conversations.values()){const m=chat.messages.find(m=>m.id===id);if(m)m.ack=Number(ack);}update({});});
  for(const event of ['group_join','group_leave','group_admin_changed','group_update'])client.on(event,notification=>{const id=String(notification.chatId||'');if(conversations.get(id)?.isGroup&&allowedChatIds.has(id))update({groupRevision:(state.groupRevision||0)+1});});
  client.on('message',storeMessage);client.on('message_create',storeMessage);
  client.on('disconnected',reason=>update({status:'desconectado',qr:null,error:'Sessão desconectada: '+String(reason)}));
  client.on('auth_failure',msg=>update({status:'erro',error:'Falha de autenticação: '+msg,qr:null}));
  await client.initialize();
 }catch(e){update({status:'erro',error:e.message,qr:null})}
 finally{initializing=false}
}
app.whenReady().then(async()=>{
 startPython();
 window=new BrowserWindow({width:1320,height:830,minWidth:930,minHeight:600,show:false,frame:false,roundedCorners:true,backgroundColor:'#F4F7FA',autoHideMenuBar:true,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:false,preload:path.join(__dirname,'preload.js')}});
 window.on('focus',()=>{const chat=conversations.get(readActiveChatId);if(chat&&chat.unreadCount){chat.unreadCount=0;update({});}});
 window.on('maximize',()=>update({windowMaximized:true}));window.on('unmaximize',()=>update({windowMaximized:false}));
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('http://127.0.0.1:8765/'))event.preventDefault()});
 registerCaptureHandlers({ipcMain,BrowserWindow,dialog,getWindow:()=>window,safeSender});
 try{await awaitServer();for(const chat of await history.load()){if(!phoneInScope(chat.phone)&&!(chat.isGroup&&chat.name===TEST_GROUP))continue;chat.messages=(chat.messages||[]).filter(m=>m.timestamp>=SINCE);conversations.set(chat.id,chat);allowedChatIds.add(chat.id);}historyReady=true;update({});await window.loadURL('http://127.0.0.1:8765/');window.show();startWhatsapp();}
 catch(e){dialog.showErrorBox('Falha ao iniciar',e.message);app.quit();}
});
ipcMain.handle('wa-state',e=>safeSender(e)?state:null);
registerMediaHandlers({ipcMain,dialog,getWindow:()=>window,safeSender,getClient:()=>client,getState:()=>state,getMessage:id=>mediaMessages.get(id),storeMessage,readMedia:history.readMedia,saveMedia:history.saveMedia});
ipcMain.handle('wa-reconnect',async e=>{if(!safeSender(e))throw new Error('Janela não autorizada');if(syncJob)return {ok:false,message:'Aguarde a sincronização terminar antes de reconectar.'};await resetClient();return {ok:true}});
ipcMain.handle('wa-sync',async e=>{if(!safeSender(e))throw new Error('Janela não autorizada');if(state.status!=='conectado')return {ok:false,message:'Aguarde o WhatsApp conectar. Se houver QR Code, escaneie-o primeiro.'};return await syncContactsAndChats();});
ipcMain.handle('wa-send',async(e,info)=>{
 if(!safeSender(e))throw new Error('Janela não autorizada');
 if(state.status!=='conectado')throw new Error('Conecte o WhatsApp primeiro');
 const chatId=String(info?.chatId||'');const text=String(info?.text||'').trim();
 if(!/^(\d+@c\.us|\d+@lid|\d+(?:-\d+)?@g\.us)$/.test(chatId)||!text||text.length>10000)throw new Error('Conversa ou mensagem inválida');
 const options={};
 if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
 const sent=await client.sendMessage(chatId,text,options);if(!sent)throw Error('O WhatsApp não confirmou o envio.');storeMessage(sent,false,info?.quotedId);return {id:serializedId(sent.id)};
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
ipcMain.handle('wa-reload-photos',async e=>{if(!safeSender(e))throw Error('Janela não autorizada');if(state.status!=='conectado')return {ok:false,message:'Aguarde o WhatsApp conectar para atualizar as fotos.'};profileCache.clear();photoDiagnostics={};await hydratePhotos([...conversations.values()]);for(const phone of PHONES)await profilePhoto(phone+'@c.us');return {ok:true};});
ipcMain.handle('wa-contact-photos',async(e,phones)=>{
 if(!safeSender(e))throw Error('Janela não autorizada');
 if(state.status!=='conectado'||state.syncProgress?.running)return {};
 if(!Array.isArray(phones)||phones.length>30||phones.some(p=>!/^\d{10,15}$/.test(String(p))))throw Error('Lista de contatos inválida');
 const result={};
 for(let i=0;i<phones.length;i+=5){await Promise.all(phones.slice(i,i+5).map(async phone=>{
  const alias=[...contactDirectory].find(([id,c])=>c.phone===phone&&id.endsWith('@lid'))?.[0]||phone+'@c.us';
  if(phoneInScope(phone))result[phone]=await profilePhoto(alias);
 }));}
 return result;
});
app.on('window-all-closed',()=>app.quit());
let quitting=false;
app.on('before-quit',event=>{clearInterval(photoTimer);if(historyReady&&!quitting){event.preventDefault();quitting=true;history.flush().finally(()=>{try{pythonProcess?.kill()}catch{}app.quit();});return;}try{pythonProcess?.kill()}catch{}});
async function refreshProfilePhotos(){
 if(state.status!=='conectado'||state.syncProgress?.running||photoRefreshing)return;photoRefreshing=true;
 try{for(const phone of PHONES){profileCache.delete(phone);const alias=[...contactDirectory].find(([id,c])=>c.phone===phone&&id.endsWith('@lid'))?.[0]||phone+'@c.us';const photo=await profilePhoto(alias);for(const chat of conversations.values())if(chat.phone===phone&&photo)chat.photo=photo;}update({photoRefreshAt:Date.now()});}catch(error){console.error('Atualização automática de fotos:',error.message);}finally{photoRefreshing=false;}
}

ipcMain.handle('wa-mark-read',(e,id)=>{if(!safeSender(e))throw Error('Janela não autorizada');readActiveChatId=id?String(id):null;const chat=conversations.get(String(id));if(chat){chat.unreadCount=0;update({});}return true;});
ipcMain.handle('wa-save-contact',async(e,info)=>{if(!safeSender(e))throw Error('Janela não autorizada');if(state.status!=='conectado')throw Error('O contato foi salvo no aplicativo. Conecte o WhatsApp para sincronizá-lo com o celular.');const phone=String(info?.phone||'').replace(/\D/g,''),name=String(info?.name||'').trim();if(!/^\d{10,15}$/.test(phone)||!name||name.length>200)throw Error('Contato inválido');await client.saveOrEditAddressbookContact(phone,name,'',true);return {ok:true};});
ipcMain.handle('window-action',(e,action)=>{if(!safeSender(e))throw Error('Janela não autorizada');if(action==='close')window.close();else if(action==='minimize')window.minimize();else if(action==='maximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}return true;});

registerGroupHandlers({ipcMain,safeSender,getClient:()=>client,getState:()=>state});
