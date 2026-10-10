'use strict';
// Temporary test scope requested by the user. 01:00 Cuiaba = 05:00 UTC.
const PHONES=Object.freeze(['5567996373431','5567992780415']);
const SINCE=Math.floor(Date.parse('2026-10-09T01:00:00-04:00')/1000);
function phoneInScope(phone){return PHONES.includes(String(phone||'').replace(/\D/g,''));}
function messageInScope(msg,allowedIds){
 if(!msg)return false;
 const id=msg.fromMe?msg.to:msg.from;
 return allowedIds.has(id)&&Number.isFinite(Number(msg.timestamp))&&Number(msg.timestamp)>=SINCE;
}
module.exports={PHONES,SINCE,phoneInScope,messageInScope};
