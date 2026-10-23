import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ConversationMessage, conversationExcerpt } from './conversation-message';
it('folds recognised quoted email history while keeping the full original accessible',()=>{
 const text='Can I visit tomorrow?\n\nOn Fri, 23 Oct 2026, Dealer wrote:\nEarlier email';
 expect(conversationExcerpt(text).text).toBe('Can I visit tomorrow?');
 render(<ConversationMessage text={text}/>);
 const details=screen.getByText('Show original message').closest('details')!;
 expect(details).not.toHaveAttribute('open');fireEvent.click(screen.getByText('Show original message'));
 expect(details.textContent).toContain(text);
});
it('leaves unknown message formats intact',()=>{
 for(const text of ['Plain note','On a test drive tomorrow','Hi\nUnrecognised quoted format']) expect(conversationExcerpt(text)).toEqual({text,folded:false});
});
