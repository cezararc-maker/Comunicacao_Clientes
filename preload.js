'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktopApi',{
 getState:()=>ipcRenderer.invoke('wa-state'),
 reconnect:()=>ipcRenderer.invoke('wa-reconnect'),
 syncContacts:()=>ipcRenderer.invoke('wa-sync'),
 sendMessage:info=>ipcRenderer.invoke('wa-send',info),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('wa-state',listener);return ()=>ipcRenderer.removeListener('wa-state',listener);}
});
