'use strict';
const assert=require('node:assert/strict');
const {resolvePhoto,fetchPhotoInSession}=require('../profile_photos');
const image='data:image/png;base64,aGVsbG8=';
(async()=>{
 const calls=[];
 const client={getProfilePicUrl:async id=>{calls.push(id);return id.endsWith('@lid')?'https://example.com/avatar.jpg':null},pupPage:{evaluate:async()=>image}};
 const result=await resolvePhoto(client,['5567996373431@c.us','123456@lid'],{fetchImage:async()=>null});
 assert.equal(result.image,image);assert.equal(result.status,'loaded');assert.equal(calls.length,2);
 const fallback=await resolvePhoto({getProfilePicUrl:async()=> 'https://example.com/avatar.jpg'},['id'],{fetchImage:async()=>image});assert.equal(fallback.image,image);
 const missing=await resolvePhoto({getProfilePicUrl:async()=>null},['id'],{fetchImage:async()=>null});assert.equal(missing.status,'unavailable');
 const rejected=await resolvePhoto({getProfilePicUrl:async()=> 'http://unsafe.test/avatar.jpg'},['id'],{fetchImage:async()=>{throw Error('must not fetch')}});assert.equal(rejected.image,null);
 assert.equal(await fetchPhotoInSession({evaluate:async()=>{throw Error('CORS')}},'https://example.com/avatar.jpg'),null);
 console.log('Profile photos: PN/LID fallback, authenticated image embedding, alternate download, missing photos and invalid URL rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
