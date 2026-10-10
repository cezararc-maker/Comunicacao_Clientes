'use strict';
function dismissInternalNotification(element,{duration=380,fragments=5,displacement=20,manual=true,reducedMotion}={}){
 if(element._dismissController)return element._dismissController;
 duration=Math.max(300,Math.min(450,Number(duration)||380));fragments=Math.max(4,Math.min(6,Math.round(Number(fragments)||5)));displacement=Math.max(12,Math.min(28,Number(displacement)||20));
 const reduced=reducedMotion??matchMedia('(prefers-reduced-motion: reduce)').matches,animations=[],decorations=[],slot=element.parentElement;
 element.style.pointerEvents='none';element.setAttribute('aria-disabled','true');const height=slot.getBoundingClientRect().height;slot.style.height=height+'px';slot.style.flexShrink='0';
 let finished=false,resolveFinished;const completion=new Promise(resolve=>resolveFinished=resolve);function cleanup(){if(finished)return;finished=true;animations.forEach(a=>a.cancel());decorations.forEach(e=>e.remove());slot.remove();resolveFinished();}
 const controller={cancel:cleanup,finished:completion};element._dismissController=controller;
 async function run(){try{
  const easing='cubic-bezier(.16,1,.3,1)',milliseconds=reduced?120:manual?duration-80:180;
  if(manual&&!reduced){const rect=element.getBoundingClientRect(),style=getComputedStyle(element),colors=[style.getPropertyValue('--surface')||'#fff',style.getPropertyValue('--soft')||'#e8f3fc',style.getPropertyValue('--accent')||'#70cddd'];
   for(let i=0;i<fragments;i++){const angle=(i/fragments)*Math.PI*2,piece=document.createElement('span');piece.className='ion-notification-fragment';piece.style.cssText=`position:fixed;left:${rect.left+rect.width*(.5+.3*Math.cos(angle))}px;top:${rect.top+rect.height*(.5+.25*Math.sin(angle))}px;width:${14+i%3*4}px;height:${12+i%2*4}px;border-radius:8px;background:${colors[i===fragments-1?2:i%2]};opacity:0;pointer-events:none;z-index:110;`;document.body.append(piece);decorations.push(piece);animations.push(piece.animate([{opacity:0,transform:'translate(-50%,-50%) scale(.85)'},{opacity:.75,offset:.15,transform:'translate(-50%,-50%) scale(1)'},{opacity:0,transform:`translate(calc(-50% + ${Math.cos(angle)*displacement}px),calc(-50% + ${Math.sin(angle)*displacement}px)) scale(.25)`}],{duration:milliseconds-90,delay:90,easing,fill:'forwards'}));}
   for(const child of element.children)animations.push(child.animate([{opacity:1},{opacity:0}],{duration:60,delay:30,fill:'forwards'}));
  }
  const frames=manual&&!reduced?[{opacity:1,transform:'scale(1)',easing:'cubic-bezier(.4,0,.2,1)'},{opacity:1,transform:'scale(1.05)',offset:90/milliseconds,easing},{opacity:0,transform:'scale(1.05)'}]:[{opacity:1},{opacity:0}];
  const main=element.animate(frames,{duration:milliseconds,easing:manual&&!reduced?'linear':easing,fill:'forwards'});animations.push(main);await main.finished;if(finished)return;
  const collapse=slot.animate([{height:height+'px',paddingBottom:'8px',opacity:1},{height:'0px',paddingBottom:'0px',opacity:0}],{duration:80,easing,fill:'forwards'});animations.push(collapse);await collapse.finished;
 }catch{}finally{cleanup();}}
 run();return controller;
}
