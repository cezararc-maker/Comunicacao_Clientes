'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),context=vm.createContext({document:{querySelectorAll:()=>[],body:{}},window:{addEventListener(){}},MutationObserver:class{observe(){}disconnect(){}}});
vm.runInContext(fs.readFileSync(path.join(root,'static/action_icons_registry.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'static/action_icons_ui.js'),'utf8'),context);
const names=vm.runInContext('Object.keys(ionActionIcons)',context);assert.equal(names.length,60);
for(const name of names){const svg=fs.readFileSync(path.join(root,'static/icons/actions',name+'.svg'),'utf8');assert(svg.includes('viewBox="0 0 24 24"'));assert(svg.includes('stroke="currentColor"'));assert(!/<(?:script|foreignObject|image|use)\b|\bon\w+=|\bhref=/i.test(svg));}
const resolve=(label,handler='',id='')=>context.actionIconName({dataset:{},id,textContent:label,getAttribute:()=>handler});
assert.equal(resolve('Editar',"editRecord('company',1)"),'editar-empresa');assert.equal(resolve('Editar',"editRecord('contact',1)"),'editar-contato');assert.equal(resolve('Desafixar conversa'),'desafixar-conversa');assert.equal(resolve('Excluir para mim'),'excluir-para-mim');assert.equal(resolve('Conexão e configurações'),null);assert.equal(resolve('↓','','new-messages'),'rolar-fim');assert.equal(resolve('Emojis'),'emojis');
assert(fs.readFileSync(path.join(root,'static/icons/actions/salvar-vinculo.svg'),'utf8').includes('translate(2 0)'));
console.log('60 safe theme-aware icons, semantic actions, approved reframe and removed-menu preservation passed.');
