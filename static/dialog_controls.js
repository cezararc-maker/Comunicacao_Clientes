'use strict';
// One close control for static and dynamically created application dialogs.
function installDialogClose(dialog){
 installDialogBack(dialog);
 if(dialog.querySelector('.dialog-close,.tools-close'))return;
 const close=document.createElement('button');close.type='button';close.className='icon-button dialog-close';close.textContent='×';close.setAttribute('aria-label','Fechar');close.title='Fechar';
 close.onclick=()=>{if(dialog.id==='capture-result')cancelCapture();else if(dialog.id==='media-dialog')closeMedia();else dialog.close();};
 dialog.prepend(close);
 dialog.addEventListener('close',()=>{if(dialog.id==='photo-dialog')$('photo-full').removeAttribute('src');if(dialog.id==='file-dialog')$('file-preview').replaceChildren();});
}
function createBackButton(action,label='Voltar'){
 const button=document.createElement('button');button.type='button';button.className='icon-button navigation-back';button.setAttribute('aria-label',label);button.title=label;
 button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5m7-7-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
 button.onclick=action;return button;
}
function installDialogBack(dialog){
 if(dialog.querySelector(':scope > .navigation-back'))return;
 const back=createBackButton(()=>{
  if(typeof dialog.onNavigateBack==='function'&&dialog.onNavigateBack()!==false)return;
  const close=dialog.querySelector('.dialog-close,.tools-close');if(close)close.click();else dialog.close();
  if(dialog.id==='capture-result'&&waChat)document.getElementById('capture-options')?.showModal();
 });
 dialog.classList.add('has-navigation-back');dialog.prepend(back);
}
document.querySelectorAll('dialog').forEach(installDialogClose);
const dialogObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('dialog'))installDialogClose(node);node.querySelectorAll('dialog').forEach(installDialogClose);}});
dialogObserver.observe(document.body,{childList:true});
window.addEventListener('pagehide',()=>dialogObserver.disconnect(),{once:true});
