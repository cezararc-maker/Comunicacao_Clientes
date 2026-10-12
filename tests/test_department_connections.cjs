'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createDepartmentConnections}=require('../department_connections');
(async()=>{
 const events=[],clients=[],commands=[];let primaryReconnect=0,primaryDisconnect=0;
 const mockFetch=async(url,options)=>{const route=url.split('/ponte/')[1],data=options.body?JSON.parse(options.body):null;events.push({route,data});return {ok:true,json:async()=>route==='configuracao'?[]:route==='comandos'?{comando:commands.shift()||null}:{ok:true}};};
 const primary={info:{wid:{_serialized:'5567000000001@c.us'}},sendMessage:async(chat,text)=>({id:{_serialized:'sent'},to:chat,fromMe:true,timestamp:Date.now()/1000,body:text})};
 const worker=createDepartmentConnections({token:'test',dataPath:'test-only',getPrimary:()=>primary,reconnectPrimary:async()=>primaryReconnect++,disconnectPrimary:async()=>primaryDisconnect++,primarySent:()=>{},fetchApi:mockFetch,qrCode:async()=> 'data:image/png;base64,TEST',makeClient:options=>{const c=new EventEmitter();c.options=options;c.info={wid:{_serialized:'5567000000002@c.us'}};c.initialize=async()=>{};c.destroy=async()=>{c.destroyed=true};c.sendMessage=primary.sendMessage;clients.push(c);return c;}});
 await worker.start();await worker.connect(2);await worker.connect(2);assert.equal(clients.length,1);assert.equal(clients[0].options.clientId,'departamento-2');
 clients[0].emit('ready');await new Promise(r=>setImmediate(r));assert(events.some(e=>e.route==='estado'&&e.data.conexao_id===2&&e.data.numero==='5567000000002'));
 await worker.receive(2,{id:{_serialized:'received'},from:'5567996373431@c.us',timestamp:Date.now()/1000,body:'Teste'});assert(events.some(e=>e.route==='mensagem'&&e.data.conexao_id===2));
 const count=events.length;await worker.receive(2,{id:{_serialized:'old'},from:'5567996373431@c.us',timestamp:1,body:'Antiga'});assert.equal(events.length,count);
 commands.push({id:1,conexao_id:2,tipo:'enviar',dados:{numero:'5567000000002',conversa_id:'5567996373431@c.us',texto:'Resposta'}});await worker.tick();assert(events.some(e=>e.route==='comandos/1/resultado'&&e.data.ok&&e.data.mensagem.body==='Resposta'));
 commands.push({id:2,conexao_id:2,tipo:'enviar',dados:{numero:'5567000000001',conversa_id:'5567996373431@c.us',texto:'Número errado'}});await worker.tick();assert(events.some(e=>e.route==='comandos/2/resultado'&&!e.data.ok));
 commands.push({id:3,conexao_id:2,tipo:'enviar',dados:{numero:'5567000000002',conversa_id:'123456789@lid',telefone:'5567996373431',texto:'Resposta LID'}});await worker.tick();assert(events.some(e=>e.route==='comandos/3/resultado'&&e.data.ok&&e.data.mensagem.body==='Resposta LID'));assert(events.some(e=>e.route==='mensagem'&&e.data.telefone==='5567996373431'&&e.data.conversa_id==='123456789@lid'));
 await worker.disconnect(2);assert(clients[0].destroyed);assert.equal(primaryDisconnect,0);await worker.connect(1);assert.equal(primaryReconnect,1);await worker.stop();console.log('Department connections: isolated sessions, shared client, scoped live messages, correct sender, wrong sender rejection and independent disconnect passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
