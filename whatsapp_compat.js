'use strict';
function serializedId(id){return typeof id==='string'?id:id?._serialized||id?.$1||'';}
function normalizeMessage(message){if(message?.id&&!message.id._serialized){const id=serializedId(message.id);if(id)message.id._serialized=id;}return message;}
async function installWebCompatibility(client){
 if(!client.pupPage)return;
 await client.pupPage.evaluate(()=>{
  const Key=window.require('WAWebMsgKey');
  if(Key?.prototype&&!Object.getOwnPropertyDescriptor(Key.prototype,'_serialized'))Object.defineProperty(Key.prototype,'_serialized',{configurable:true,get(){return this.$1;}});
 });
}
async function downloadMediaCompat(client,message,id){
 normalizeMessage(message);
 try{const media=await message?.downloadMedia();if(media)return media;}catch(error){if(!client.pupPage)throw error;}
 if(!client.pupPage)return null;
 return client.pupPage.evaluate(async msgId=>{
  const collection=window.require('WAWebCollections').Msg;
  const msg=collection.get(msgId)||(await collection.getMessagesById([msgId]))?.messages?.[0];
  if(!msg?.directPath)return null;
  const bytes=await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
   directPath:msg.directPath,encFilehash:msg.encFilehash,filehash:msg.filehash,mediaKey:msg.mediaKey,mediaKeyTimestamp:msg.mediaKeyTimestamp,type:msg.type,mimetype:msg.mimetype,
   signal:AbortSignal.timeout(30000),downloadQpl:{addAnnotations(){return this;},addPoint(){return this;}}
  });
  if(!bytes||bytes.byteLength>16*1024*1024)throw Error('Anexo indisponível ou acima de 16 MB.');
  return {mimetype:msg.mimetype,data:await window.WWebJS.arrayBufferToBase64Async(bytes),filename:msg.filename||''};
 },id);
}
async function getScopedChat(client,id){
 try{return await client.getChatById(id);}catch(originalError){
  if(!client.pupPage)throw originalError;
  // Avoid serializing the whole internal Chat: recent Web builds fail while
  // resolving its lastReceivedKey. Preserve the library's bounded message API.
  const data=await client.pupPage.evaluate(async chatId=>{
   const chat=await window.WWebJS.getChat(chatId,{getAsModel:false});
   if(!chat)return null;
   const messages=chat.msgs?.getModelsArray()||[];
   const newest=messages.reduce((latest,m)=>Math.max(latest,Number(m.t)||0),0);
   return {id:{_serialized:chat.id._serialized,user:chat.id.user},name:chat.formattedTitle||'',isGroup:false,lastMessage:newest?{timestamp:newest}:null};
  },id);
  if(!data)throw originalError;
  return {...data,fetchMessages:options=>{
   const {Chat}=require('whatsapp-web.js');
   return Chat.prototype.fetchMessages.call({client,id:data.id},options);
  }};
 }
}
module.exports={getScopedChat,serializedId,normalizeMessage,installWebCompatibility,downloadMediaCompat};
