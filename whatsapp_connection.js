'use strict';
function connectionOptions(){return {userAgent:false,webVersionCache:{type:'none'},authTimeoutMs:60000,bypassCSP:true};}
function connectionError(error){const text=String(error?.message||error||'Falha desconhecida');if(/ERR_NETWORK_ACCESS_DENIED/.test(text))return 'O acesso do navegador à Internet foi bloqueado. Verifique as permissões de rede do aplicativo.';if(/auth timeout|ready timeout|navigation.*timeout|tempo.*carregamento/i.test(text))return 'O WhatsApp Web não concluiu o carregamento no tempo esperado. Desconecte e tente conectar novamente. Detalhe: '+text.slice(0,300);return text.slice(0,1200);}
async function initializeConnection(client,{timeoutMs=90000,onDiagnostic=()=>{}}={}){
 const auth=client.authStrategy,previous=auth?.afterBrowserInitialized;
 if(auth)auth.afterBrowserInitialized=async function(...args){
  if(previous)await previous.apply(this,args);
  const page=client.pupPage;
  if(!page)return;
  const agent=await client.pupBrowser.userAgent();await page.setUserAgent(agent.replace('HeadlessChrome/','Chrome/'));
  await page.setBypassServiceWorker(true);await page.setCacheEnabled(false);
  const goto=page.goto.bind(page);page.goto=(url,options={})=>goto(url,String(url).startsWith('https://web.whatsapp.com')?{...options,waitUntil:'domcontentloaded',timeout:Math.min(timeoutMs,60000)}:options);
  let failures=0;page.on('requestfailed',request=>{if(failures++<5){let host='';try{host=new URL(request.url()).hostname;}catch{}onDiagnostic({phase:'network',host,error:request.failure()?.errorText||'Falha na requisição'});}});
  onDiagnostic({phase:'browser',message:'Navegador atual configurado; sessão preservada.'});
 };
 let timer;
 try{onDiagnostic({phase:'initializing'});return await Promise.race([Promise.resolve().then(()=>client.initialize()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tempo limite de carregamento do WhatsApp Web ('+Math.round(timeoutMs/1000)+' segundos).')),timeoutMs);timer.unref?.();})]);}
 finally{clearTimeout(timer);if(auth)auth.afterBrowserInitialized=previous;}
}
module.exports={connectionOptions,connectionError,initializeConnection};
