'use strict';
const fs=require('node:fs/promises');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value*1000).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'}):'—';
const protocol=a=>String(a.protocolo||a.id).padStart(6,'0');
function messageText(m){return [m.reply?'Resposta a '+(m.reply.author||'')+': '+(m.reply.body||m.reply.mediaLabel||'Mídia'):null,m.body,m.hasMedia||m.type!=='chat'?m.filename||m.mediaLabel||m.type:null,...(m.vCards||[])].filter(Boolean).join('\n');}
function buildAuditHtml({rows=[],detail=null,filters={},user=''}){
 const cell=v=>'<td>'+escape(v)+'</td>';
 const table=(headers,body)=>'<table><thead><tr>'+headers.map(v=>'<th>'+escape(v)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>';
 let content=table(['Protocolo','Contato / telefone','Empresa','Departamento / responsável','Início','Conclusão'],rows.map(a=>'<tr>'+[protocol(a),a.contato_nome+'\n'+(a.telefone||''),(a.empresa_codigo||'')+' / '+(a.empresa_nome||'Sem vínculo'),a.atual_nome+' / '+a.usuario_nome,date(a.iniciado),date(a.encerrado)].map(cell).join('')+'</tr>').join(''));
 if(detail){const a=detail.atendimento;content='<h2>Protocolo '+protocol(a)+'</h2><p>'+escape(a.contato_nome)+' · '+escape(detail.telefone)+'<br>'+escape((a.empresa_codigo||'')+' / '+(a.empresa_nome||'Sem vínculo'))+'<br>'+escape(a.atual_nome+' / '+a.usuario_nome)+'<br>Início: '+date(a.iniciado)+' · Conclusão: '+date(a.encerrado)+'</p>'+(a.resumo?'<p>Resumo: '+escape(a.resumo)+'</p>':'')+'<h2>Registro das mensagens</h2>'+table(['Data e hora','Autor / direção','Conteúdo'],detail.mensagens.map(m=>'<tr>'+[date(m.timestamp),(m.authorName|| (m.fromMe?a.usuario_nome:a.contato_nome))+' / '+(m.fromMe?'Enviada':'Recebida'),messageText(m)].map(cell).join('')+'</tr>').join(''))+'<h2>Movimentações</h2>'+table(['Data e hora','Usuário','Movimentação'],detail.eventos.map(e=>'<tr>'+[date(e.horario),e.usuario_nome,e.tipo+'\n'+Object.entries(e.dados||{}).map(([k,v])=>k+': '+String(v)).join('\n')].map(cell).join('')+'</tr>').join(''));}
 return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório de atendimentos</title><style>@page{size:A4;margin:16mm}body{font:11px Arial;color:#17364c}h1{font-size:23px}h2{font-size:16px;margin-top:25px}p{line-height:1.6}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#eef5fa;text-align:left}td,th{border-bottom:1px solid #dbe4eb;padding:8px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}small{color:#486477}</style><h1>Comunicação Clientes</h1><h2>Relatório de atendimentos concluídos</h2><small>Gerado em '+escape(new Date().toLocaleString('pt-BR',{timeZone:'America/Cuiaba'}))+' · '+escape(user)+'</small><p>Filtros: '+escape(Object.entries(filters).filter(([,v])=>v).map(([k,v])=>k+': '+v).join(' / ')||'Todos os registros autorizados')+'</p>'+content+'</html>';
}
async function renderPdf(BrowserWindow,html){
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'audit-'+Date.now()+'-'+Math.random()}});
 try{win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.webRequest.onBeforeRequest((request,done)=>done({cancel:!request.url.startsWith('data:text/html')&&!request.url.startsWith('about:')}));await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return await win.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true});}finally{if(!win.isDestroyed())win.destroy();}
}
function registerAuditReport({ipcMain,BrowserWindow,dialog,getWindow,baseSender,managementRequest}){
 let running=false;
 ipcMain.handle('audit-report-pdf',async(event,input={})=>{
  if(!baseSender(event))throw Error('Origem não autorizada.');if(running)throw Error('Um relatório já está sendo gerado.');running=true;
  try{
   const read=async route=>{const r=await managementRequest(route);if(!r.ok)throw Error('Sessão expirada ou relatório não autorizado.');return r.json();};
   const context=await read('/contexto'),uid=context.usuario.id;
   const verify=async()=>{if((await read('/contexto')).usuario.id!==uid)throw Error('O usuário mudou durante a geração.');};
   const filters={};for(const key of ['nome_contato','telefone','usuario_id','departamento_id','empresa_id','inicio','fim','classificar','ordem','protocolo'])if(typeof input.filters?.[key]==='string')filters[key]=input.filters[key].slice(0,200);
   let detail=null,rows=[];
   if(input.id!==undefined){const id=Number(input.id);if(!Number.isSafeInteger(id)||id<1)throw Error('Atendimento inválido.');detail=await read('/atendimentos/'+id);if(detail.atendimento.status!=='encerrado')throw Error('O relatório requer um atendimento concluído.');for(let offset=detail.mensagens.length;offset<detail.total_mensagens;offset+=100){await verify();detail.mensagens.push(...(await read('/atendimentos/'+id+'?offset='+offset)).mensagens);if(offset>=100000)throw Error('Relatório muito extenso.');}}
   else{const params=new URLSearchParams(filters);params.set('status','encerrado');for(let offset=0;;offset+=50){await verify();params.set('offset',offset);const page=await read('/atendimentos?'+params);rows.push(...page.itens);if(rows.length>=page.total||!page.itens.length)break;if(rows.length>=5000)throw Error('Limite de 5.000 atendimentos. Restrinja o período do relatório.');}}
   const html=buildAuditHtml({rows,detail,filters,user:context.usuario.nome});const bytes=await renderPdf(BrowserWindow,html);await verify();
   const result=await dialog.showSaveDialog(getWindow(),{title:'Salvar relatório de auditoria',defaultPath:'Relatorio_atendimentos'+(detail?'_'+protocol(detail.atendimento):'')+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(result.canceled)return {canceled:true};await verify();
   await fs.writeFile(result.filePath,bytes);return {ok:true};
  }finally{running=false;}
 });
}
module.exports={buildAuditHtml,messageText,renderPdf,registerAuditReport};
