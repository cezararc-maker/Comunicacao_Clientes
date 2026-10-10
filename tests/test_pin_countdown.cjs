'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const sandbox={setInterval:()=>{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/pinned_messages.js'),'utf8'),sandbox);
const countdown=(seconds,duration)=>sandbox.pinCountdown({expira:1000+seconds,duracao:duration},1000);
assert.equal(countdown(3600,3600),'01:00:00');assert.equal(countdown(604800,604800),'7 dias restantes');assert.equal(countdown(1,3600),'00:00:01');assert.equal(countdown(-1,3600),'00:00:00');
assert.equal(countdown(86401,604800),'2 dias restantes');assert.equal(countdown(86400,604800),'24:00:00');assert.equal(countdown(86399,604800),'23:59:59');assert.equal(countdown(1,604800),'00:00:01');assert.equal(countdown(-1,604800),'00:00:00');assert.equal(countdown(86400,86400),'24:00:00');
assert(countdown(2592000,2592000).includes('30 dias restantes'));assert(countdown(86401,2592000).endsWith('2 dias restantes'));assert(countdown(86400,2592000).endsWith('24:00:00'));assert(countdown(86399,2592000).endsWith('23:59:59'));assert(countdown(1,2592000).endsWith('00:00:01'));assert(countdown(2592000,2592000).startsWith('Até '));
console.log('Pin countdown: total hours, seconds, expiration, 30-day final date and last-day transition passed.');
