import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent } from 'react';
import { Link as LiveLink, useLocation } from 'wouter';
import { customerTestSession } from '@/lib/customer-test-storage';

/** In customer practice, links must not contain a live URL that can be opened
 * by middle-click, a context menu, dragging or copying the address. */
export function CustomerSafeLink({href,onClick,onAuxClick,onContextMenu,onDragStart,onKeyDown,target,download,...props}:AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}) {
  const [,navigate]=useLocation();
  if(!customerTestSession()) return <LiveLink href={href} onClick={onClick} onAuxClick={onAuxClick} onContextMenu={onContextMenu} onDragStart={onDragStart} onKeyDown={onKeyDown} target={target} download={download} {...props}/>;
  const click=(event:MouseEvent<HTMLButtonElement>)=>{
    event.preventDefault();
    if(event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
    onClick?.(event as unknown as MouseEvent<HTMLAnchorElement>);
    if(href.startsWith('#')) { const id=href.slice(1); if(/^[a-zA-Z0-9_-]+$/.test(id))document.getElementById(id)?.scrollIntoView({block:'start'}); return; }
    try {
      const url=new URL(href,window.location.origin);
      if(url.origin===window.location.origin && /^\/(?:|stock|saved|contact|warranty|vehicle\/[^/]+|enquire)$/.test(url.pathname)) navigate(url.pathname+url.search);
    } catch { /* Unsupported destinations remain unavailable. */ }
  };
  return <button {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} type="button" role="link" data-test-safe-link="true" draggable={false} onClick={click}
    style={{background:'none',border:0,padding:0,font:'inherit',cursor:'pointer',...props.style}}
    onAuxClick={event=>event.preventDefault()} onContextMenu={event=>event.preventDefault()}
    onDragStart={event=>event.preventDefault()} onKeyDown={event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)event.preventDefault();}}/>;
}
