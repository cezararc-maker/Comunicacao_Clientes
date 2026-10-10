'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateMedia,mediaLabel,MAX_MEDIA}=require('./media_messages');
const {downloadMediaCompat,normalizeMessage,serializedId}=require('./whatsapp_compat');
function registerMediaHandlers({ipcMain,dialog,getWindow,safeSender,getClient,getState,getMessage,storeMessage,readMedia=async()=>null,saveMedia=async()=>{}}){
 const selections=new Map(),downloads=new Map();
 function connected(e){if(!safeSender(e))throw Error('Janela não autorizada');if(getState().status!=='conectado')throw Error('Conecte o WhatsApp primeiro.');}
 function target(chatId){const id=String(chatId||'');if(!getState().conversations.some(c=>c.id===id))throw Error('Selecione uma conversa aberta.');return id;}
 const fileKinds={image:{title:'Selecionar foto',extensions:['jpg','jpeg','png','webp']},video:{title:'Selecionar vídeo',extensions:['mp4','webm']},document:{title:'Selecionar arquivo ou documento',extensions:['*']},audio:{title:'Selecionar áudio',extensions:['mp3','ogg','m4a','wav','webm','aac']},sticker:{title:'Selecionar figurinha',extensions:['webp','png','jpg','jpeg']}};
 ipcMain.handle('wa-select-media',async(e,info)=>{
  connected(e);const kind=String(info?.kind||'');if(!fileKinds[kind])throw Error('Tipo de anexo inválido.');
  const selected=await dialog.showOpenDialog(getWindow(),{title:fileKinds[kind].title,properties:['openFile'],filters:[{name:mediaLabel(kind),extensions:fileKinds[kind].extensions}]});
  if(selected.canceled)return {canceled:true};if(selected.filePaths.length!==1)throw Error('Selecione um arquivo.');
  const file=selected.filePaths[0],stat=fs.statSync(file);if(!stat.isFile()||stat.size>MAX_MEDIA)throw Error('Selecione um arquivo de até 16 MB.');
  const {MessageMedia}=require('whatsapp-web.js');const media=validateMedia(MessageMedia.fromFilePath(file),kind);
  const selectionId=crypto.randomBytes(24).toString('hex');
  for(const [key,value] of selections)if(Date.now()-value.created>15*60*1000)selections.delete(key);
  if(selections.size>=3)selections.delete(selections.keys().next().value);
  selections.set(selectionId,{file,kind,created:Date.now()});
  return {selectionId,kind,name:path.basename(file),mimetype:media.mimetype,preview:'data:'+media.mimetype+';base64,'+media.data};
 });
 ipcMain.handle('wa-discard-media',e=>{if(!safeSender(e))throw Error('Janela não autorizada');selections.clear();return true;});
 ipcMain.handle('wa-send-media',async(e,info)=>{
  connected(e);const chatId=target(info?.chatId);let media,kind,selection;
  const {MessageMedia}=require('whatsapp-web.js');
  if(info?.selectionId){selection=selections.get(String(info.selectionId));if(!selection||Date.now()-selection.created>15*60*1000)throw Error('Selecione o arquivo novamente.');
   const stat=fs.statSync(selection.file);if(!stat.isFile()||stat.size>MAX_MEDIA)throw Error('O arquivo mudou. Selecione novamente.');
   kind=selection.kind;media=validateMedia(MessageMedia.fromFilePath(selection.file),kind);
  }else{
   if(!['voice','clipboard'].includes(info?.kind))throw Error('Selecione um anexo antes de enviar.');
   kind=info.kind;media=validateMedia(info.media,kind==='voice'?'audio':'image');if(kind==='voice'&&(media.bytes>8*1024*1024||!/^audio\/(webm|ogg)$/.test(media.mimetype)))throw Error('Gravação inválida ou acima de 8 MB.');
  }
  const caption=String(info?.caption||'').trim();if(caption.length>10000)throw Error('Legenda muito longa.');
  const options={sendMediaAsSticker:kind==='sticker',sendAudioAsVoice:kind==='voice',sendMediaAsDocument:kind==='document'};
  if(['image','video','clipboard'].includes(kind)&&caption)options.caption=caption;if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
  const sent=await getClient().sendMessage(chatId,new MessageMedia(media.mimetype,media.data,media.filename||null),options);
  if(!sent)throw Error('O WhatsApp não confirmou o envio.');storeMessage(sent,false,info?.quotedId);
  const sentId=serializedId(sent.id);
  // Stickers are converted by WhatsApp; cache their resulting WebP on download.
  if(sentId&&kind!=='sticker')await saveMedia(sentId,{mimetype:media.mimetype,data:media.data,filename:media.filename}).catch(error=>console.error('Cache do anexo enviado:',error.message));
  if(selection)selections.delete(String(info.selectionId));return {ok:true};
 });
 ipcMain.handle('wa-message-media',async(e,info)=>{
  if(!safeSender(e))throw Error('Janela não autorizada');const chatId=target(info?.chatId),id=String(info?.messageId||'');
  const chat=getState().conversations.find(c=>c.id===chatId),entry=chat.messages.find(m=>m.id===id&&m.hasMedia);
  if(!entry||!['image','sticker','audio','ptt','video','document'].includes(entry.type))throw Error('Anexo indisponível nesta conversa.');
  if(downloads.has(id))return downloads.get(id);if(downloads.size>=3)throw Error('Aguarde os anexos em carregamento.');
  const job=(async()=>{
   const cached=await readMedia(id);if(cached)return cached;
   connected(e);
   const message=getMessage(id)||await getClient().getMessageById(id);
   normalizeMessage(message);
   const downloaded=await downloadMediaCompat(getClient(),message,id);if(!downloaded)throw Error('O WhatsApp não disponibilizou este anexo. Tente novamente.');
   const media=validateMedia(downloaded,['audio','ptt'].includes(entry.type)?'audio':entry.type==='sticker'?'image':entry.type);
   const result={mimetype:media.mimetype,data:media.data,filename:media.filename};await saveMedia(id,result);return result;
  })();downloads.set(id,job);try{return await job;}finally{downloads.delete(id);}
 });
}
module.exports={registerMediaHandlers};
