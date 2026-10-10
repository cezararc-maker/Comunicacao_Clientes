'use strict';
let notificationNavigationInstalled=false,notificationNavigationSequence=0;
async function openNotificationMessage(target){
 const sequence=++notificationNavigationSequence;
 try{
  if(!target?.chatId||!target.messageId)return;
  const latest=await window.desktopApi.getState();if(sequence!==notificationNavigationSequence)return;
  if(latest)waState=latest;
  const chat=waState.conversations.find(c=>c.id===target.chatId);
  if(!chat?.messages.some(message=>message.id===target.messageId)){aviso('Esta mensagem não está mais disponível no histórico local.');return;}
  if(captureSession)await cancelCapture();if(sequence!==notificationNavigationSequence)return;
  stopVoice(true);closeMedia();closeDetails();endMessageSelection();document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  waChat=chat.id;quoted=null;chat.unreadCount=0;chat.markedUnread=false;tab('whatsapp');renderWA();$('wamessages').dataset.followBottom='0';
  await new Promise(resolve=>requestAnimationFrame(resolve));if(sequence!==notificationNavigationSequence)return;
  const row=[...$('wamessages').children].find(node=>node.dataset.id===target.messageId);
  if(row){row.scrollIntoView({block:'center',behavior:'auto'});row.classList.add('reply-highlight');setTimeout(()=>row.classList.remove('reply-highlight'),1500);updateEndButton();}
 }catch(error){aviso('Não foi possível abrir a mensagem: '+cleanError(error));}
}
function installNotificationNavigation(){
 if(notificationNavigationInstalled||!window.desktopApi)return;notificationNavigationInstalled=true;
 const removeOpen=window.desktopApi.onOpenMessage?.(openNotificationMessage);
 const removeIncoming=window.desktopApi.onIncomingMessage?.(target=>{
  if(waChat===target.chatId&&!$('view-whatsapp').classList.contains('hidden'))return;
  showInternalNotification(target.title+'\n'+(target.text||'Nova mensagem'),{action:()=>openNotificationMessage(target)});
 });
 window.addEventListener('pagehide',()=>{removeOpen?.();removeIncoming?.();},{once:true});
}
