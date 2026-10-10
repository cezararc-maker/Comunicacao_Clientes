'use strict';
const DATA_IMAGE=/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
async function fetchPhotoInSession(page,url){
 if(!page||!/^https:\/\//.test(url))return null;
 try{return await page.evaluate(async src=>{
  const response=await fetch(src,{credentials:'include',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  const blob=await response.blob();
  if(blob.size>3*1024*1024||!/^image\/(png|jpeg|webp|gif)$/.test(blob.type))return null;
  return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});
 },url);}catch{return null;}
}
async function fetchPhotoBytes(url){
 try{
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  const mime=(response.headers.get('content-type')||'').split(';')[0];
  if(!response.ok||!/^image\/(png|jpeg|webp|gif)$/.test(mime)||Number(response.headers.get('content-length'))>3*1024*1024)return null;
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>3*1024*1024)return null;chunks.push(Buffer.from(chunk));}
  return 'data:'+mime+';base64,'+Buffer.concat(chunks).toString('base64');
 }catch{return null;}
}
async function resolvePhoto(client,ids,{fetchImage=fetchPhotoBytes}={}){
 let urlFallback=null,lastError=null;
 for(const id of [...new Set(ids.filter(Boolean))]){
  try{
   const url=await client.getProfilePicUrl(id);
   if(typeof url!=='string'||!url.startsWith('https://'))continue;
   const embedded=await fetchPhotoInSession(client.pupPage,url)||await fetchImage(url);
   if(typeof embedded==='string'&&DATA_IMAGE.test(embedded))return {image:embedded,status:'loaded'};
   urlFallback=urlFallback||url;
  }catch(error){lastError=error;}
 }
 // Keep an external URL as fallback, but never cache missing/error results forever.
 return {image:urlFallback,status:urlFallback?'external':lastError?'error':'unavailable'};
}
module.exports={DATA_IMAGE,fetchPhotoInSession,fetchPhotoBytes,resolvePhoto};
