'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const {createPresenceMonitor}=require('./chat_presence');
const {usableName,buildDirectory,conversationName}=require('./contact_names');
const {PHONES,SINCE,phoneInScope,messageInScope}=require('./sync_scope');
const {resolvePhoto}=require('./profile_photos');
const {getScopedChat,serializedId,normalizeMessage,installWebCompatibility}=require('./whatsapp_compat');
const {replyContext}=require('./reply_context');
const {TEST_GROUP,findTestGroup,registerGroupHandlers}=require('./group_support');
const {createHistoryStore}=require('./history_store');
const {orderedMessages,mediaLabel}=require('./media_messages');
const {createDesktopNotifications}=require('./desktop_notifications');let desktopNotifications=null;
const {registerBatchHandlers}=require('./batch_messages');const omittedMessages=new Set();
const {registerMediaHandlers}=require('./media_ipc');
const {registerCaptureHandlers}=require('./capture_conversation');
const {createDepartmentConnections}=require('./department_connections');
const {connectionOptions,connectionError,initializeConnection}=require('./whatsapp_connection');
let departmentConnections=null,legacyAuthorized=false,managementConfigured=false;
let window, pythonProcess, client;
let restarting=false, initializing=false,syncJob=null,connectionGeneration=0;
const allowedChatIds=new Set(PHONES.map(p=>p+'@c.us'));
let photoDiagnostics={};
const syncToken=crypto.randomBytes(32).toString('hex');
let state = { status:'desconectado', qr:null, error:null, conversations:[], contactsCount:0, sync:'aguardando',syncProgress:{running:false,completed:0,total:10,percent:0,label:'Aguardando conexão'},testScope:{phones:PHONES,groupName:TEST_GROUP,since:SINCE},photos:{} };
const conversations = new Map();
const presenceMonitor=createPresenceMonitor({getClient:()=>client,getChats:()=>[...conversations.keys()].filter(id=>allowedChatIds.has(id)),onChange:presence=>{state.presence=presence;departmentConnections?.presence(1,presence).catch(()=>{});if((!managementConfigured||legacyAuthorized)&&window&&!window.isDestroyed())window.webContents.send('wa-presence',presence);}});
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

function update(patch){state={...state,...patch,conversations:[...conversations.values()].sort((a,b)=>Number(!!b.pinnedConversation)-Number(!!a.pinnedConversation)||b.timestamp-a.timestamp).slice(0,100)}; if(window && !window.isDestroyed()) window.webContents.send('wa-state', (!managementConfigured||legacyAuthorized)?state:{status:state.status,conversations:[],syncProgress:state.syncProgress});if(historyReady)history.queue(state.conversations);}
function baseSender(event){return !!window && event.sender.id === window.webContents.id && event.sender.getURL().startsWith('http://127.0.0.1:8765/');}
function safeSender(event){return baseSender(event)&&(!managementConfigured||legacyAuthorized);}
const registerHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>registerHandle(channel,async(event,...args)=>{
 if(channel!=='window-action'&&baseSender(event)){await refreshLegacyAccess();if(managementConfigured&&!legacyAuthorized)throw Error('Entre como administrador para administrar o WhatsApp. Seus atendimentos ficam em Conversas.');}
 return handler(event,...args);
});
let activeManagementUser=null,nativeNoticeUser=null,nativeNoticeLast=0;
const nativeTriageSeen=new Map();
async function managementRequest(route){const cookies=await window.webContents.session.cookies.get({url:'http://127.0.0.1:8765/api/gestao/contexto'});return fetch('http://127.0.0.1:8765/api/gestao'+route,{headers:{Cookie:cookies.map(c=>c.name+'='+c.value).join('; ')}});}
async function refreshLegacyAccess(){try{const configured=await fetch('http://127.0.0.1:8765/api/gestao/status').then(r=>r.json());managementConfigured=!!configured.configurado;const response=await managementRequest('/contexto');activeManagementUser=response.ok?(await response.json()).usuario:null;legacyAuthorized=activeManagementUser?.perfil==='admin';if(nativeNoticeUser!==activeManagementUser?.id){nativeNoticeUser=activeManagementUser?.id;nativeNoticeLast=-1;nativeTriageSeen.clear();desktopNotifications?.dispose();}}catch{legacyAuthorized=false;activeManagementUser=null;}}
async function pollOwnerNotifications(){
 await refreshLegacyAccess();if(!activeManagementUser)return;
 const userId=activeManagementUser.id;
 try{const response=await managementRequest('/avisos');if(!response.ok)return;const data=await response.json();if(activeManagementUser?.id!==userId)return;
  const triage=data.triagem||[],keys=new Set();for(const row of triage){const key=row.conexao_id+':'+row.conversa_id;keys.add(key);const previous=nativeTriageSeen.get(key)||0;nativeTriageSeen.set(key,row.aviso_id);if(row.aviso_id>previous&&row.notificar!==false&&!window.isFocused?.())await desktopNotifications?.show(row.nome,'Mensagem aguardando identificação da empresa',{triage:{conexao_id:row.conexao_id,conversa_id:row.conversa_id},userId});}for(const key of nativeTriageSeen.keys())if(!keys.has(key))nativeTriageSeen.delete(key);
  const notices=data.mensagens||[],latest=Math.max(0,...notices.map(n=>n.id));if(nativeNoticeLast<0){nativeNoticeLast=latest;return;}const fresh=notices.filter(n=>n.id>nativeNoticeLast);nativeNoticeLast=Math.max(nativeNoticeLast,latest);if(!window.isFocused?.()&&fresh.length){const n=fresh[0];await desktopNotifications?.show(n.contato_nome,'Nova mensagem / '+n.empresa_nome,{attendanceId:n.atendimento_id,userId,messageId:n.mensagem_id});}
 }catch{}
}

function startPython(){
 const args=['app.py'], options={cwd:__dirname,windowsHide:true,env:{...process.env,WA_SYNC_TOKEN:syncToken}};
 if(process.platform==='win32') pythonProcess=spawn('py',['-3',...args],options);
 else pythonProcess=spawn('python3',args,options);
 pythonProcess.on('error',e=>update({error:'Servidor Python: '+e.message}));
 pythonProcess.stderr.on('data',d=>console.error(String(d)));
}
async function awaitServer(){
 for(let i=0;i<80;i++){
  try{const r=await fetch('http://127.0.0.1:8765/api/gestao/status');if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,350));
 }
 throw new Error('Servidor de cadastros não iniciou. Verifique Python e as dependências.');
}
function storeMessage(msg,historical=false,quotedId=null){
 if(!historical&&state.status!=='conectado')return;
 normalizeMessage(msg);
 if(!messageInScope(msg,allowedChatIds))return;
 let id=msg.fromMe?msg.to:msg.from;
 if(!id || id==='status@broadcast')return;
 const details=contactDirectory.get(id)||{};
 const existing=[...conversations.values()].find(c=>details.phone&&c.phone===details.phone);if(existing)id=existing.id;
 const chat=conversations.get(id)||{id,name:conversationName({id:{_serialized:id,user:id.split('@')[0]},isGroup:id.endsWith('@g.us'),name:msg._data?.notifyName},details,localNames.get(details.phone)),messages:[],timestamp:0};
 const messageId=serializedId(msg.id);if(!messageId||omittedMessages.has(messageId))return;
 const entry={id:messageId,body:msg.body||'',fromMe:!!msg.fromMe,timestamp:Number(msg.timestamp),type:msg.type||'chat',hasMedia:!!msg.hasMedia,mediaLabel:msg.hasMedia?mediaLabel(msg.type):'',filename:msg._data?.filename||'',ack:acknowledgments.get(messageId)??Number(msg.ack??0)};
 entry.vCards=Array.isArray(msg.vCards)?msg.vCards.slice(0,20):[];entry.isGif=!!msg.isGif;
 entry.author=msg.author||'';entry.authorName=msg._data?.notifyName||(msg.fromMe?'Você':chat.isGroup?(contactDirectory.get(msg.author)?.savedName||String(msg.author||'').split('@')[0]):chat.name);entry.reply=replyContext(msg,chat.messages,quotedId);
 const previous=chat.messages.findIndex(m=>m.id===entry.id);if(previous<0){chat.messages.push(entry);if(!historical&&!entry.fromMe&&!(id===readActiveChatId&&window?.isFocused?.()))chat.unreadCount=(chat.unreadCount||0)+1;}else chat.messages[previous]={...chat.messages[previous],...entry};

 chat.messages=orderedMessages(chat.messages);
 if(msg.hasMedia)mediaMessages.set(entry.id,msg);
 const retained=new Set([...conversations.values()].flatMap(c=>c.messages.map(m=>m.id)).concat(chat.messages.map(m=>m.id)));
 for(const key of mediaMessages.keys())if(!retained.has(key))mediaMessages.delete(key);
 chat.timestamp=Math.max(chat.timestamp,entry.timestamp);conversations.set(id,chat);update({});
 if(!historical&&departmentConnections)departmentConnections.receive(1,msg,chat).catch(error=>console.warn('Atendimento:',error.message));
 if(!managementConfigured&&previous<0&&!historical&&!entry.fromMe&&window&&!window.isDestroyed()){const target={chatId:id,messageId:entry.id,title:chat.name,text:entry.hasMedia?entry.mediaLabel:['vcard','multi_vcard'].includes(entry.type)?'Cartão de contato':entry.body};if(window.isFocused?.())window.webContents.send('wa-incoming-message',target);else desktopNotifications?.show(target.title,target.text,target).catch(()=>{});}
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
 if(initializing||restarting)throw Error('A conexão já está sendo iniciada. Aguarde ou use Desconectar para interromper.');
 restarting=true;await presenceMonitor.stop();update({status:'reconectando',qr:null,error:null});
 try{if(client)await client.destroy()}catch(e){console.error('Falha ao destruir sessão:',e.message)}
 client=null;restarting=false;startWhatsapp();
}
function logConnection(detail){try{const dir=path.join(app.getPath('userData'),'diagnostics');fs.mkdirSync(dir,{recursive:true});fs.appendFileSync(path.join(dir,'whatsapp-connection.log'),JSON.stringify({time:new Date().toISOString(),...detail})+'\n');}catch{}}
async function disconnectWhatsapp(){connectionGeneration++;initializing=false;restarting=false;clearInterval(photoTimer);const previous=client;client=null;await presenceMonitor.stop();if(previous)await previous.destroy();update({status:'desconectado',qr:null,error:null});}
async function reportManagementConnection(status,number='',patch={}){try{const response=await fetch('http://127.0.0.1:8765/api/gestao/ponte/estado',{method:'POST',headers:{'Content-Type':'application/json','X-Sync-Token':syncToken},body:JSON.stringify({conexao_id:1,estado:status,numero:number,...patch})});if(!response.ok){const result=await response.json();console.warn('Gestão de conexões:',result.erro);return false;}return true;}catch(error){console.warn('Gestão de conexões:',error.message);return false;}}
async function startWhatsapp(){
 if(initializing)return;
 const generation=++connectionGeneration;initializing=true;let activeClient;
 update({status:'iniciando',qr:null,error:null});
 await reportManagementConnection('aguardando');
 try {
  const { Client, LocalAuth }=require('whatsapp-web.js');
  activeClient=new Client({...connectionOptions(),authStrategy:new LocalAuth({dataPath:path.join(app.getPath('userData'),'wa-session')}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});client=activeClient;const current=()=>!restarting&&client===activeClient&&generation===connectionGeneration;
  client.on('qr',async q=>{if(!current())return;try { const qr=await QRCode.toDataURL(q,{margin:2,width:320});if(!current())return;update({status:'qr',qr,error:null});await fetch('http://127.0.0.1:8765/api/gestao/ponte/estado',{method:'POST',headers:{'Content-Type':'application/json','X-Sync-Token':syncToken},body:JSON.stringify({conexao_id:1,estado:'qr',qr})}); } catch(e){update({status:'erro',error:e.message})} });
  client.on('authenticated',()=>{if(current()){update({status:'autenticado',qr:null,error:null});reportManagementConnection('autenticado');}});
  client.on('loading_screen',(percent,message)=>{if(current())update({connectionLoading:Number(percent)||0,connectionMessage:'Carregando WhatsApp'});});
  client.on('ready',async()=>{if(!current())return;await installWebCompatibility(activeClient);if(!current())return;const accepted=await reportManagementConnection('conectado',serializedId(client.info?.wid).split('@')[0]);if(!current())return;if(!accepted){update({status:'erro',error:'Número divergente ou não identificado. Confira as conexões na Gestão.',qr:null});try{await client.destroy()}catch{}client=null;return;}profileCache.clear();update({status:'conectado',qr:null,error:null});await syncContactsAndChats();try{const result=await presenceMonitor.start();if(!result.supported)console.warn('Indicadores de atividade indisponíveis nesta versão do WhatsApp Web.');}catch(error){console.warn('Indicadores de atividade:',error.message);}clearInterval(photoTimer);photoTimer=setInterval(refreshProfilePhotos,300000);photoTimer.unref?.();});
  client.on('message_ack',(msg,ack)=>{const id=serializedId(msg.id);if(!id)return;acknowledgments.set(id,Number(ack));if(acknowledgments.size>2000)acknowledgments.delete(acknowledgments.keys().next().value);for(const chat of conversations.values()){const m=chat.messages.find(m=>m.id===id);if(m){m.ack=Number(ack);departmentConnections?.receive(1,msg,chat).catch(()=>{});}}update({});});
  for(const event of ['group_join','group_leave','group_admin_changed','group_update'])client.on(event,notification=>{const id=String(notification.chatId||'');if(conversations.get(id)?.isGroup&&allowedChatIds.has(id))update({groupRevision:(state.groupRevision||0)+1});});
  client.on('message',msg=>{if(current())storeMessage(msg);});client.on('message_create',msg=>{if(current())storeMessage(msg);});
  client.on('disconnected',reason=>{if(!current())return;reportManagementConnection('desconectado');presenceMonitor.stop();update({status:'desconectado',qr:null,error:'Sessão desconectada: '+String(reason)});});
  client.on('auth_failure',msg=>{if(!current())return;const error='Falha de autenticação: '+String(msg);logConnection({phase:'auth_failure',error});reportManagementConnection('erro','',{erro:error});presenceMonitor.stop();update({status:'erro',error,qr:null});});
  await initializeConnection(activeClient,{onDiagnostic:logConnection});if(!current())try{await activeClient.destroy()}catch{}
 }catch(e){if(generation!==connectionGeneration)return;const error=connectionError(e);logConnection({phase:'error',error});console.error('Conexão WhatsApp:',error);update({status:'erro',error,qr:null});await reportManagementConnection('erro','',{erro:error});if(client===activeClient){client=null;try{await activeClient?.destroy()}catch{}}}
 finally{if(generation===connectionGeneration)initializing=false}
}
app.whenReady().then(async()=>{
 startPython();
 window=new BrowserWindow({width:1320,height:830,minWidth:930,minHeight:600,show:false,frame:false,roundedCorners:true,backgroundColor:'#F4F7FA',autoHideMenuBar:true,
  webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:false,preload:path.join(__dirname,'preload.js')}});
 window.on('focus',()=>{const chat=conversations.get(readActiveChatId);if(chat&&chat.unreadCount){chat.unreadCount=0;update({});}});
 window.on('maximize',()=>update({windowMaximized:true}));window.on('unmaximize',()=>update({windowMaximized:false}));
 window.webContents.setWindowOpenHandler(({url})=>{try{const parsed=new URL(url);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)shell.openExternal(parsed.href);}catch{}return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('http://127.0.0.1:8765/'))event.preventDefault()});
 desktopNotifications=createDesktopNotifications({BrowserWindow,ipcMain,screen,getWindow:()=>window,onOpen:async target=>{await refreshLegacyAccess();if(target.triage){if(!activeManagementUser||activeManagementUser.id!==target.userId)return false;const response=await managementRequest('/triagem');if(!response.ok)return false;const rows=await response.json();if(!rows.some(row=>row.conexao_id===target.triage.conexao_id&&row.conversa_id===target.triage.conversa_id))return false;if(window.isMinimized())window.restore();window.show();window.focus();window.webContents.send('management-open-message',target);return true;}if(target.attendanceId){if(!activeManagementUser||activeManagementUser.id!==target.userId)return false;const response=await managementRequest('/atendimentos/'+target.attendanceId);if(!response.ok)return false;if(window.isMinimized())window.restore();window.show();window.focus();window.webContents.send('management-open-message',target);return true;}if(managementConfigured&&!legacyAuthorized)return false;const chat=conversations.get(target.chatId);if(!window||window.isDestroyed()||!allowedChatIds.has(target.chatId)||!chat?.messages.some(message=>message.id===target.messageId))return false;if(window.isMinimized())window.restore();window.show();window.focus();window.webContents.send('wa-open-message',target);return true;}});
 registerCaptureHandlers({ipcMain,BrowserWindow,dialog,getWindow:()=>window,safeSender});
 try{await awaitServer();managementConfigured=!!(await fetch('http://127.0.0.1:8765/api/gestao/status').then(r=>r.json())).configurado;for(const id of await history.loadOmitted())omittedMessages.add(id);for(const chat of await history.load()){if(!phoneInScope(chat.phone)&&!(chat.isGroup&&chat.name===TEST_GROUP))continue;chat.messages=(chat.messages||[]).filter(m=>m.timestamp>=SINCE);conversations.set(chat.id,chat);allowedChatIds.add(chat.id);}historyReady=true;update({});await window.loadURL('http://127.0.0.1:8765/');window.show();departmentConnections=createDepartmentConnections({token:syncToken,dataPath:app.getPath('userData'),getPrimary:()=>client,reconnectPrimary:resetClient,disconnectPrimary:disconnectWhatsapp,primarySent:storeMessage});await departmentConnections.start();const accessTimer=setInterval(pollOwnerNotifications,1500);accessTimer.unref();await refreshLegacyAccess();const configs=await fetch('http://127.0.0.1:8765/api/gestao/ponte/configuracao',{headers:{'X-Sync-Token':syncToken}}).then(r=>r.json());if(configs.find(c=>c.id===1)?.habilitada)startWhatsapp();}
 catch(e){dialog.showErrorBox('Falha ao iniciar',e.message);app.quit();}
});
ipcMain.handle('wa-state',e=>safeSender(e)?state:null);
registerMediaHandlers({ipcMain,dialog,getWindow:()=>window,safeSender,getClient:()=>client,getState:()=>state,getMessage:id=>mediaMessages.get(id),storeMessage,readMedia:history.readMedia,saveMedia:history.saveMedia});
ipcMain.handle('wa-reconnect',async e=>{if(!safeSender(e))throw new Error('Janela não autorizada');if(syncJob)return {ok:false,message:'Aguarde a sincronização terminar antes de reconectar.'};await resetClient();return {ok:true}});
ipcMain.handle('wa-disconnect',async e=>{if(!safeSender(e))throw Error('Janela não autorizada');await disconnectWhatsapp();await reportManagementConnection('desconectado');return {ok:true};});
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
 if(name===TEST_GROUP)await syncContactsAndChats();
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
app.on('before-quit',event=>{clearInterval(photoTimer);if(historyReady&&!quitting){event.preventDefault();quitting=true;const retiring=client;client=null;Promise.allSettled([history.flush(),departmentConnections?.stop(),presenceMonitor.stop(),retiring?.destroy()]).finally(()=>{try{pythonProcess?.kill()}catch{}app.quit();});return;}try{pythonProcess?.kill()}catch{}});
async function refreshProfilePhotos(){
 if(state.status!=='conectado'||state.syncProgress?.running||photoRefreshing)return;photoRefreshing=true;
 try{for(const phone of PHONES){profileCache.delete(phone);const alias=[...contactDirectory].find(([id,c])=>c.phone===phone&&id.endsWith('@lid'))?.[0]||phone+'@c.us';const photo=await profilePhoto(alias);for(const chat of conversations.values())if(chat.phone===phone&&photo)chat.photo=photo;}update({photoRefreshAt:Date.now()});}catch(error){console.error('Atualização automática de fotos:',error.message);}finally{photoRefreshing=false;}
}

ipcMain.handle('wa-mark-read',(e,id)=>{if(!safeSender(e))throw Error('Janela não autorizada');readActiveChatId=id?String(id):null;const chat=conversations.get(String(id));if(chat){chat.unreadCount=0;chat.markedUnread=false;update({});}return true;});
ipcMain.handle('wa-save-contact',async(e,info)=>{if(!safeSender(e))throw Error('Janela não autorizada');if(state.status!=='conectado')throw Error('O contato foi salvo no aplicativo. Conecte o WhatsApp para sincronizá-lo com o celular.');const phone=String(info?.phone||'').replace(/\D/g,''),name=String(info?.name||'').trim();if(!/^\d{10,15}$/.test(phone)||!name||name.length>200)throw Error('Contato inválido');await client.saveOrEditAddressbookContact(phone,name,'',true);return {ok:true};});
ipcMain.handle('window-action',(e,action)=>{if(!baseSender(e))throw Error('Janela não autorizada');if(action==='close')window.close();else if(action==='minimize')window.minimize();else if(action==='maximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}return true;});

registerGroupHandlers({ipcMain,safeSender,getClient:()=>client,getState:()=>state});

registerBatchHandlers({ipcMain,safeSender,getClient:()=>client,getState:()=>state,getMessage:id=>mediaMessages.get(id),omitMessages:async(chat,id)=>{await history.omit(chat.id,id);omittedMessages.add(id);chat.messages=chat.messages.filter(m=>m.id!==id);update({});},changeChat:async(chat,action,value)=>{if(state.status==='conectado'){if(action==='unread')await client.markChatUnread(chat.id);else if(value){if(!await client.pinChat(chat.id))throw Error('O WhatsApp não permitiu fixar mais conversas.');}else await client.unpinChat(chat.id);}if(action==='pin')chat.pinnedConversation=value;else{chat.markedUnread=true;if(readActiveChatId===chat.id)readActiveChatId=null;}update({});await history.flush();return {ok:true};}});
