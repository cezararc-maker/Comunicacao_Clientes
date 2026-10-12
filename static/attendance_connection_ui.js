'use strict';
let attendanceSelectedConnection=null,attendanceConnectionUser=null;
function attendanceConnection(context=management.context,chats=waState.conversations){
 if(!context)return null;
 if(attendanceConnectionUser!==context.usuario.id){attendanceConnectionUser=context.usuario.id;attendanceSelectedConnection=null;}
 const current=chats.find(c=>c.id===waChat)?.attendance.conexao_id;
 const department=context.departamentos.find(d=>d.id===context.usuario.departamento_id)?.conexao_id;
 const cid=current||attendanceSelectedConnection||department;
 const rows=context.conexoes.filter(c=>c.id>0);
 return rows.find(c=>c.id===cid)|| (context.usuario.perfil==='admin'?rows.find(c=>c.habilitada)||rows[0]:null);
}
async function attendanceConnectionAccess(){
 const status=await mgApi('/status');
 if(!status.configurado)return false;
 window.attendanceConversationsEnabled=true;
 try{management.context=await mgApi('/contexto');}
 catch(e){flowAccess();await tab('gestao');aviso('Entre com seu login. Para conectar um número, utilize uma conta de administrador.');return null;}
 return true;
}
async function attendanceReconnect(){
 const access=await attendanceConnectionAccess();
 if(access===false)return attendanceLegacyApi.reconnect();
 if(access===null)return {ok:false,message:'Faça login para acessar a conexão do departamento.'};
 await attendanceConnectionDialog(true);
 return {ok:true};
}
async function attendanceConnectionDialog(connect=false){
 if(!management.context)return;
 const admin=management.context.usuario.perfil==='admin';
 const dialog=mgDialog('Conexão WhatsApp do departamento','attendance-connection-dialog');
 const form=document.createElement('div');form.className='management-form';
 let select;
 if(admin){select=mgSelect(form,'Número / conexão',management.context.conexoes.filter(c=>c.id>0).map(c=>({id:c.id,nome:c.nome+' / '+(c.numero||'Aguardando QR Code')})),attendanceConnection()?.id);select.onchange=()=>{attendanceSelectedConnection=Number(select.value)||null;refresh();};}
 const state=document.createElement('p'),number=document.createElement('p'),qr=document.createElement('img'),error=document.createElement('p');
 state.setAttribute('role','status');qr.className='flow-qr';qr.alt='QR Code WhatsApp';qr.hidden=true;error.className='form-error';
 const instructions=document.createElement('p');instructions.textContent=admin?'No celular: Aparelhos conectados → Conectar aparelho. O histórico e a sessão existentes serão preservados.':'A conexão é administrada pelo administrador. Solicite a ele a conexão ou reconexão deste número.';
 const button=mgButton('Conectar / reconectar',async()=>{const c=selected();if(!c){error.textContent='Configure uma conexão em Gestão → Departamentos.';return;}button.disabled=true;error.textContent='';try{await flowCommand('/conexoes/'+c.id+'/conectar',{});await refresh();}catch(e){error.textContent=e.message;}finally{button.disabled=false;}});
 button.hidden=!admin;
 const disconnect=mgButton('Desconectar aplicativo',()=>{const c=selected();if(!c)return;const confirm=mgDialog('Desconectar aplicativo','attendance-disconnect-confirm');const description=document.createElement('p');const departments=management.context.departamentos.filter(d=>d.conexao_id===c.id).map(d=>d.nome);description.textContent='Interromper a conexão de '+c.nome+(departments.length?' para os departamentos '+departments.join(', '):'')+'. A sessão e o histórico serão preservados. Para voltar, use Conectar / reconectar.';const error=document.createElement('p');error.className='form-error';const stop=mgButton('Confirmar desconexão',async()=>{stop.disabled=true;error.textContent='';try{await flowCommand('/conexoes/'+c.id+'/desconectar',{});confirm.close();await refresh();}catch(e){error.textContent=e.message;}finally{stop.disabled=false;}});confirm.append(description,error,stop);confirm.showModal();});disconnect.hidden=!admin;

 function selected(){return admin&&select?management.context.conexoes.find(c=>c.id===Number(select.value)):attendanceConnection();}
 let refreshing=false;
 async function refresh(){if(refreshing||!dialog.open)return;refreshing=true;try{const context=await mgApi('/contexto');if(!dialog.open)return;management.context=context;const c=selected();state.textContent=c?({'conectado':'Conectado',qr:'Escaneie o QR Code',iniciando:'Iniciando conexão',autenticado:'Carregando WhatsApp',reconectando:'Reconectando',aguardando:'Carregando WhatsApp — aguarde',desconectado:'Desconectado'}[c.estado]||c.estado):'Departamento sem número configurado';number.textContent=c?(c.nome+' / '+(c.numero||'Número aguardando identificação')):'';qr.hidden=!admin||!c?.qr;if(admin&&c?.qr)qr.src=c.qr;else qr.removeAttribute('src');error.textContent=c?.erro||'';button.disabled=['iniciando','reconectando','autenticado','aguardando'].includes(c?.estado);const connection=attendanceConnection();waState={...waState,status:connection?.estado||'desconectado',qr:admin?connection?.qr||null:null,error:connection?.erro||''};renderWA();}catch(e){error.textContent=e.message;button.disabled=true;qr.hidden=true;}finally{refreshing=false;}}
 form.append(number,state,qr,error,instructions,button,disconnect);dialog.append(form);dialog.showModal();const timer=setInterval(refresh,1500);dialog.addEventListener('close',()=>clearInterval(timer),{once:true});await refresh();
 if(connect&&admin&&management.context.conexoes.filter(c=>c.id>0).length===1&&selected()?.estado!=='conectado')button.click();
}
const attendanceLegacyReconnectWA=reconnectWA;
reconnectWA=async function(){try{const access=await attendanceConnectionAccess();if(access===false)return attendanceLegacyReconnectWA();if(access!==null)await attendanceConnectionDialog(true);}catch(e){aviso(e.message);}};
const attendanceLegacyToggleQr=toggleQr;
toggleQr=async function(){try{const access=await attendanceConnectionAccess();if(access===false)return attendanceLegacyToggleQr();if(access!==null)await attendanceConnectionDialog();}catch(e){aviso(e.message);}};

async function disconnectWA(){try{const access=await attendanceConnectionAccess();if(access===false){await attendanceLegacyApi.disconnect();return;}if(access!==null)await attendanceConnectionDialog();}catch(e){aviso(e.message);}}
