'use strict';
function dropKind(name,mime){
 const ext=String(name||'').split('.').pop().toLowerCase();
 const allowed={image:['png','jpg','jpeg','webp','gif'],video:['mp4','webm'],audio:['mp3','ogg','m4a','wav','aac','opus'],document:['pdf','txt','csv','vcf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf','zip','rar','7z','gz','tar','xml','json']};
 let kind=Object.keys(allowed).find(k=>allowed[k].includes(ext));if(ext==='webm'&&String(mime||'').startsWith('audio/'))kind='audio';
 if(!kind)throw Error('Este tipo de arquivo não é aceito na conversa.');
 // Unknown media must not masquerade as a document through a filename alone.
 if(kind!=='document'&&!String(mime||'').startsWith(kind+'/'))throw Error('Formato do arquivo não corresponde ao tipo selecionado.');
 return kind;
}
function createVCard(contact){
 const name=String(contact?.name||'').trim(),phone=String(contact?.phone||'').replace(/\D/g,'');
 if(!name||name.length>200||!/^[1-9]\d{9,14}$/.test(phone))throw Error('Informe nome e telefone com código do país.');
 const escape=value=>value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 return ['BEGIN:VCARD','VERSION:3.0','FN:'+escape(name),'N:'+escape(name)+';;;;','TEL;TYPE=CELL:+'+phone,'END:VCARD'].join('\r\n');
}
module.exports={dropKind,createVCard};
