'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateMedia,mediaLabel,MAX_MEDIA}=require('./media_messages');
function registerMediaHandlers({ipcMain,dialog,getWindow,safeSender,getClient,getState,getMessage,storeMessage}){
 const selections=new Map(),downloads=new Map();
 function connected(e){if(!safeSender(e))throw Error('Janela não autorizada');if(getState().status!=='conectado')throw Error('Conecte o WhatsApp primeiro.');}
 function target(chatId){const id=String(chatId||'');if(!getState().conversations.some(c=>c.id===id))throw Error('Selecione uma conversa aberta.');return id;}
 const fileKinds={image:{title:'Selecionar foto',extensions:['jpg','jpeg','png','webp']},audio:{title:'Selecionar áudio',extensions:['mp3','ogg','m4a','wav','webm','aac']},sticker:{title:'Selecionar figurinha',extensions:['webp','png','jpg','jpeg']}};
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
   if(info?.kind!=='voice')throw Error('Selecione um anexo antes de enviar.');
   kind='voice';media=validateMedia(info.media,'audio');if(media.bytes>8*1024*1024||!/^audio\/(webm|ogg)$/.test(media.mimetype))throw Error('Gravação inválida ou acima de 8 MB.');
  }
  const caption=String(info?.caption||'').trim();if(caption.length>10000)throw Error('Legenda muito longa.');
  const options={sendMediaAsSticker:kind==='sticker',sendAudioAsVoice:kind==='voice'};
  if(kind==='image'&&caption)options.caption=caption;if(info?.quotedId)options.quotedMessageId=String(info.quotedId);
  const sent=await getClient().sendMessage(chatId,new MessageMedia(media.mimetype,media.data,media.filename||null),options);
  if(!sent)throw Error('O WhatsApp não confirmou o envio.');storeMessage(sent);
  if(selection)selections.delete(String(info.selectionId));return {ok:true};
 });
 ipcMain.handle('wa-message-media',async(e,info)=>{
  connected(e);const chatId=target(info?.chatId),id=String(info?.messageId||'');
  const chat=getState().conversations.find(c=>c.id===chatId),entry=chat.messages.find(m=>m.id===id&&m.hasMedia);
  if(!entry||!['image','sticker','audio','ptt'].includes(entry.type))throw Error('Anexo indisponível nesta conversa.');
  if(downloads.has(id))return downloads.get(id);if(downloads.size>=3)throw Error('Aguarde os anexos em carregamento.');
  const job=(async()=>{
   const message=getMessage(id)||await getClient().getMessageById(id);
   const downloaded=await message?.downloadMedia();if(!downloaded)throw Error('O WhatsApp não disponibilizou este anexo. Tente novamente.');
   const media=validateMedia(downloaded,['audio','ptt'].includes(entry.type)?'audio':'image');
   return {mimetype:media.mimetype,data:media.data,filename:media.filename};
  })();downloads.set(id,job);try{return await job;}finally{downloads.delete(id);}
 });
}
module.exports={registerMediaHandlers};
