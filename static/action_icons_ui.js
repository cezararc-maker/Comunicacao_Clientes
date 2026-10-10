'use strict';
const actionIconLabels=Object.freeze({
 'Aparência':'aparencia','Conexão e QR Code':'conexao-qr','Sincronizar contatos e grupos':'sincronizar-contatos','Sincronizar contatos e grupo de teste':'sincronizar-contatos','Atualizar fotos':'atualizar-fotos','Novo grupo':'novo-grupo','Criar grupo':'novo-grupo','Contatos e vínculos':'contatos-vinculos','Importar contatos':'importar-contatos','Importar CSV / vCard':'importar-contatos','Importar contatos do Google ou vCard':'importar-contatos','Empresas':'empresas','Importar empresas':'importar-empresas','Reconectar WhatsApp':'reconectar','Reconectar':'reconectar',
 'Marcar como não lida':'nao-lida','Fixar conversa':'fixar-conversa','Desafixar conversa':'desafixar-conversa','Selecionar mensagens':'selecionar-mensagens','Encaminhar':'encaminhar','Excluir para mim':'excluir-para-mim','Cancelar seleção':'cancelar-selecao','Fixar':'fixar-mensagem',
 'Foto':'foto','Vídeo':'video','Áudio':'audio','Documento, ZIP ou outro arquivo':'arquivo','Compartilhar contato':'compartilhar-contato','Emojis':'emojis','Selecionar figurinha':'figurinha','Enviar GIF (vídeo MP4)':'gif','Figurinhas e GIFs recentes':'midias-recentes','Parar e ouvir':'parar-ouvir','Descartar':'descartar-gravacao',
 'Excluir contato':'excluir-contato','Salvar vínculo':'salvar-vinculo','Adicionar membro':'adicionar-membro','Tornar administrador':'tornar-administrador','Remover administração':'remover-administracao','Remover do grupo':'remover-grupo','Salvar descrição':'salvar-descricao','Cadastrar contato':'cadastrar-contato','Cadastrar empresa':'cadastrar-empresa','Salvar alterações':'salvar-alteracoes',
 'Analisar contatos':'analisar-contatos','Analisar Excel':'analisar-excel','Confirmar importação':'confirmar-importacao','Confirmar destinatários':'confirmar-destinatarios','Enviar':'enviar-anexo','Enviar cartão':'enviar-cartao','Salvar contato':'salvar-contato','Enviar mensagem':'enviar-mensagem','Clique para ampliar':'ampliar-pdf',
 'Da posição atual até o fim':'captura-automatica','Acompanhar minha rolagem':'captura-manual','Finalizar':'finalizar-captura','Salvar PNG':'salvar-png','Tentar carregar novamente':'tentar-novamente','Restaurar tema padrão':'restaurar-tema','Cancelar':'cancelar','Confirmar':'confirmar','Concluir':'concluir'
});
function actionIconName(control){
 if(control.dataset.actionIcon)return control.dataset.actionIcon;
 if(control.id==='new-messages')return 'rolar-fim';
 const label=control.textContent.trim();
 if(label==='Editar'){const handler=control.getAttribute('onclick')||'';return handler.includes("'company'")?'editar-empresa':'editar-contato';}
 return actionIconLabels[label]||null;
}
function decorateActionControl(control){
 if(control.matches('.window-control,.dialog-close,.tools-close,.notification-text,.notification-close,.quoted-message,.contact-name,.pinned-link,.theme-option'))return;
 const name=actionIconName(control);if(!name||!ionActionIcons[name])return;
 const old=control.querySelector('.action-icon');if(old?.dataset.iconName===name)return;
 if(control.querySelector('svg:not(.action-icon),img,.paperclip-icon,.welcome-icon'))return;
 old?.remove();const template=document.createElement('template');template.innerHTML=ionActionIcons[name];const svg=template.content.firstElementChild;svg.dataset.iconName=name;
 if(control.id==='new-messages')control.replaceChildren(svg);else (control.matches('.pdf-enlarge')?control.querySelector('span'):control).prepend(svg);
 control.classList.add('has-action-icon');
}
function decorateActionIcons(root=document){
 if(root.matches?.('button,a.file-download,.contact-cards a'))decorateActionControl(root);
 root.querySelectorAll?.('button,.contact-cards a').forEach(decorateActionControl);
}
decorateActionIcons();
const actionIconObserver=new MutationObserver(records=>{
 const roots=new Set();for(const record of records){const parent=record.target.nodeType===1?record.target:record.target.parentElement;if(parent?.closest('svg'))continue;const control=parent?.closest('button,.contact-cards a');if(control)roots.add(control);for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches('svg'))roots.add(node);}
 roots.forEach(decorateActionIcons);
});
actionIconObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
window.addEventListener('pagehide',()=>actionIconObserver.disconnect(),{once:true});
