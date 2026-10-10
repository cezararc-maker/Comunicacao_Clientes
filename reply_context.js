'use strict';
const {serializedId}=require('./whatsapp_compat');
function replyContext(message,messages,quotedId){
 const data=message?._data||{},raw=data.quotedMsg;
 const stanza=quotedId||serializedId(raw?.id)||data.quotedStanzaID||'';
 const original=messages.find(m=>m.id===stanza||(stanza&&m.id.split('_').includes(stanza)));
 if(original)return {id:original.id,body:original.body||original.mediaLabel||'Mensagem',author:original.authorName||(original.fromMe?'Você':'Contato'),type:original.type};
 if(raw)return {id:stanza,body:String(raw.body||raw.caption||({image:'Foto',ptt:'Mensagem de voz',audio:'Áudio',sticker:'Figurinha',document:'Documento'}[raw.type])||'Mensagem').slice(0,1000),author:String(raw.notifyName||data.quotedParticipant?.user||serializedId(data.quotedParticipant)||'Contato'),type:raw.type||'chat'};
 return stanza?{id:stanza,body:'Mensagem original indisponível neste período',author:'Resposta',type:'chat'}:null;
}
module.exports={replyContext};
