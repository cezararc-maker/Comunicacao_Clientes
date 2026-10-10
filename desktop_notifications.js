'use strict';
const path=require('node:path');
function createDesktopNotifications({BrowserWindow,ipcMain,screen,getWindow,onOpen=()=>false}){
 let toast=null,timer=null,generation=0,target=null,ending=false;
 function dispose(){generation++;clearTimeout(timer);timer=null;if(toast&&!toast.isDestroyed())toast.destroy();toast=null;target=null;ending=false;}
 function dismiss(effect){const current=toast;if(!current||current.isDestroyed()||ending)return;ending=true;clearTimeout(timer);current.webContents.executeJavaScript(`dismissNotification(${JSON.stringify(effect)})`).catch(()=>{});timer=setTimeout(()=>{if(toast===current)dispose();},600);}
 ipcMain.handle('notification-dismiss',event=>{if(!toast||event.sender.id!==toast.webContents.id)throw Error('Notificação não autorizada.');dismiss('glass');return true;});
 ipcMain.handle('notification-open',event=>{if(!toast||event.sender.id!==toast.webContents.id)throw Error('Notificação não autorizada.');if(ending||!target)return false;const destination=target;dispose();return onOpen(destination);});
 async function show(title,text,destination=null){
  dispose();target=destination?{chatId:String(destination.chatId||''),messageId:String(destination.messageId||'')}:null;const own=++generation;const display=screen.getDisplayMatching(getWindow()?.getBounds()||{x:0,y:0,width:1,height:1}),area=display.workArea;
  const win=new BrowserWindow({width:400,height:180,x:area.x+area.width-416,y:area.y+area.height-196,show:false,transparent:true,frame:false,resizable:false,skipTaskbar:true,alwaysOnTop:true,focusable:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'notification_preload.js')}});toast=win;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  try{await win.loadFile(path.join(__dirname,'static','desktop_notification.html'));if(generation!==own||toast!==win||win.isDestroyed())return;await win.webContents.executeJavaScript(`document.getElementById('notification-title').textContent=${JSON.stringify(String(title||'Nova mensagem').slice(0,100))};document.getElementById('notification-body').textContent=${JSON.stringify(String(text||'Nova mensagem').slice(0,240))};`);if(generation!==own||win.isDestroyed())return;win.showInactive();timer=setTimeout(()=>dismiss('pop'),5000);}catch(error){if(toast===win)dispose();console.error('Notificação:',error.message);}
 }
 getWindow()?.on('closed',dispose);return {show,dispose};
}
module.exports={createDesktopNotifications};
