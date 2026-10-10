'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('notificationApi',{dismiss:()=>ipcRenderer.invoke('notification-dismiss')});
