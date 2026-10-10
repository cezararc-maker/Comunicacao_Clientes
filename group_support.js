'use strict';
const {serializedId,getScopedChat}=require('./whatsapp_compat');
const TEST_GROUP='Teste app';
async function findTestGroup(client){
 if(!client.pupPage)return null;
 const ids=await client.pupPage.evaluate(name=>window.require('WAWebCollections').Chat.getModelsArray().filter(c=>c.id?.server==='g.us'&&(c.formattedTitle||c.name||'')===name).map(c=>c.id._serialized||String(c.id)),TEST_GROUP);
 if(ids.length>1)throw Error('Existe mais de um grupo chamado Teste app. Renomeie os grupos para selecionar apenas um.');
 return ids[0]?getScopedChat(client,ids[0]):null;
}
function registerGroupHandlers({ipcMain,safeSender,getClient,getState}){
 async function group(event,id){if(!safeSender(event))throw Error('Janela não autorizada');if(getState().status!=='conectado')throw Error('Conecte o WhatsApp primeiro.');if(!getState().conversations.some(c=>c.id===id&&c.isGroup&&c.name===TEST_GROUP))throw Error('Selecione o grupo de teste autorizado.');return getScopedChat(getClient(),id);}
 async function info(chat){const client=getClient(),myIds=new Set([serializedId(client.info?.wid),serializedId(client.info?.lid)]);if(client.info?.wid&&client.getContactLidAndPhone)try{for(const pair of await client.getContactLidAndPhone([serializedId(client.info.wid)])){myIds.add(pair.lid);myIds.add(pair.pn);}}catch{}
 const members=[];for(const p of chat.participants||chat.groupMetadata?.participants||[]){const id=serializedId(p.id);let name=id.split('@')[0];try{const contact=await client.getContactById(id);name=contact.name||contact.pushname||name;}catch{}members.push({id,name,isAdmin:!!(p.isAdmin||p.isSuperAdmin),isOwner:!!p.isSuperAdmin,isMe:myIds.has(id)});}
 const canManage=members.some(p=>p.isMe&&p.isAdmin);return {id:serializedId(chat.id),name:chat.name,description:chat.description||chat.groupMetadata?.desc||'',members,canManage,canEditDescription:canManage||(members.some(p=>p.isMe)&&chat.groupMetadata?.restrict===false)};
 }
 ipcMain.handle('wa-group-info',async(e,id)=>info(await group(e,String(id))));
 ipcMain.handle('wa-group-change',async(e,request)=>{const chat=await group(e,String(request?.id));const current=await info(chat);const action=request.action;if(action==='description'?!current.canEditDescription:!current.canManage)throw Error('Você não tem permissão para esta alteração no grupo.');let result;
 if(action==='description'){const description=String(request.description||'');if(description.length>2048)throw Error('Descrição muito longa.');result=await chat.setDescription(description);if(result===false)throw Error('O WhatsApp não confirmou a alteração.');}
 else if(action==='add'){const phone=String(request.phone||'').replace(/\D/g,'');if(!/^\d{10,15}$/.test(phone))throw Error('Informe telefone com DDI e DDD.');const number=await getClient().getNumberId(phone);if(!number)throw Error('Telefone não encontrado no WhatsApp.');result=await chat.addParticipants([serializedId(number)],{autoSendInviteV4:false});if(typeof result==='string'||Object.values(result||{}).some(r=>Number(r.code)!==200&&Number(r.code)!==409))throw Error('O participante não pôde ser adicionado. Verifique a privacidade e o telefone.');}
 else if(['promote','demote','remove'].includes(action)){const member=current.members.find(m=>m.id===request.memberId);if(!member||member.isOwner||member.isMe)throw Error('Selecione outro membro que não seja o proprietário.');result=await chat[action==='promote'?'promoteParticipants':action==='demote'?'demoteParticipants':'removeParticipants']([member.id]);if(result?.status&&Number(result.status)!==200)throw Error('O WhatsApp não confirmou a alteração do membro.');}
 else throw Error('Ação inválida');return info(await getScopedChat(getClient(),current.id));
 });
}
module.exports={TEST_GROUP,findTestGroup,registerGroupHandlers};
