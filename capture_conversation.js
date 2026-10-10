'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX_PIXELS=120000000,MAX_HTML=64*1024*1024,PART_HEIGHT=6000;
function bounded(promise,milliseconds,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));}
function planCapture({width,height,start,end,scale=1}){
 if(![width,height,start,end,scale].every(Number.isFinite)||width<50||width>4000||height<=0||height>500000||start<0||end<=start||end>height+1||scale<.5||scale>4)throw Error('Intervalo de captura inválido.');
 const pixelWidth=Math.round(width*scale),first=Math.round(start*scale),last=Math.round(end*scale);
 if(pixelWidth*(last-first)>MAX_PIXELS)throw Error('Trecho muito grande. Capture intervalos menores (limite de 120 milhões de pixels).');
 const parts=[];for(let y=first;y<last;){const rows=Math.min(PART_HEIGHT,Math.floor(24000000/pixelWidth),last-y);parts.push({y:y/scale,height:rows/scale,pixels:rows});y+=rows;}return parts;
}
function captureName(name,date=new Date()){const safe=String(name||'Conversa').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,80)||'Conversa';const two=n=>String(n).padStart(2,'0');return `Conversa_${safe}_${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}_${two(date.getHours())}-${two(date.getMinutes())}`;}
function registerCaptureHandlers({ipcMain,BrowserWindow,dialog,getWindow,safeSender}){
 let job=null;
 function guard(e){if(!safeSender(e))throw Error('Janela não autorizada.');}
 function dispose(){if(job?.window&&!job.window.isDestroyed())job.window.destroy();job=null;}
 ipcMain.handle('capture-begin',async(e,info)=>{
  guard(e);dispose();if(typeof info?.html!=='string'||Buffer.byteLength(info.html)>MAX_HTML)throw Error('Histórico grande demais para uma captura.');
  planCapture({...info,start:info.start,end:Math.min(info.height,info.start+1)});
  const id=crypto.randomBytes(24).toString('hex');const win=new BrowserWindow({show:false,width:Math.ceil(info.width),height:600,useContentSize:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false,partition:'capture-'+id}});
  job={id,window:win,info,parts:[],created:Date.now()};const current=job;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('data:')&&!details.url.startsWith('about:')}));
  try{await bounded(win.loadURL('about:blank'),20000,'A cópia do histórico não carregou em 20 segundos.');if(job!==current)throw Error('Captura cancelada.');win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width:Math.ceil(info.width),height:600,deviceScaleFactor:info.scale,mobile:false});const {frameTree}=await win.webContents.debugger.sendCommand('Page.getFrameTree');await bounded(win.webContents.debugger.sendCommand('Page.setDocumentContent',{frameId:frameTree.frame.id,html:info.html}),20000,'Não foi possível renderizar a cópia do histórico.');await bounded(win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))'),10000,'As imagens da cópia não estabilizaram em 10 segundos.');return {id};}catch(error){if(job===current)dispose();throw error;}
 });
 ipcMain.handle('capture-part',async(e,{id,end,index})=>{
  guard(e);const current=job;if(!current||current.id!==id)throw Error('Captura encerrada.');
  const parts=planCapture({...current.info,end});if(!Number.isInteger(index)||index<0||index>=parts.length||index!==current.parts.length)throw Error('Parte de captura inválida.');
  const part=parts[index];let timeout;const result=await Promise.race([current.window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true,clip:{x:0,y:part.y,width:current.info.width,height:part.height,scale:1}}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('A captura desta parte excedeu 15 segundos.')),15000);})]).finally(()=>clearTimeout(timeout));
  if(job!==current)throw Error('Captura cancelada.');if(Buffer.byteLength(result.data,'base64')>100*1024*1024)throw Error('Imagem acima do limite de memória.');current.parts.push(result.data);return {data:'data:image/png;base64,'+result.data,index,total:parts.length};
 });
 ipcMain.handle('capture-save',async(e,{id,format='png'})=>{
  guard(e);const current=job;if(!current||current.id!==id||!current.parts.length)throw Error('Nenhuma imagem pronta para salvar.');
  const base=captureName(current.info.name);
  if(format==='pdf'){
   // Use the exact captured interval, rather than including content above it.
   await bounded(current.window.webContents.executeJavaScript(`document.body.innerHTML='';document.body.style.cssText='margin:0;background:white;overflow:visible';${JSON.stringify(current.parts)}.forEach(data=>{const page=document.createElement('div');page.style.cssText='width:210mm;height:297mm;break-after:page;page-break-after:always';const img=document.createElement('img');img.src='data:image/png;base64,'+data;img.style.cssText='width:100%;height:100%;object-fit:contain;display:block';page.append(img);document.body.append(page)});document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode())))`),15000,'Não foi possível preparar o PDF no prazo esperado.');
   const selected=await dialog.showSaveDialog(getWindow(),{title:'Salvar captura em PDF',defaultPath:base+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(selected.canceled)return {canceled:true};const pdf=await current.window.webContents.printToPDF({printBackground:true,preferCSSPageSize:false,pageSize:'A4',margins:{top:0,bottom:0,left:0,right:0}});await fs.promises.writeFile(selected.filePath,pdf);return {saved:1};
  }
  if(current.parts.length===1){const selected=await dialog.showSaveDialog(getWindow(),{title:'Salvar captura',defaultPath:base+'.png',filters:[{name:'PNG',extensions:['png']}]});if(selected.canceled)return {canceled:true};await fs.promises.writeFile(selected.filePath,Buffer.from(current.parts[0],'base64'));return {saved:1};}
  const selected=await dialog.showOpenDialog(getWindow(),{title:'Selecionar pasta para partes da captura',properties:['openDirectory','createDirectory']});if(selected.canceled)return {canceled:true};const files=current.parts.map((data,i)=>({path:path.join(selected.filePaths[0],base+'_'+String(i+1).padStart(3,'0')+'.png'),data}));if(files.some(f=>fs.existsSync(f.path)))throw Error('Já existe uma captura com esse nome. Escolha outra pasta ou tente novamente em outro minuto.');let saved=0;try{for(const file of files){await fs.promises.writeFile(file.path,Buffer.from(file.data,'base64'),{flag:'wx'});saved++;}}catch(error){throw Error(`Foram salvas ${saved} partes de ${files.length}. Verifique a pasta e o espaço livre.`);}return {saved};
 });
 ipcMain.handle('capture-cancel',(e,info)=>{guard(e);if(info?.id&&job?.id!==info.id)return true;dispose();return true;});
 getWindow()?.on('closed',dispose);
 return {dispose};
}
module.exports={planCapture,captureName,registerCaptureHandlers};
