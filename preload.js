'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopApi',{
 getState:()=>ipcRenderer.invoke('wa-state'),
 reconnect:()=>ipcRenderer.invoke('wa-reconnect'),
 syncContacts:()=>ipcRenderer.invoke('wa-sync'),
 sendMessage:info=>ipcRenderer.invoke('wa-send',info),
 selectDocuments:()=>ipcRenderer.invoke('wa-select-documents'),
 discardDocuments:()=>ipcRenderer.invoke('wa-discard-documents'),
 sendDocuments:info=>ipcRenderer.invoke('wa-send-documents',info),
 createGroup:info=>ipcRenderer.invoke('wa-create-group',info),
 reloadPhotos:()=>ipcRenderer.invoke('wa-reload-photos'),
 contactPhotos:phones=>ipcRenderer.invoke('wa-contact-photos',phones),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('wa-state',listener);return ()=>ipcRenderer.removeListener('wa-state',listener);}
});
