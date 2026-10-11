'use strict';
let captureSession=null;
function toggleConversationMenu(){const menu=$('conversation-menu');menu.classList.toggle('hidden');$('conversation-menu-trigger').setAttribute('aria-expanded',String(!menu.classList.contains('hidden')));}
const captureDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function openCaptureOptions(){if(!waChat)return;$('conversation-menu').classList.add('hidden');$('capture-options').showModal();}
function snapshotElement(source){
 const clone=source.cloneNode(false),style=getComputedStyle(source);
 for(const attribute of [...clone.attributes])if(attribute.name.startsWith('on')||['id','srcset','autoplay','href'].includes(attribute.name))clone.removeAttribute(attribute.name);
 for(const property of style)clone.style.setProperty(property,style.getPropertyValue(property));
 // Physical coordinates must not be overridden by later logical inset shorthands.
 for(const property of ['inset-block','inset-inline','inset-block-start','inset-block-end','inset-inline-start','inset-inline-end'])clone.style.removeProperty(property);
 clone.style.animation='none';clone.style.transition='none';clone.style.caretColor='transparent';
 if(clone.tagName==='IMG'&&!source.src.startsWith('data:'))clone.removeAttribute('src');
 if(['AUDIO','VIDEO','SOURCE'].includes(clone.tagName)){clone.removeAttribute('src');clone.removeAttribute('autoplay');if(source.tagName==='VIDEO'&&source.readyState>=2){try{const canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;canvas.getContext('2d').drawImage(source,0,0);clone.poster=canvas.toDataURL('image/png');}catch{}}}
 for(const child of source.childNodes){if(child.nodeType===Node.TEXT_NODE)clone.append(child.cloneNode());else if(child.nodeType===Node.ELEMENT_NODE&&!child.matches('script,iframe,object,embed,source,.message-menu,.load-media'))clone.append(snapshotElement(child));}
 // Pseudo elements (including bubble tails) need explicit nodes in the isolated copy.
 for(const pseudo of ['::before','::after']){const computed=getComputedStyle(source,pseudo);if(!['none','normal',''].includes(computed.content)){const element=document.createElement('span');for(const property of computed)element.style.setProperty(property,computed.getPropertyValue(property));for(const property of ['inset-block','inset-inline','inset-block-start','inset-block-end','inset-inline-start','inset-inline-end'])element.style.removeProperty(property);element.textContent=computed.content.replace(/^"|"$/g,'');element.style.pointerEvents='none';clone.append(element);}}
 if(source.tagName==='TEXTAREA')clone.textContent=source.value;
 return clone;
}
function captureSnapshot(area){
 const width=area.clientWidth,height=area.scrollHeight,rect=area.getBoundingClientRect(),style=getComputedStyle(area),root=document.createElement('div');
 root.style.cssText=`position:relative;width:${width}px;height:${height}px;overflow:hidden;`;
 for(const property of ['background-color','background-image','background-size','font-family','font-size','color'])root.style.setProperty(property,style.getPropertyValue(property));
 for(const row of area.children){const box=row.getBoundingClientRect(),clone=snapshotElement(row);clone.style.position='absolute';clone.style.top=(box.top-rect.top+area.scrollTop-area.clientTop)+'px';clone.style.left=(box.left-rect.left-area.clientLeft)+'px';clone.style.width=box.width+'px';clone.style.height=box.height+'px';clone.style.margin='0';root.append(clone);}
 const header=document.querySelector('.conversation-header'),footer=document.querySelector('.composer'),headerClone=snapshotElement(header),footerClone=snapshotElement(footer);
 headerClone.style.width=footerClone.style.width=width+'px';headerClone.style.position=footerClone.style.position='relative';headerClone.style.margin=footerClone.style.margin='0';
 return {headerHtml:headerClone.outerHTML,footerHtml:footerClone.outerHTML,headerHeight:header.getBoundingClientRect().height,footerHeight:footer.getBoundingClientRect().height,width,height,scale:window.devicePixelRatio||1,html:'<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; media-src data:; style-src \'unsafe-inline\'; font-src data:"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;overflow:hidden}body{border:0}.message-menu{display:none!important}</style></head><body>'+root.outerHTML+'</body></html>'};
}
async function startCapture(mode){
 if(captureSession||!waChat)return;if(!window.chatApi?.captureBegin){aviso('Captura disponível no aplicativo desktop atualizado.');return;}
 const area=$('wamessages'),chat=(waState.conversations||[]).find(c=>c.id===waChat);if(!chat?.messages.length){aviso('Esta conversa ainda não possui mensagens.');return;}
 const seconds=Number($('capture-idle').value);if(!Number.isFinite(seconds)||seconds<1||seconds>30){aviso('Escolha uma pausa entre 1 e 30 segundos.');return;}
 $('capture-options').close();document.querySelectorAll('.message-menu[open]').forEach(menu=>menu.open=false);hideCompanyBalloon();const original=area.scrollTop,follow=area.dataset.followBottom;
 const anchor=[...area.children].find(row=>row.offsetTop+row.offsetHeight>area.offsetTop+original);const anchorOffset=anchor?anchor.getBoundingClientRect().top-area.getBoundingClientRect().top:0;
 const session={chatId:waChat,mode,original,follow,initialWidth:area.clientWidth,initialHeight:area.clientHeight,seconds,canceled:false,frozen:true,parts:[],advanced:false,processing:false};captureSession=session;area.dataset.followBottom='0';$('capture-toolbar').classList.remove('hidden');$('capture-progress').textContent='Preparando fontes e mídias…';$('capture-finish').disabled=true;
 try{
  await document.fonts.ready;const deadline=Date.now()+20000;let previous=-1,stable=0;
  while(Date.now()<deadline&&stable<3){if(session.canceled)return;await captureDelay(150);const size=area.scrollHeight;stable=size===previous&&activeMediaJobs===0&&mediaJobs.length===0?stable+1:0;previous=size;}
  if(session.canceled)return;const images=[...area.querySelectorAll('img')];await Promise.all(images.map(image=>Promise.race([image.decode().catch(()=>{}),captureDelay(1000)])));
  if(anchor?.isConnected)area.scrollTop+=anchor.getBoundingClientRect().top-area.getBoundingClientRect().top-anchorOffset;else area.scrollTop=original;
  session.initialWidth=area.clientWidth;session.initialHeight=area.clientHeight;session.snapshot=captureSnapshot(area);session.start=area.scrollTop;session.end=Math.min(session.snapshot.height,session.start+area.clientHeight);session.lastAdvance=Date.now();session.maxTop=session.start;
  if(stable<3)session.warning='Algumas mídias não estabilizaram em 20 segundos; a captura usa o conteúdo disponível.';
  const result=await window.chatApi.captureBegin({...session.snapshot,start:session.start,name:chat.name});if(session.canceled){await window.chatApi.captureCancel({id:result.id});return;}session.id=result.id;
  if(mode==='auto'){const maxTop=Math.max(0,session.snapshot.height-area.clientHeight);while(area.scrollTop<maxTop-.5){if(session.canceled)return;if(area.clientWidth!==session.initialWidth||area.clientHeight!==session.initialHeight){session.warning='O tamanho da janela mudou. A captura mantém o tamanho original.';break;}const next=Math.min(maxTop,area.scrollTop+Math.max(1,area.clientHeight*.8));area.scrollTop=next;session.maxTop=next;session.end=Math.min(session.snapshot.height,next+area.clientHeight);$('capture-progress').textContent='Percorrendo a conversa: '+Math.round((session.end-session.start)/Math.max(1,session.snapshot.height-session.start)*100)+'%';await captureDelay(90);}if(session.canceled)return;session.end=session.snapshot.height;await finishCapture();}else{$('capture-finish').disabled=false;$('capture-progress').textContent=`Role a conversa para baixo. Finaliza após ${seconds}s sem avanço.`;session.monitor=setInterval(()=>{if(session.canceled)return;if(area.clientWidth!==session.initialWidth||area.clientHeight!==session.initialHeight){session.warning='O tamanho da janela mudou. A captura foi encerrada com a largura original.';finishCapture();return;}if(session.advanced&&Date.now()-session.lastAdvance>=seconds*1000)finishCapture();},100);}
 }catch(error){if(!session.canceled){aviso('Não foi possível preparar a captura: '+error.message);await cancelCapture();}}
}
function trackCaptureScroll(){const session=captureSession;if(!session||session.mode!=='manual'||!session.id||session.processing)return;const area=$('wamessages');if(area.scrollTop>session.maxTop+.5){session.maxTop=area.scrollTop;session.end=Math.min(session.snapshot.height,session.maxTop+session.initialHeight);session.lastAdvance=Date.now();session.advanced=true;$('capture-progress').textContent=Math.round(session.end-session.start)+' px percorridos · '+session.seconds+'s de pausa para finalizar';}}
async function finishCapture(){
 const session=captureSession;if(!session?.id||session.processing||session.canceled)return;session.processing=true;clearInterval(session.monitor);$('capture-finish').disabled=true;
 try{let index=0,total=1;while(index<total){if(session.canceled)return;$('capture-progress').textContent='Gerando parte '+(index+1)+'…';const part=await window.chatApi.capturePart({id:session.id,end:session.end,index});if(session.canceled)return;session.parts.push(part.data);total=part.total;index++;$('capture-progress').textContent=`Partes prontas: ${index} de ${total}`;}
 }catch(error){session.warning='Captura incompleta: '+error.message;if(!session.parts.length){aviso(session.warning);await cancelCapture();return;}}
 if(session.canceled)return;restoreCapture(session);$('capture-preview').replaceChildren(...session.parts.map((data,index)=>{const image=document.createElement('img');image.src=data;image.alt='Captura da conversa, parte '+(index+1);return image;}));$('capture-result-note').textContent=[session.warning,session.parts.length>1?'O trecho foi dividido em '+session.parts.length+' partes para limitar memória e tamanho da imagem.':'', 'Foto, nome, mensagens e caixa de texto incluídos.'].filter(Boolean).join(' ');$('capture-result').showModal();
}
function restoreCapture(session){session.frozen=false;$('capture-toolbar').classList.add('hidden');const area=$('wamessages');const position=area.scrollTop;renderWA();area.scrollTop=position;area.dataset.followBottom=session.follow;}
async function cancelCapture(){const session=captureSession;if(!session)return;session.canceled=true;clearInterval(session.monitor);captureSession=null;$('capture-toolbar').classList.add('hidden');if($('capture-result').open)$('capture-result').close();$('capture-preview').replaceChildren();if(session.frozen)restoreCapture(session);await window.chatApi?.captureCancel?.({id:session.id}).catch(()=>{});}
async function saveCapture(){if(!captureSession?.id)return;$('capture-save-png').disabled=true;try{const result=await window.chatApi.captureSave({id:captureSession.id,format:'png'});if(!result.canceled)$('capture-result-note').textContent='Captura salva ('+result.saved+' arquivo(s) PNG).';}catch(error){aviso(error.message);}finally{$('capture-save-png').disabled=false;}}
document.getElementById('wamessages').addEventListener('scroll',trackCaptureScroll,{passive:true});
document.getElementById('capture-result').addEventListener('cancel',event=>{event.preventDefault();cancelCapture();});

document.getElementById('capture-result').addEventListener('click',event=>{const dialog=document.getElementById('capture-result');if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)cancelCapture();});
