'use strict';
const MAX_MEDIA=16*1024*1024;
const IMAGE=/^image\/(?:png|jpeg|webp|gif)$/;
const AUDIO=/^audio\/(?:ogg|mpeg|mp4|wav|x-wav|webm|aac|opus)$/;
const LABELS={image:'Foto',audio:'Áudio',ptt:'Mensagem de voz',sticker:'Figurinha',video:'Vídeo',document:'Documento'};
function mediaLabel(type){return LABELS[type]||'Anexo';}
function validateMedia(media,kind){
 const mime=String(media?.mimetype||'').split(';')[0].trim().toLowerCase();
 const data=media?.data;
 if(typeof data!=='string'||!data||data.length>Math.ceil(MAX_MEDIA/3)*4||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('Arquivo inválido ou acima de 16 MB.');
 const bytes=Buffer.from(data,'base64');
 if(!bytes.length||bytes.length>MAX_MEDIA)throw Error('Arquivo acima de 16 MB.');
 if(kind==='audio'?!AUDIO.test(mime):!IMAGE.test(mime))throw Error('Formato não suportado. Use uma foto PNG, JPG ou WebP, ou um áudio MP3, OGG, M4A, WAV ou WebM.');
 if(kind==='sticker'&&(bytes.length>1024*1024||!/^image\/(png|jpeg|webp)$/.test(mime)))throw Error('Use uma figurinha WebP, PNG ou JPG de até 1 MB.');
 return {mimetype:mime,data,filename:String(media.filename||'').slice(0,200),bytes:bytes.length};
}
function orderedMessages(messages){return [...messages].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));}
module.exports={MAX_MEDIA,IMAGE,AUDIO,mediaLabel,validateMedia,orderedMessages};
