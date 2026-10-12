'use strict';
const path=require('node:path');
const {PHONES,SINCE}=require('./sync_scope');
const {normalizeMessage,serializedId,installWebCompatibility,downloadMediaCompat}=require('./whatsapp_compat');
const {validateMedia,mediaLabel}=require('./media_messages');
const {resolvePhoto}=require('./profile_photos');
const {replyContext}=require('./reply_context');
const {createPresenceMonitor}=require('./chat_presence');
const {connectionOptions,connectionError,initializeConnection}=require('./whatsapp_connection');

// One LocalAuth client per connection. Departments never create duplicate clients.
function createDepartmentConnections({token,dataPath,getPrimary,reconnectPrimary,disconnectPrimary,primarySent,fetchApi=fetch,makeClient,qrCode}){
 const clients=new Map(),starting=new Set(),sending=new Set(),messages=new Map(),mediaLoaded=new Set(),photoCache=new Map(),monitors=new Map();
 let timer=null,stopped=false,busy=false,recovered=false;
 async function api(route,data){const r=await fetchApi('http://127.0.0.1:8765/api/gestao/ponte/'+route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Sync-Token':token},body:data===undefined?undefined:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.erro||'Falha na gestão de conexões');return body;}
 async function state(id,estado,patch={}){return api('estado',{conexao_id:id,estado,...patch});}
 function entry(msg){normalizeMessage(msg);return {id:serializedId(msg.id),body:msg.body||'',timestamp:Number(msg.timestamp),fromMe:!!msg.fromMe,type:msg.type||'chat',hasMedia:!!msg.hasMedia,ack:Number(msg.ack||0),mediaLabel:mediaLabel(msg.type),filename:msg._data?.filename||'',authorName:msg._data?.notifyName||'',isGif:!!msg.isGif,vCards:msg.vCards||[],reply:replyContext(msg,[])};}
 async function receive(id,msg,metadata={},force=false){
  if(stopped)return;normalizeMessage(msg);const chat=msg.fromMe?msg.to:msg.from;
  if(!chat||chat==='status@broadcast'||Number(msg.timestamp)<SINCE)return;
  const phone=String(metadata.phone||chat.split('@')[0]).replace(/\D/g,'');
  // Keep the agreed test scope; no new requests for past messages.
  if(!PHONES.includes(phone)&&!metadata.isGroup)return;
  if(!force&&msg.fromMe&&sending.has(id+':'+chat))return;
  const m=entry(msg);if(!m.id)return;
  const photoKey=id+':'+phone,cached=photoCache.get(photoKey);m.contactPhoto=metadata.photo||(cached&&Date.now()-cached.time<300000?cached.photo:null);
  const c=id===1?getPrimary():clients.get(id);
  await api('mensagem',{conexao_id:id,conversa_id:chat,telefone:phone,nome:metadata.name||msg._data?.notifyName||phone,mensagem:m});
  if(!m.contactPhoto&&c&&!makeClient){try{const result=await resolvePhoto(c,[chat,phone+'@c.us']);m.contactPhoto=result.image||null;photoCache.set(photoKey,{photo:m.contactPhoto,time:Date.now()});if(m.contactPhoto)await api('mensagem',{conexao_id:id,conversa_id:chat,telefone:phone,nome:metadata.name||phone,mensagem:m});}catch{}}
  messages.set(id+':'+m.id,msg);if(messages.size>1000)messages.delete(messages.keys().next().value);
  if(msg.hasMedia&&!mediaLoaded.has(id+':'+m.id)){try{const media=await downloadMediaCompat(c,msg,m.id);if(media){await api('midia',{conexao_id:id,mensagem_id:m.id,midia:media});mediaLoaded.add(id+':'+m.id);}}catch(error){console.warn('Arquivo de atendimento:',error.message);}}
 }
 async function connect(id){
  if(id===1){await reconnectPrimary();return;}
  if(starting.has(id)||clients.has(id))return;
  starting.add(id);await state(id,'aguardando');
  try{
   const factory=makeClient||((options)=>{const {Client,LocalAuth}=require('whatsapp-web.js');return new Client({...connectionOptions(),authStrategy:new LocalAuth(options),puppeteer:{headless:true,args:['--no-sandbox','--disable-setuid-sandbox']}});});
   const c=factory({clientId:'departamento-'+id,dataPath:path.join(dataPath,'wa-departamentos')});clients.set(id,c);
   c.on('qr',async qr=>{if(clients.get(id)!==c)return;try{const image=await (qrCode||require('qrcode').toDataURL)(qr,{margin:2,width:320});if(clients.get(id)===c)await state(id,'qr',{qr:image});}catch(e){console.warn(e.message);}});
   c.on('ready',async()=>{if(clients.get(id)!==c)return;try{await installWebCompatibility(c);if(clients.get(id)!==c)return;await state(id,'conectado',{numero:serializedId(c.info?.wid).split('@')[0]});if(c.pupPage){const monitor=createPresenceMonitor({getClient:()=>c,getChats:()=>PHONES.map(p=>p+'@c.us'),onChange:values=>api('presenca',{conexao_id:id,valores:values}).catch(()=>{})});monitors.set(id,monitor);await monitor.start();}}catch(e){if(clients.get(id)===c)await disconnect(id);console.warn(e.message);}});
   c.on('auth_failure',msg=>{if(clients.get(id)===c)state(id,'erro',{erro:String(msg)}).catch(()=>{});});
   c.on('disconnected',()=>{if(clients.get(id)!==c)return;clients.delete(id);monitors.get(id)?.stop().catch(()=>{});monitors.delete(id);state(id,'desconectado').catch(()=>{});});
   const incoming=msg=>{if(clients.get(id)===c)receive(id,msg).catch(e=>console.warn('Atendimento:',e.message));};
   c.on('message',incoming);c.on('message_create',incoming);c.on('message_ack',incoming);
   initializeConnection(c).then(async()=>{if(clients.get(id)!==c)try{await c.destroy()}catch{}}).catch(async error=>{if(clients.get(id)===c){clients.delete(id);await state(id,'erro',{erro:connectionError(error)});try{await c.destroy()}catch{}}}).finally(()=>starting.delete(id));
  }catch(error){clients.delete(id);await state(id,'erro',{erro:error.message});throw error;}
  finally{starting.delete(id);}
 }
 async function disconnect(id){await monitors.get(id)?.stop();monitors.delete(id);if(id===1)await disconnectPrimary();else{const c=clients.get(id);clients.delete(id);if(c)await c.destroy();}await api('presenca',{conexao_id:id,valores:{}});await state(id,'desconectado');}
 async function execute(command){
  const id=command.conexao_id,data=command.dados;
  if(command.tipo==='conectar'){await connect(id);return {};}
  if(command.tipo==='desconectar'){await disconnect(id);return {};}
  const c=id===1?getPrimary():clients.get(id);if(!c)throw Error('Número desconectado. A mensagem não foi enviada.');
  const actual=serializedId(c.info?.wid).split('@')[0];if(actual!==data.numero)throw Error('O número conectado não corresponde ao atendimento.');
  if(!PHONES.includes(data.telefone||data.conversa_id.split('@')[0]))throw Error('Contato fora dos dois números autorizados para testes.');
  let content=data.texto,options={};
  if(data.resposta_id)options.quotedMessageId=String(data.resposta_id);
  if(data.midia){const kind=data.tipo_midia||'document',valid=validateMedia(data.midia,kind==='voice'?'audio':kind);const {MessageMedia}=require('whatsapp-web.js');content=new MessageMedia(valid.mimetype,valid.data,valid.filename);options={...options,caption:data.texto||undefined,sendAudioAsVoice:kind==='voice',sendMediaAsSticker:kind==='sticker',sendVideoAsGif:kind==='gif',sendMediaAsDocument:kind==='document'};}
  const key=id+':'+data.conversa_id;sending.add(key);
  try{
   const sent=await c.sendMessage(data.conversa_id,content,options);if(!sent)throw Error('WhatsApp não confirmou o envio.');normalizeMessage(sent);
   // Persist successful opening before releasing message_create suppression.
   await api('comandos/'+command.id+'/resultado',{ok:true,mensagem:entry(sent),resultado:{}});
   if(id===1)primarySent(sent,false,data.resposta_id);
   await receive(id,sent,{phone:data.telefone||data.conversa_id.split('@')[0],name:data.nome},true);
   return {persisted:true};
  }finally{sending.delete(key);}
 }
 async function tick(){
  if(busy||stopped)return;busy=true;
  try{
   const response=await api('comandos',{recuperar:!recovered});recovered=true;
   if(response.comando){const cmd=response.comando;try{const result=await execute(cmd);if(!result.persisted)await api('comandos/'+cmd.id+'/resultado',{ok:true,resultado:{}});}catch(error){await api('comandos/'+cmd.id+'/resultado',{ok:false,resultado:{erro:error.message}});}}
  }catch(error){console.warn('Gestão:',error.message);}finally{busy=false;}
 }
 return {receive,connect,disconnect,tick,presence:(id,values)=>api('presenca',{conexao_id:id,valores:values}),async start(){stopped=false;const config=await api('configuracao');for(const c of config)if(c.id!==1&&c.habilitada)connect(c.id).catch(e=>console.warn(e.message));timer=setInterval(tick,700);timer.unref?.();await tick();},async stop(){stopped=true;clearInterval(timer);await Promise.allSettled([...monitors.values()].map(m=>m.stop()));await Promise.allSettled([...clients.values()].map(c=>c.destroy()));clients.clear();}};
}
module.exports={createDepartmentConnections};
