import { h } from './dom.js';
import { gsap, motionEnabled } from './motion.js';
import { onSettings } from '../state/settings.js';

/** Fixed-size navigation with a sliding active capsule; stable on touch and keyboard. */
export function createDock({items, active = 0, className = ''}) {
 const abort=new AbortController();
 const el=h('div',{class:`dock ${className}`});
 const indicator=h('span',{class:'dock__indicator','aria-hidden':'true'});
 el.append(indicator);
 const buttons=items.map((item,i)=>h(item.href?'a':'button',{
  class:'dock__btn',href:item.href,type:item.href?null:'button','aria-label':item.label,
  'aria-current':i===active?'page':null,onclick:item.onClick
 },[item.icon,h('span',{class:'dock__label',text:item.short||item.label})]));
 buttons.forEach(b=>el.append(b));
 function move(i,instant=false){
  const b=buttons[i];if(!b)return;
  const geometry={x:b.offsetLeft,y:b.offsetTop,width:b.offsetWidth,height:b.offsetHeight};
  gsap.killTweensOf(indicator);
  if(instant||!motionEnabled())gsap.set(indicator,geometry);
  else gsap.to(indicator,{...geometry,duration:.38,ease:'power3.out'});
  buttons.forEach((b,n)=>b.classList.toggle('is-highlighted',n===i));
 }
 buttons.forEach((b,i)=>{
  b.addEventListener('pointerenter',()=>move(i),{signal:abort.signal});
  b.addEventListener('focus',()=>move(i),{signal:abort.signal});
  b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[n].focus()},{signal:abort.signal});
 });
 el.addEventListener('pointerleave',()=>move(active),{signal:abort.signal});
 el.addEventListener('focusout',e=>{if(!el.contains(e.relatedTarget))move(active)},{signal:abort.signal});
 const resize=new ResizeObserver(()=>move(active,true));resize.observe(el);
 const off=onSettings(()=>move(active,true));
 return {el,destroy(){abort.abort();off();resize.disconnect();gsap.killTweensOf(indicator);}};
}
