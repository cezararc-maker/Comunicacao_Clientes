'use strict';
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
module.exports={getScopedChat};
