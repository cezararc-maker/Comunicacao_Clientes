'use strict';
let attendanceFinishing=false;
async function attendanceComplete(id,companyId){
 if(attendanceFinishing)return;
 attendanceFinishing=true;
 try{await mgApi('/atendimentos/'+id+'/encerrar','POST',companyId?{empresa_id:companyId}:{});closeConversation();await attendanceRefresh();await flowRefreshNotices();}
 finally{attendanceFinishing=false;}
}
mgFinish=async function(id){
 try{
  const data=await mgApi('/atendimentos/'+id),row=data.atendimento;
  if(row.empresa_id){await attendanceComplete(id);return;}
  const context=await mgApi('/contexto');management.context=context;
  const dialog=mgDialog('Vincular empresa e concluir','attendance-finish'),form=document.createElement('form');form.className='management-form';
  const note=document.createElement('p');note.textContent='Selecione a empresa atendida para armazenar a conversa no histórico correto.';form.append(note);
  const contact=contatos.find(c=>contactPhone(c)===data.telefone),links=contact?allCompanyLinks(contact):[];
  const linked=new Set(links.map(c=>c.id));const companies=context.empresas.filter(c=>!linked.size||linked.has(c.id));
  const select=mgSelect(form,'Empresa do atendimento',companies);
  mgSubmit(form,'Vincular e concluir',async()=>{await attendanceComplete(id,Number(select.value));dialog.close();});dialog.append(form);dialog.showModal();
 }catch(e){aviso(e.message);}
};
const attendanceSituationOriginal=flowSituation;
flowSituation=function(row,status){if(status!=='aberto')return attendanceSituationOriginal(row,status);mgApi('/atendimentos/'+row.id+'/situacao','POST',{status,pendencia:'',prazo:''}).then(()=>mgDetails(row.id)).catch(e=>aviso(e.message));};
const attendancePrivateNote=document.createElement('aside');attendancePrivateNote.id='attendance-private-note';attendancePrivateNote.className='attendance-private-note';attendancePrivateNote.hidden=true;attendancePrivateNote.setAttribute('aria-label','Observação interna do atendimento');$('wamessages').before(attendancePrivateNote);
const attendanceStatusRenderOriginal=renderWA;
renderWA=function(){
 attendanceStatusRenderOriginal();attendancePrivateNote.replaceChildren();attendancePrivateNote.hidden=true;
 if(!window.attendanceConversationsEnabled)return;
 const row=attendanceRows.get(waChat);
 if(row&&!row.empresa_id)$('chatcaption').textContent='Empresa a vincular na conclusão / '+row.atual_nome+' · '+row.numero;
 if(row&&management.context?.usuario.id===row.usuario_id&&['pendencia','documentacao'].includes(row.status)&&row.pendencia){
  const label=document.createElement('b');label.textContent=flowLabels[row.status]+' · Informação interna';
  const reason=document.createElement('span');reason.textContent=row.pendencia;
  attendancePrivateNote.className='attendance-private-note '+row.status;attendancePrivateNote.append(label,reason);
  if(row.prazo){const deadline=document.createElement('small');deadline.textContent='Prazo: '+row.prazo.split('-').reverse().join('/');attendancePrivateNote.append(deadline);}
  attendancePrivateNote.hidden=false;
 }
 for(const card of document.querySelectorAll('#wachats [data-chat]')){
  const current=attendanceRows.get(card.dataset.chat);if(!current)continue;
  card.classList.add('attendance-card');card.dataset.attendanceStatus=current.status;
  let status=card.querySelector('.attendance-card-status');if(!status){status=document.createElement('span');status.className='attendance-card-status';card.querySelector('.chat-preview-text').after(status);}
  status.textContent=flowLabels[current.status];status.setAttribute('aria-label','Situação: '+flowLabels[current.status]);
 }
};
