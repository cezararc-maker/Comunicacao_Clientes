'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const row={dataset:{id:'message-20'},classList:{add:()=>row.highlighted=true,remove(){}},scrollIntoView:options=>row.position=options.block};
 const area={children:[row],dataset:{}},view={classList:{contains:()=>false}},chat={id:'chat',unreadCount:1,markedUnread:true,messages:[{id:'message-20'}]};let state={conversations:[chat]},notice,marked,reads=0,alerts=[];
 const context=vm.createContext({console,setTimeout:()=>{},requestAnimationFrame:fn=>fn(),Promise,waState:state,waChat:'other',quoted:'old',captureSession:null,document:{querySelectorAll:()=>[]},$:id=>id==='wamessages'?area:view,window:{desktopApi:{getState:async()=>{reads++;return state;},onOpenMessage:cb=>{context.open=cb;},onIncomingMessage:cb=>{context.incoming=cb;}},addEventListener(){}},showInternalNotification:(text,options)=>notice={text,...options},aviso:text=>alerts.push(text),cleanError:error=>error.message,stopVoice(){},closeMedia(){},closeDetails(){},endMessageSelection(){},cancelCapture:async()=>{},tab:name=>marked=name,renderWA(){},updateEndButton(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/notification_navigation.js'),'utf8'),context);
 vm.runInContext('installNotificationNavigation();installNotificationNavigation();',context);
 context.incoming({chatId:'chat',messageId:'message-20',title:'Contato',text:'Mensagem'});assert(notice.text.includes('Contato'));await notice.action();assert.equal(context.waChat,'chat');assert.equal(marked,'whatsapp');assert.equal(area.dataset.followBottom,'0');assert.equal(row.position,'center');assert(row.highlighted);assert.equal(chat.unreadCount,0);assert.equal(chat.markedUnread,false);assert.equal(reads,1);
 notice=null;context.incoming({chatId:'chat',messageId:'message-20'});assert.equal(notice,null);
 await context.open({chatId:'chat',messageId:'removed'});assert.equal(alerts.length,1);assert(alerts[0].includes('não está mais disponível'));
 console.log('Notification navigation: exact message, highlight, unread state, active-chat suppression and removed-message fallback passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
