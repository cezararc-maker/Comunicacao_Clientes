'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('notificationApi',{dismiss:()=>ipcRenderer.invoke('notification-dismiss'),open:()=>ipcRenderer.invoke('notification-open')});
