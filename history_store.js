'use strict';
function createHistoryStore({token,fetchApi=fetch,onError=()=>{}}){
 let timer=null,pending=null,saving=null;
 const headers={'Content-Type':'application/json','X-Sync-Token':token};
 async function request(route,body){const response=await fetchApi('http://127.0.0.1:8765/api/whatsapp/'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw Error('Não foi possível salvar ou recuperar o histórico local.');return response.json();}
 async function flush(){clearTimeout(timer);timer=null;if(saving){await saving;if(pending)return flush();return;}if(!pending)return;const snapshot=pending;pending=null;saving=request('historico',{conversations:snapshot}).catch(error=>{pending=pending||snapshot;onError(error);}).finally(()=>{saving=null;});await saving;}
 return {loadOmitted:()=>request('omitidas'),omit:(chatId,id)=>request('omitidas',{conversa_id:chatId,mensagem_id:id}),load:()=>request('historico'),queue(chats){pending=JSON.parse(JSON.stringify(chats));clearTimeout(timer);timer=setTimeout(()=>flush(),350);timer.unref?.();},flush,readMedia:id=>request('midia/'+encodeURIComponent(id)),saveMedia:(id,media)=>request('midia/'+encodeURIComponent(id),media)};
}
module.exports={createHistoryStore};
