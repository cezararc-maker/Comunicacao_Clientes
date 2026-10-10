'use strict';
const {normalizeMessage}=require('./whatsapp_compat');
function registerBatchHandlers({ipcMain,safeSender,getClient,getState,getMessage,omitMessages,changeChat}){
 let busy=false;
 function chat(id){const item=getState().conversations.find(c=>c.id===id);if(!item)throw Error('Conversa indisponível.');return item;}
 ipcMain.handle('wa-chat-action',async(e,info)=>{if(!safeSender(e))throw Error('Janela não autorizada.');const current=chat(info?.chatId);if(!['pin','unread'].includes(info?.action))throw Error('Ação inválida.');return changeChat(current,info.action,!!info.value);});
 ipcMain.handle('wa-batch-messages',async(e,info)=>{
  if(!safeSender(e))throw Error('Janela não autorizada.');if(busy)throw Error('Aguarde a operação anterior.');if(getState().status!=='conectado')throw Error('Conecte o WhatsApp primeiro.');
  const source=chat(info?.chatId),ids=info?.messageIds;if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!source.messages.some(m=>m.id===id)))throw Error('Selecione até 50 mensagens desta conversa.');
  if(!['forward','delete'].includes(info.action))throw Error('Ação inválida.');if(info.action==='forward'){chat(info.targetChatId);if(info.targetChatId===source.id)throw Error('Escolha outra conversa para encaminhar.');}
  const ordered=source.messages.filter(m=>ids.includes(m.id)).sort((a,b)=>a.timestamp-b.timestamp),completed=[],failed=[];busy=true;
  try{for(const entry of ordered){try{const message=getMessage(entry.id)||await getClient().getMessageById(entry.id);if(!message)throw Error('Mensagem não disponível no WhatsApp.');normalizeMessage(message);if(info.action==='forward')await message.forward(info.targetChatId);else{await message.delete(false,false);await omitMessages(source,entry.id);}completed.push(entry.id);}catch(error){failed.push({id:entry.id,error:error.message});}}return {completed,failed};}finally{busy=false;}
 });
}
module.exports={registerBatchHandlers};
