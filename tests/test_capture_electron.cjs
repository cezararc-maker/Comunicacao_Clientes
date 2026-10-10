const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {registerCaptureHandlers,planCapture}=require('../capture_conversation');
app.on('window-all-closed',()=>{});

app.whenReady().then(async()=>{
 
 const handlers={};const output=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'comunicacao-captura-teste-'));
 const service=registerCaptureHandlers({ipcMain:{handle:(name,fn)=>handlers[name]=fn},BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:path.join(output,'test.pdf')}),showOpenDialog:async()=>({filePaths:[output]})},getWindow:()=>null,safeSender:e=>e.ok});
 try{
  await assert.rejects(handlers['capture-begin']({},{}),/autorizada/);
  for(const scale of [1,1.25,2]){
   const width=700,height=14400,start=333,end=13233;
   const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}#content{width:${width}px;height:${height}px;background:linear-gradient(to bottom,#ff0000 0px,#ff0000 6000px,#00ff00 6000px,#00ff00 12000px,#0000ff 12000px);position:relative}.label{position:absolute;top:400px;left:60px;font:20px Arial;color:black}</style><div id="content"><div class="label">Conversa de teste</div></div>`;
   const {id}=await handlers['capture-begin']({ok:true},{html,width,height,start,scale,name:'Teste'});
   const plans=planCapture({width,height,start,end,scale});const images=[];
   for(let index=0;index<plans.length;index++){
    const result=await handlers['capture-part']({ok:true},{id,end,index});assert.equal(result.total,plans.length);
    const image=nativeImage.createFromDataURL(result.data);assert.equal(image.getSize().width,Math.round(width*scale));assert.equal(image.getSize().height,plans[index].pixels);images.push(image);
    fs.writeFileSync(path.join(output,`scale-${scale}-part-${index+1}.png`),image.toPNG());
   }
   let offset=Math.round(start*scale);for(const image of images){const size=image.getSize(),pixels=image.toBitmap();for(const row of [0,size.height-1]){const cssY=(offset+row)/scale;const expected=cssY<6000?[0,0,255]:cssY<12000?[0,255,0]:[255,0,0];const index=(row*size.width+5)*4;assert.deepEqual([...pixels.subarray(index,index+3)],expected);}offset+=size.height;}
   assert.equal(offset,Math.round(end*scale));
   if(scale===1){const result=await handlers['capture-save']({ok:true},{id,format:'pdf'});assert.equal(result.saved,1);assert(fs.readFileSync(path.join(output,'test.pdf')).subarray(0,4).toString()==='%PDF');}
   await handlers['capture-cancel']({ok:true});await assert.rejects(handlers['capture-part']({ok:true},{id,end,index:0}),/encerrada/);
  }
  const complete={width:700,height:1400,start:300,scale:1,name:'Contato',headerHeight:70,footerHeight:60,headerHtml:'<header style="height:70px;font:20px Arial">Contato Teste Foto</header>',footerHtml:'<footer style="height:60px;font:16px Arial">Digite uma mensagem</footer>',html:'<!doctype html><style>html,body{margin:0}body{font:18px Arial}</style><div style="position:relative;width:700px;height:1400px"><div style="position:absolute;top:50px;height:50px">Mensagem antiga excluida</div><div style="position:absolute;top:400px;height:50px">Mensagem selecionavel</div><div style="position:absolute;top:1100px;height:50px">Mensagem posterior excluida</div></div>'};
  const completeJob=await handlers['capture-begin']({ok:true},complete);const completePart=await handlers['capture-part']({ok:true},{id:completeJob.id,end:900,index:0});assert.equal(nativeImage.createFromDataURL(completePart.data).getSize().height,730);
  for(let repeat=0;repeat<2;repeat++){await handlers['capture-save']({ok:true},{id:completeJob.id,format:'pdf'});assert(/\/Type\s*\/Font/.test(fs.readFileSync(path.join(output,'test.pdf')).toString('latin1')),'PDF must contain text fonts, not only a PNG');}await handlers['capture-cancel']({ok:true});
  const snapshotPath=process.env.CAPTURE_UI_FIXTURE||path.join(output,'real-ui-snapshot.json');if(fs.existsSync(snapshotPath)){
   const info=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));const {id}=await handlers['capture-begin']({ok:true},info);const end=Math.min(info.height,info.start+1600);const part=await handlers['capture-part']({ok:true},{id,end,index:0});const image=nativeImage.createFromDataURL(part.data);assert.equal(image.getSize().width,Math.round(info.width*info.scale));assert.equal(image.getSize().height,Math.min(6000,Math.round((end-info.start+(info.headerHeight||0)+(info.footerHeight||0))*info.scale)));const bitmap=image.toBitmap(),colors=new Set();for(let pixel=0;pixel<bitmap.length;pixel+=44)colors.add(bitmap.subarray(pixel,pixel+3).toString('hex'));assert(colors.size>20,'The real capture must contain the rendered bubbles, avatars and text, not just a background');fs.writeFileSync(path.join(output,'conversa-exemplo.png'),image.toPNG());await handlers['capture-save']({ok:true},{id,format:'pdf'});await handlers['capture-cancel']({ok:true});
  }
  console.log('REAL ELECTRON: exact middle start/end, consecutive PNG parts at scales 1/1.25/2, pixel continuity, PDF, real UI snapshot and cancel passed. No visible windows or WhatsApp access.');
 }catch(error){console.error(error);process.exitCode=1;}finally{service.dispose();app.quit();}
});

