'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const QRCode = require('qrcode');
let window, pythonProcess, client;
let state = { status:'iniciando', qr:null, error:null, conversations:[] };
const conversations = new Map();
function update(patch){state={...state,...patch,conversations:[...conversations.values()].sort((a,b)=>b.timestamp-a.timestamp).slice(0,100)}; if(window && !window.isDestroyed()) window.webContents.send('wa-state', state);}
function safeSender(event){return !!window && event.sender.id === window.webContents.id && event.sender.getURL().startsWith('http://127.0.0.1:8765/');}
function startPython(){
 const args=['app.py'], options={cwd:__dirname,windowsHide:true};
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
 if(!id || id.endsWith('@g.us'))return;
 const chat=conversations.get(id)||{id,name:msg._data?.notifyName||id.split('@')[0],messages:[],timestamp:0};
 const entry={id:msg.id?._serialized||String(Date.now()),body:msg.body|| (msg.hasMedia?'[Mídia]':''),fromMe:!!msg.fromMe,timestamp:Number(msg.timestamp)||Date.now()/1000};
 if(!chat.messages.some(m=>m.id===entry.id))chat.messages.push(entry);
 chat.messages=chat.messages.slice(-100);
 chat.timestamp=Math.max(chat.timestamp,entry.timestamp);conversations.set(id,chat);update({});
}
async function startWhatsapp(){
 try {
  const { Client, LocalAuth }=require('whatsapp-web.js');
  client=new Client({authStrategy:new LocalAuth({dataPath:path.join(app.getPath('userData'),'wa-session')}),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});
  client.on('qr',async q=>{ try { update({status:'qr',qr:await QRCode.toDataURL(q,{margin:2,width:320}),error:null}); } catch(e){update({status:'erro',error:e.message})} });
  client.on('authenticated',()=>update({status:'autenticado',qr:null,error:null}));
  client.on('ready',async()=>{update({status:'conectado',qr:null,error:null});
   try{const chats=await client.getChats();for(const c of chats.filter(c=>!c.isGroup).slice(0,75)){conversations.set(c.id._serialized,{id:c.id._serialized,name:c.name||c.id.user,messages:[],timestamp:c.timestamp||0});}update({});}catch(e){console.error(e);}
  });
  client.on('message',storeMessage);client.on('message_create',storeMessage);
  client.on('disconnected',reason=>update({status:'desconectado',qr:null,error:String(reason)}));
  client.on('auth_failure',msg=>update({status:'erro',error:'Falha de autenticação: '+msg,qr:null}));
  await client.initialize();
 }catch(e){update({status:'erro',error:e.message,qr:null})}
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
ipcMain.handle('wa-send',async(e,info)=>{
 if(!safeSender(e))throw new Error('Janela não autorizada');
 if(state.status!=='conectado')throw new Error('Conecte o WhatsApp primeiro');
 const chatId=String(info?.chatId||'');const text=String(info?.text||'').trim();
 if(!/^\d+@c\.us$/.test(chatId)||!text||text.length>10000)throw new Error('Conversa ou mensagem inválida');
 const options={};
 if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
 const sent=await client.sendMessage(chatId,text,options);storeMessage(sent);return true;
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{try{pythonProcess?.kill()}catch{}});
