import { describe, expect, it } from 'vitest';
import { isWritableFormControl } from './form-draft';

describe('isWritableFormControl', () => {
  it('recognises fields where customer input could be lost', () => {
    document.body.innerHTML = `
      <form>
        <input name="name" value="" />
        <textarea name="message"></textarea>
      </form>
    `;

    const name = document.querySelector<HTMLInputElement>('input[name="name"]');
    const message = document.querySelector<HTMLTextAreaElement>('textarea');
    if (!name) throw new Error('Expected the name field');
    if (!message) throw new Error('Expected the message field');

    expect(isWritableFormControl(name)).toBe(true);
    expect(isWritableFormControl(message)).toBe(true);
  });

  it('ignores controls that cannot represent an unfinished customer draft', () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" value="generated-token" />
        <input disabled value="server-owned" />
        <button type="submit">Send</button>
      </form>
      <input name="outside-form" />
    `;

    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"]');
    const disabled = document.querySelector<HTMLInputElement>('input[disabled]');
    const button = document.querySelector<HTMLButtonElement>('button');
    const outside = document.querySelector<HTMLInputElement>('input[name="outside-form"]');

    expect(isWritableFormControl(hidden)).toBe(false);
    expect(isWritableFormControl(disabled)).toBe(false);
    expect(isWritableFormControl(button)).toBe(false);
    expect(isWritableFormControl(outside)).toBe(false);
  });
});