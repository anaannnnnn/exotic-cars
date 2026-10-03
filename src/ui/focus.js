/** Keep modal interactions inside the dialog and restore the caller on close. */
export function trapDialogFocus(dialog){
 const previous=document.activeElement;
 const candidates=()=>[...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
 const handler=e=>{if(e.key!=='Tab')return;const items=candidates();if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus()}};
 dialog.addEventListener('keydown',handler);
 requestAnimationFrame(()=>{if(dialog.isConnected)candidates()[0]?.focus({preventScroll:true})});
 return()=>{dialog.removeEventListener('keydown',handler);if(previous?.isConnected)previous.focus({preventScroll:true})};
}
