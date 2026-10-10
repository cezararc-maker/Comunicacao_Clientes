'use strict';
// One close control for static and dynamically created application dialogs.
function installDialogClose(dialog){
 if(dialog.querySelector('.dialog-close,.tools-close'))return;
 const close=document.createElement('button');close.type='button';close.className='icon-button dialog-close';close.textContent='×';close.setAttribute('aria-label','Fechar');close.title='Fechar';
 close.onclick=()=>{if(dialog.id==='capture-result')cancelCapture();else if(dialog.id==='media-dialog')closeMedia();else dialog.close();};
 dialog.prepend(close);
 dialog.addEventListener('close',()=>{if(dialog.id==='photo-dialog')$('photo-full').removeAttribute('src');if(dialog.id==='file-dialog')$('file-preview').replaceChildren();});
}
document.querySelectorAll('dialog').forEach(installDialogClose);
const dialogObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('dialog'))installDialogClose(node);node.querySelectorAll('dialog').forEach(installDialogClose);}});
dialogObserver.observe(document.body,{childList:true});
window.addEventListener('pagehide',()=>dialogObserver.disconnect(),{once:true});
