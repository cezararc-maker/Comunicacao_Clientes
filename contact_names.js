'use strict';
function usableName(value){
 const name=String(value||'').trim();
 return name && !/^[+\d\s().-]+$/.test(name) && !/^\d+@(?:c\.us|lid|g\.us)$/.test(name)?name:'';
}
function contactDetails(contact, phone=''){
 const id=contact?.id?._serialized||'';
 const raw=String(contact?.number||'');
 if(/^\+?\d{10,15}$/.test(raw)&&!(id.endsWith('@lid')&&raw===contact.id.user))phone=raw.replace(/^\+/,'');
 else if(/^\d{10,15}@c\.us$/.test(id))phone=id.split('@')[0];
 return {phone,savedName:usableName(contact?.name)||usableName(contact?.shortName),publicName:usableName(contact?.pushname)};
}
async function buildDirectory(client, contacts, chats){
 const directory=new Map(), phoneById=new Map();
 const lids=[...new Set([...contacts,...chats].map(c=>c.id?._serialized).filter(id=>id?.endsWith('@lid')))];
 if(typeof client.getContactLidAndPhone==='function'){
  for(let i=0;i<lids.length;i+=100){
   try{for(const pair of await client.getContactLidAndPhone(lids.slice(i,i+100))){
    if(/^\d{10,15}@c\.us$/.test(pair.pn||'')){phoneById.set(pair.lid,pair.pn.split('@')[0]);phoneById.set(pair.pn,pair.pn.split('@')[0]);}
   }}catch{ /* An unmapped LID must never be imported as a phone number. */ }
  }
 }
 function remember(id, details){
  const aliases=[id,details.phone?details.phone+'@c.us':''].filter(Boolean);
  for(const alias of aliases){const old=directory.get(alias)||{};directory.set(alias,{phone:details.phone||old.phone||'',savedName:details.savedName||old.savedName||'',publicName:details.publicName||old.publicName||''});}
 }
 for(const c of contacts){if(!c.isGroup&&!c.isMe)remember(c.id?._serialized,contactDetails(c,phoneById.get(c.id?._serialized)));}
 for(const c of chats){
  const id=c.id?._serialized;if(!id||c.isGroup)continue;
  const phone=phoneById.get(id)||(/^\d{10,15}@c\.us$/.test(id)?id.split('@')[0]:'');
  const current=directory.get(id)||directory.get(phone+'@c.us');
  if(current?.savedName){remember(id,current);continue;}
  try{const contact=typeof c.getContact==='function'?await c.getContact():await client.getContactById(id);remember(id,contactDetails(contact,phone));}
  catch{remember(id,current||{phone,savedName:'',publicName:''});}
 }
 return directory;
}
function conversationName(chat, details={}, localName='', oldName=''){
 if(chat.isGroup)return usableName(chat.name)||usableName(oldName)||chat.id?.user||chat.id?._serialized||'';
 return details.savedName||usableName(localName)||details.publicName||usableName(chat.name)||usableName(oldName)||details.phone||chat.id?.user||chat.id?._serialized||'';
}
module.exports={usableName,contactDetails,buildDirectory,conversationName};
