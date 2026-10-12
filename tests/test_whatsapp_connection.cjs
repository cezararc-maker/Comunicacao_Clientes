'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {connectionOptions,connectionError,initializeConnection}=require('../whatsapp_connection');
(async()=>{
 assert.equal(connectionOptions().userAgent,false);assert.equal(connectionOptions().webVersionCache.type,'none');
 const calls=[],page=new EventEmitter();page.setUserAgent=async value=>calls.push(['agent',value]);page.setBypassServiceWorker=async value=>calls.push(['worker',value]);page.setCacheEnabled=async value=>calls.push(['cache',value]);page.goto=async(url,options)=>calls.push(['goto',url,options]);
 const previous=async()=>calls.push(['auth-hook']);const client={authStrategy:{afterBrowserInitialized:previous},pupPage:page,pupBrowser:{userAgent:async()=> 'Mozilla Chrome-compatible HeadlessChrome/146.0.0.0'},initialize:async()=>{await client.authStrategy.afterBrowserInitialized();await page.goto('https://web.whatsapp.com/',{timeout:0,waitUntil:'load',referer:'https://whatsapp.com/'});}};
 await initializeConnection(client,{timeoutMs:1000});assert.equal(client.authStrategy.afterBrowserInitialized,previous);assert(calls.some(c=>c[0]==='agent'&&c[1].includes('Chrome/146')&&!c[1].includes('HeadlessChrome')));assert(calls.some(c=>c[0]==='worker'&&c[1]));assert(calls.some(c=>c[0]==='cache'&&!c[1]));const navigation=calls.find(c=>c[0]==='goto')[2];assert.equal(navigation.waitUntil,'domcontentloaded');assert.equal(navigation.timeout,1000);assert.equal(navigation.referer,'https://whatsapp.com/');
 const stalled={authStrategy:{afterBrowserInitialized:previous},initialize:()=>new Promise(()=>{})};const keepAlive=setInterval(()=>{},20);try{await assert.rejects(initializeConnection(stalled,{timeoutMs:30}),/Tempo limite/);}finally{clearInterval(keepAlive);}assert.equal(stalled.authStrategy.afterBrowserInitialized,previous);assert(connectionError('auth timeout').includes('não concluiu'));assert(connectionError(Error('net::ERR_NETWORK_ACCESS_DENIED')).includes('bloqueado'));
 console.log('WhatsApp startup: current browser, bounded navigation/initialization, session-preserving hooks and readable errors passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
