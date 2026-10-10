'use strict';
let mediaDraft=null,mediaSending=false,voiceRecorder=null,voiceStream=null,voiceChunks=[],voiceTimer=null,voiceStarted=0,voiceChat=null,voiceCanceled=false,voiceGeneration=0,voicePending=false;
const mediaRetries=new Map();const autoMedia=new Set();const mediaJobs=[];let activeMediaJobs=0;function scheduleMedia(node,message,chatId){if(autoMedia.has(message.id))return;autoMedia.add(message.id);mediaJobs.push({node,message,chatId});drainMedia();}function drainMedia(){while(activeMediaJobs<2&&mediaJobs.length){const job=mediaJobs.shift();if(!job.node.isConnected){autoMedia.delete(job.message.id);continue;}activeMediaJobs++;loadMessageMedia(job.node,job.message,job.chatId,true).finally(()=>{activeMediaJobs--;drainMedia();renderWA();});}}
const mediaNames=new Map();const mediaViews=new Map();let mediaViewBytes=0;
const outgoingQueue=new Map();
function toggleAttachments(){$('attachment-panel').classList.toggle('hidden');$('sticker-panel').classList.add('hidden');}
function toggleStickers(){$('sticker-panel').classList.toggle('hidden');$('attachment-panel').classList.add('hidden');}
function updateComposer(){const hasText=!!$('wamessage').value.trim();$('record-audio').classList.toggle('hidden',hasText);$('send-text').classList.toggle('hidden',!hasText);}
function companyHtml(chat){const phone=chat.phone||chat.id?.split('@')[0];const contact=contatos.find(c=>contactPhone(c)===phone);return (contact?.empresas||[]).map(e=>{const label=[e.codigo,e.nome,e.funcao].filter(Boolean).join(' · ');return '<div class="chat-company" title="'+escapeHtml(label)+'">'+escapeHtml(label)+'</div>';}).join('');}
function queueOutgoing(chatId,message){const id='pending-'+crypto.randomUUID();outgoingQueue.set(id,{...message,id,chatId,timestamp:Date.now()/1000,fromMe:true,pending:true,ack:0});renderWA();return id;}
function finishOutgoing(id,error){const m=outgoingQueue.get(id);if(error&&m){m.pending=false;m.ack=-1;}else outgoingQueue.delete(id);renderWA();}
function receiptHtml(message){if(!message.fromMe)return '';const ack=Number(message.ack||0);if(message.pending||ack===0)return '<span class="receipt clock" title="Processando envio" aria-label="Processando envio">◷</span>';if(ack<0)return '<span class="receipt failed" title="Falha no envio" aria-label="Falha no envio">!</span>';return '<span class="receipt '+(ack>=3?'read':'')+'" title="'+(ack>=3?'Lida':ack===2?'Entregue':'Enviada')+'" aria-label="'+(ack>=3?'Lida':ack===2?'Entregue':'Enviada')+'">'+(ack>=2?'✓✓':'✓')+'</span>';}
const emojis=['😀','😊','😂','😍','🥰','😎','🤔','😢','🙏','👍','👎','👏','💪','👌','✅','❌','❤️','💚','🎉','🎂','☕','📎','📄','📅','📞','💬','👋','🤝','🙌','✨','😊','😉'];
function toggleEmojis(){const panel=$('emoji-panel');panel.classList.toggle('hidden');if(!panel.dataset.ready){panel.replaceChildren(...emojis.map(emoji=>{const b=document.createElement('button');b.type='button';b.textContent=emoji;b.setAttribute('aria-label','Inserir '+emoji);b.onclick=()=>{const input=$('wamessage'),start=input.selectionStart,end=input.selectionEnd;input.setRangeText(emoji,start,end,'end');input.focus();updateComposer();};return b}));panel.dataset.ready='1';}}
function cachedMedia(id,media){
 mediaNames.set(id,media.filename||'arquivo');const uri='data:'+media.mimetype+';base64,'+media.data;
 if(mediaViews.has(id)){mediaViewBytes-=mediaViews.get(id).length;mediaViews.delete(id);}
 while(mediaViewBytes+uri.length>40*1024*1024&&mediaViews.size){const key=mediaViews.keys().next().value;mediaViewBytes-=mediaViews.get(key).length;mediaViews.delete(key);}
 mediaViews.set(id,uri);mediaViewBytes+=uri.length;return uri;
}
function showMedia(node,message,uri){
 const box=node.querySelector('.message-attachment');if(!box||!node.isConnected)return;
 const oldHeight=$('wamessages').scrollHeight,wasBottom=$('wamessages').scrollHeight-$('wamessages').scrollTop-$('wamessages').clientHeight<90;
 box.replaceChildren();
 if(message.type==='document'){if(uri.startsWith('data:application/pdf')){const open=document.createElement('button');open.textContent='Abrir PDF';open.onclick=()=>{const frame=document.createElement('iframe');frame.src=uri;frame.title=message.filename||'Documento PDF';$('file-preview').replaceChildren(frame);$('file-dialog').showModal();};box.append(open);}const link=document.createElement('a');link.href=uri;link.download=message.filename||'arquivo';link.textContent='Baixar '+(message.filename||'arquivo');box.append(link);}
 else if(message.type==='video'){const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=uri;box.append(video);}
 else if(['audio','ptt'].includes(message.type)){const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=uri;audio.setAttribute('aria-label',message.mediaLabel||'Áudio');box.append(audio);}
 else {const img=document.createElement('img');img.src=uri;img.alt=message.type==='sticker'?'Figurinha recebida':'Foto na conversa';img.className=message.type==='sticker'?'message-sticker':'message-photo';img.onload=()=>{if((wasBottom||$('wamessages').dataset.followBottom==='1')&&$('wamessages').dataset.conversation===waChat)$('wamessages').scrollTop=$('wamessages').scrollHeight;};img.onerror=()=>{box.textContent='Não foi possível exibir esta imagem.';};img.onclick=()=>{if(message.type==='sticker')return;$('photo-full').src=uri;$('photo-dialog').showModal();};box.append(img);}
 if(wasBottom&&$('wamessages').scrollHeight!==oldHeight)$('wamessages').scrollTop=$('wamessages').scrollHeight;
}
async function loadMessageMedia(node,message,chatId,automatic=false){
 const button=node.querySelector('.load-media');if(!button||button.disabled)return;button.disabled=true;button.textContent='Carregando…';
 try{const media=await window.desktopApi.messageMedia({chatId,messageId:message.id});
  if((message.type!=='document'&&!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|audio\/(ogg|mpeg|mp4|wav|x-wav|webm|aac|opus))$/.test(media.mimetype))||!media.data)throw Error('Formato não suportado.');message.filename=media.filename;
  showMedia(node,message,cachedMedia(message.id,media));
 }catch(error){button.disabled=false;button.textContent='Tentar carregar novamente';button.title=error.message;const attempt=mediaRetries.get(message.id)||0;if(automatic&&waState.status==='conectado'&&attempt<2){mediaRetries.set(message.id,attempt+1);setTimeout(()=>{if(node.isConnected){autoMedia.delete(message.id);scheduleMedia(node,message,chatId);}},2000);}else button.classList.remove('hidden');if(!automatic)aviso(error.message);}
}
function renderMessages(chat){
 if(waState.status!=='conectado'&&(voiceStream||voicePending))stopVoice(true);
 const area=$('wamessages'),changed=area.dataset.conversation!==(chat?.id||'');
 const atBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90;
 if(!chat){if(area.dataset.conversation!==''){area.innerHTML=welcomeHtml();area.dataset.conversation='';}return;}
 if(changed){area.replaceChildren();area.dataset.conversation=chat.id;}
 if(changed||atBottom)area.dataset.followBottom='1';
 const messages=[...(chat.messages||[]),...[...outgoingQueue.values()].filter(m=>m.chatId===chat.id)].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));
 const keep=new Set(messages.map(m=>String(m.id)));for(const node of [...area.children])if(!keep.has(node.dataset.id))node.remove();
 const existing=new Map([...area.children].map(node=>[node.dataset.id,node]));
 let added=false;
 messages.forEach((m,index)=>{
  let node=existing.get(String(m.id));const signature=JSON.stringify([m.body,m.type,m.hasMedia,m.fromMe,m.timestamp]);
  if(!node){node=document.createElement('div');node.dataset.id=String(m.id);added=true;}
  node.dataset.msg=String(index);
  if(node.dataset.signature!==signature){
   node.dataset.signature=signature;node.className='item'+(m.fromMe?' outgoing':'')+(m.type==='sticker'?' sticker-message':'');node.replaceChildren();
   if(m.hasMedia){const box=document.createElement('div');box.className='message-attachment';
    if(['image','sticker','audio','ptt','video','document'].includes(m.type)&&!m.pending&&m.ack!==-1){const b=document.createElement('button');b.className='load-media secondary hidden';b.textContent='Carregar '+(m.mediaLabel||'anexo').toLocaleLowerCase('pt-BR');b.onclick=()=>loadMessageMedia(node,m,chat.id);box.append(b);const error=document.createElement('small');error.className='media-error';error.textContent='Carregando '+(m.mediaLabel||'anexo').toLocaleLowerCase('pt-BR')+'…';box.append(error);}
    else box.textContent=m.mediaLabel||'Anexo';node.append(box);
   }
   if(m.body){const body=document.createElement('div');body.className='message-body';body.textContent=m.body;node.append(body);}
   const time=document.createElement('small');time.className='message-time';time.textContent=Number.isFinite(m.timestamp)?new Date(m.timestamp*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';node.append(time);
   node.ondblclick=e=>{if(e.target.closest('button,audio'))return;quoted=m.id;$('wareply').textContent='Respondendo: '+(m.body||m.mediaLabel||'Mensagem').slice(0,100);$('cancelreply').classList.remove('hidden');$('wamessage').focus();};
  }
  const timeNode=node.querySelector('.message-time');if(timeNode){let receipt=timeNode.querySelector('.receipt');if(receipt)receipt.remove();timeNode.insertAdjacentHTML('beforeend',receiptHtml(m));}
  if(area.children[index]!==node)area.insertBefore(node,area.children[index]||null);
  const cached=mediaViews.get(m.id);if(cached&&node.querySelector('.load-media'))showMedia(node,{...m,filename:mediaNames.get(m.id)||m.filename},cached);else if(m.hasMedia&&!m.pending&&m.ack!==-1&&node.querySelector('.load-media'))scheduleMedia(node,m,chat.id);
 });
 if(changed||(added&&atBottom))area.scrollTop=area.scrollHeight;
 if(atBottom||changed)$('new-messages').classList.add('hidden');else if(added)$('new-messages').classList.remove('hidden');
 document.querySelectorAll('[data-media-action]').forEach(b=>b.disabled=waState.status!=='conectado'||mediaSending);updateComposer();
}
function newestMessages(){const area=$('wamessages');area.dataset.followBottom='1';area.scrollTop=area.scrollHeight;$('new-messages').classList.add('hidden');}
function releaseDraft(){if(mediaDraft?.preview?.startsWith('blob:'))URL.revokeObjectURL(mediaDraft.preview);mediaDraft=null;$('media-preview').replaceChildren();}
function closeMedia(){if($('media-dialog').open)$('media-dialog').close();releaseDraft();if(!mediaSending)window.desktopApi?.discardMedia?.().catch(()=>{});}
function presentMedia(draft){
 mediaDraft=draft;$('media-title').textContent=({clipboard:'Enviar imagem colada',image:'Enviar foto',video:'Enviar vídeo',document:'Enviar arquivo',audio:'Enviar áudio',sticker:'Enviar figurinha',voice:'Enviar mensagem de voz'}[draft.kind]);
 $('media-recipient').textContent='Para: '+((waState.conversations||[]).find(c=>c.id===draft.chatId)?.name||draft.chatId);
 $('media-filename').textContent=draft.name||'Gravação de voz';$('media-caption').value='';$('media-caption').classList.toggle('hidden',!['image','video','clipboard'].includes(draft.kind));
 const content=document.createElement(draft.kind==='document'?'p':draft.kind==='video'?'video':['audio','voice'].includes(draft.kind)?'audio':'img');if(draft.kind==='document')content.textContent='Arquivo pronto para enviar: '+draft.name;else content.src=draft.preview;if(['AUDIO','VIDEO'].includes(content.tagName))content.controls=true;else content.alt='Prévia do anexo';$('media-preview').replaceChildren(content);$('media-send').disabled=false;$('media-dialog').showModal();
}
async function chooseMedia(kind){
 if(!window.desktopApi||!waChat){aviso('Escolha uma conversa.');return;}if(mediaSending)return;stopVoice(true);closeMedia();$('attachment-panel').classList.add('hidden');$('sticker-panel').classList.add('hidden');const chatId=waChat;
 try{const selected=await window.desktopApi.selectMedia({kind});if(!selected.canceled&&waChat===chatId)presentMedia({...selected,chatId,quotedId:quoted});else window.desktopApi.discardMedia().catch(()=>{});}catch(error){aviso(error.message);}
}
async function sendPreparedMedia(){
 if(!mediaDraft||mediaSending)return;const draft=mediaDraft;mediaSending=true;$('media-send').disabled=true;const id=queueOutgoing(draft.chatId,{body:$('media-caption').value,type:draft.kind==='voice'?'ptt':draft.kind==='clipboard'?'image':draft.kind,hasMedia:true,mediaLabel:$('media-title').textContent});
 try{await window.desktopApi.sendMedia({chatId:draft.chatId,selectionId:draft.selectionId,kind:draft.kind,media:draft.media,caption:$('media-caption').value,quotedId:draft.quotedId});finishOutgoing(id);closeMedia();cancelReply();}
 catch(error){finishOutgoing(id,error);aviso(error.message);if(mediaDraft)$('media-send').disabled=false;}
 finally{mediaSending=false;renderWA();}
}
function stopVoice(cancel=false){
 if(cancel)voiceGeneration++;
 voiceCanceled=cancel;clearInterval(voiceTimer);voiceTimer=null;if(voiceRecorder&&voiceRecorder.state!=='inactive')voiceRecorder.stop();voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;$('voice-status').classList.add('hidden');$('record-audio').classList.remove('recording');$('record-audio').setAttribute('aria-label','Gravar áudio');$('record-audio').title='Gravar áudio';
}
async function recordVoice(){
 if(voiceRecorder?.state==='recording'){stopVoice();return;}if(!waChat||mediaSending||voicePending)return;voicePending=true;voiceChat=waChat;const quotedId=quoted,chatId=waChat,generation=++voiceGeneration;
 try{
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Gravação indisponível neste computador. Você pode selecionar um arquivo de áudio.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(waChat!==chatId||generation!==voiceGeneration){stream.getTracks().forEach(t=>t.stop());return;}voiceStream=stream;
  const mimetype=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));if(!mimetype)throw Error('Formato de gravação não suportado.');
  voiceChunks=[];voiceCanceled=false;voiceRecorder=new MediaRecorder(stream,{mimeType:mimetype});voiceStarted=Date.now();let size=0;
  voiceRecorder.ondataavailable=e=>{if(generation!==voiceGeneration)return;if(e.data.size){voiceChunks.push(e.data);size+=e.data.size;if(size>8*1024*1024){stopVoice(true);aviso('A gravação ultrapassou 8 MB. Grave um áudio menor.');}}};
  voiceRecorder.onstop=async()=>{if(generation!==voiceGeneration||voiceCanceled||waChat!==chatId)return;const blob=new Blob(voiceChunks,{type:mimetype});voiceChunks=[];if(!blob.size)return;
   const reader=new FileReader();reader.onload=()=>{if(waChat===chatId&&generation===voiceGeneration)presentMedia({kind:'voice',chatId,quotedId,name:'Gravação de voz',preview:URL.createObjectURL(blob),media:{mimetype:mimetype.split(';')[0],data:String(reader.result).split(',')[1],filename:mimetype.startsWith('audio/ogg')?'audio.ogg':'audio.webm'}});};reader.readAsDataURL(blob);
  };
  voiceRecorder.onerror=()=>{if(generation!==voiceGeneration)return;stopVoice(true);aviso('Não foi possível gravar o áudio.');};voiceRecorder.start(1000);$('voice-time').textContent='0:00';$('voice-status').classList.remove('hidden');$('record-audio').classList.add('recording');$('record-audio').title='Parar gravação';$('record-audio').setAttribute('aria-label','Parar gravação');
  voiceTimer=setInterval(()=>{const seconds=Math.floor((Date.now()-voiceStarted)/1000);$('voice-time').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=120)stopVoice();},500);
 }catch(error){stopVoice(true);aviso(error.name==='NotAllowedError'?'O microfone não foi autorizado. Você pode selecionar um arquivo de áudio.':error.message);}finally{voicePending=false;}
}
function closeConversation(){stopVoice(true);closeMedia();$('emoji-panel').classList.add('hidden');$('attachment-panel').classList.add('hidden');$('sticker-panel').classList.add('hidden');document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());$('photo-full').removeAttribute('src');waChat=null;window.desktopApi?.markRead?.(null).catch(()=>{});quoted=null;$('wamessage').value='';renderWA();}
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if($('view-whatsapp').classList.contains('hidden'))return;event.preventDefault();closeConversation();});
document.getElementById('media-dialog').addEventListener('cancel',e=>{e.preventDefault();closeConversation();});
document.getElementById('photo-dialog').addEventListener('cancel',e=>{e.preventDefault();closeConversation();});
document.getElementById('wamessages').addEventListener('scroll',()=>{const area=$('wamessages');if(area.scrollHeight-area.scrollTop-area.clientHeight<90)$('new-messages').classList.add('hidden');});
document.getElementById('wamessages').addEventListener('wheel',event=>{if(event.deltaY<0)$('wamessages').dataset.followBottom='0';},{passive:true});
window.addEventListener('beforeunload',()=>stopVoice(true));

for(const id of ['photo-dialog','file-dialog','media-dialog'])document.getElementById(id).addEventListener('click',event=>{if(event.target!==$(id))return;const r=$(id).getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){if(id==='media-dialog')closeMedia();else $(id).close();}});
document.getElementById('wamessage').addEventListener('paste',async event=>{const item=[...(event.clipboardData?.items||[])].find(i=>i.kind==='file'&&i.type.startsWith('image/'));if(!item||!waChat)return;event.preventDefault();if(mediaSending||mediaDraft)return;const chatId=waChat;if(waState.status!=='conectado'){aviso('Conecte o WhatsApp antes de enviar a imagem.');return;}const file=item.getAsFile();if(!file||file.size>16*1024*1024){aviso('Use uma imagem de até 16 MB.');return;}const reader=new FileReader();reader.onload=()=>{if(waChat!==chatId)return;presentMedia({kind:'clipboard',chatId,quotedId:quoted,name:file.name||'Imagem colada',preview:reader.result,media:{mimetype:file.type,data:String(reader.result).split(',')[1],filename:file.name||'imagem.png'}});};reader.readAsDataURL(file);});
