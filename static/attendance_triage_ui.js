'use strict';
let attendanceTriageUser=null;
const attendanceTriageSeen=new Map();
function attendanceTriageNotices(){
 const area=$('attendance-triage');area.replaceChildren();
 if(!management.context){attendanceTriageSeen.clear();return;}
 if(attendanceTriageUser!==management.context.usuario.id){attendanceTriageUser=management.context.usuario.id;attendanceTriageSeen.clear();}
 if(flowState.noticeUser!==management.context.usuario.id)return;
 const rows=flowState.notices?.triagem||[];
 for(const row of rows){
  const key=row.conexao_id+':'+row.conversa_id,previous=attendanceTriageSeen.get(key)||0;
  if(row.aviso_id>previous&&row.notificar!==false){attendanceTriageSeen.set(key,row.aviso_id);showInternalNotification(row.nome+' · Nova mensagem — abrir atendimento',{action:()=>attendanceClassify(row)});}
  const card=mgButton('',()=>attendanceClassify(row));card.className='item attendance-triage-card';card.dataset.triage=key;
  const name=document.createElement('b');name.textContent=row.nome;
  const count=document.createElement('span');count.className='unread-badge';count.textContent=row.mensagens;count.setAttribute('aria-label',row.mensagens+' mensagens aguardando identificação');
  const state=document.createElement('small');state.textContent='Abrir atendimento · empresa na conclusão';
  const excerpt=document.createElement('span');excerpt.textContent=row.previa||'Nova mensagem';excerpt.className='chat-preview-text';
  card.append(name,count,state,excerpt);area.append(card);
 }
 const keys=new Set(rows.map(r=>r.conexao_id+':'+r.conversa_id));for(const key of attendanceTriageSeen.keys())if(!keys.has(key))attendanceTriageSeen.delete(key);
}
async function attendanceClassify(row){
 try{const result=await mgApi('/triagem/abrir','POST',{conexao_id:row.conexao_id,conversa_id:row.conversa_id});await flowRefreshNotices();await mgDetails(result.id);attendanceTriageNotices();}catch(e){aviso(e.message);}
}

const attendanceTriageArea=document.createElement('div');attendanceTriageArea.id='attendance-triage';$('wachats').before(attendanceTriageArea);
const attendanceTriageBaseNotices=attendanceNotices;
attendanceNotices=function(){attendanceTriageBaseNotices();attendanceTriageNotices();};
const attendanceTriageBaseTarget=flowOpenTarget;
flowOpenTarget=async function(target){if(!target.triage)return attendanceTriageBaseTarget(target);try{await flowRefreshNotices();const row=(flowState.notices.triagem||[]).find(r=>r.conexao_id===target.triage.conexao_id&&r.conversa_id===target.triage.conversa_id);if(row)await attendanceClassify(row);else{tab('whatsapp');await attendanceRefresh();}}catch(e){aviso(e.message);}};
window.desktopApi?.onManagementOpenMessage?.(target=>{if(target.triage)flowOpenTarget(target);});

const attendanceTriageBaseRender=renderWA;renderWA=function(){attendanceTriageBaseRender();if(!management.context||attendanceTriageUser!==management.context.usuario.id)attendanceTriageArea.replaceChildren();};
