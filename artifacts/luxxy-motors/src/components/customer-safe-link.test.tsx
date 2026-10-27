import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CustomerSafeLink } from './customer-safe-link';

beforeEach(()=>{document.documentElement.dataset.testModeSession='practice';window.history.replaceState({},'','/portal?section=sales');});
afterEach(()=>{delete document.documentElement.dataset.testModeSession;vi.restoreAllMocks();});

it('does not expose a real vehicle URL to middle-click, context menu or dragging',()=>{
 const route=memoryLocation({path:'/'});
 render(<Router hook={route.hook}><CustomerSafeLink href="/vehicle/one">View car</CustomerSafeLink></Router>);
 const link=screen.getByRole('link',{name:'View car'});
 expect(link.tagName).toBe('BUTTON');
 expect(link).not.toHaveAttribute('href');
 expect(link).toHaveAttribute('draggable','false');
 expect(fireEvent(link,new MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true}))).toBe(false);
 expect(fireEvent.contextMenu(link)).toBe(false);
 expect(fireEvent.dragStart(link)).toBe(false);
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
 fireEvent.click(link);
 expect(window.location.pathname+window.location.search).toBe('/portal?section=sales');
});
it('keeps the ordinary live destination outside practice',()=>{
 delete document.documentElement.dataset.testModeSession;
 render(<CustomerSafeLink href="/stock?bodyType=SUV">Browse SUVs</CustomerSafeLink>);
 expect(screen.getByRole('link',{name:'Browse SUVs'})).toHaveAttribute('href','/stock?bodyType=SUV');
});
