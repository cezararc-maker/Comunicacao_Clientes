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
  if(row.aviso_id>previous&&row.notificar!==false){attendanceTriageSeen.set(key,row.aviso_id);showInternalNotification(row.nome+' · Mensagem aguardando identificação da empresa',{action:()=>attendanceClassify(row)});}
  const card=mgButton('',()=>attendanceClassify(row));card.className='item attendance-triage-card';card.dataset.triage=key;
  const name=document.createElement('b');name.textContent=row.nome;
  const count=document.createElement('span');count.className='unread-badge';count.textContent=row.mensagens;count.setAttribute('aria-label',row.mensagens+' mensagens aguardando identificação');
  const state=document.createElement('small');state.textContent='Identificar empresa / departamento';
  const excerpt=document.createElement('span');excerpt.textContent=row.previa||'Nova mensagem';excerpt.className='chat-preview-text';
  card.append(name,count,state,excerpt);area.append(card);
 }
 const keys=new Set(rows.map(r=>r.conexao_id+':'+r.conversa_id));for(const key of attendanceTriageSeen.keys())if(!keys.has(key))attendanceTriageSeen.delete(key);
}
async function attendanceClassify(row){
 try{
  if(!management.context)return;
  tab('whatsapp');const dialog=mgDialog('Identificar empresa do atendimento','attendance-classify'),form=document.createElement('form');form.className='management-form';
  const note=document.createElement('p');note.textContent=row.nome+' / '+row.telefone+' · '+row.mensagens+' mensagem(ns). A mensagem será encaminhada ao responsável da empresa no departamento escolhido.';form.append(note);
  const company=mgSelect(form,'Empresa do atendimento',management.context.empresas.filter(c=>!row.empresas.length||row.empresas.includes(c.id)));
  const dep=mgSelect(form,'Departamento de destino',management.context.departamentos.filter(d=>d.ativo&&d.conexao_id===row.conexao_id));
  mgSubmit(form,'Identificar e iniciar atendimento',async()=>{const result=await mgApi('/triagem/classificar','POST',{conexao_id:row.conexao_id,conversa_id:row.conversa_id,empresa_id:Number(company.value),departamento_id:Number(dep.value)});dialog.close();await flowRefreshNotices();await attendanceRefresh();attendanceTriageNotices();if(management.context.usuario.perfil==='admin'||management.context.usuario.departamento_id===Number(dep.value))await mgDetails(result.id);else aviso('Atendimento encaminhado ao responsável.',true);});dialog.append(form);dialog.showModal();
 }catch(e){aviso(e.message);}
}
const attendanceTriageArea=document.createElement('div');attendanceTriageArea.id='attendance-triage';$('wachats').before(attendanceTriageArea);
const attendanceTriageBaseNotices=attendanceNotices;
attendanceNotices=function(){attendanceTriageBaseNotices();attendanceTriageNotices();};
const attendanceTriageBaseTarget=flowOpenTarget;
flowOpenTarget=async function(target){if(!target.triage)return attendanceTriageBaseTarget(target);try{await flowRefreshNotices();const row=(flowState.notices.triagem||[]).find(r=>r.conexao_id===target.triage.conexao_id&&r.conversa_id===target.triage.conversa_id);if(row)await attendanceClassify(row);else{tab('whatsapp');await attendanceRefresh();}}catch(e){aviso(e.message);}};
window.desktopApi?.onManagementOpenMessage?.(target=>{if(target.triage)flowOpenTarget(target);});

const attendanceTriageBaseRender=renderWA;renderWA=function(){attendanceTriageBaseRender();if(!management.context||attendanceTriageUser!==management.context.usuario.id)attendanceTriageArea.replaceChildren();};
