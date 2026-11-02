import { describe, expect, it } from 'vitest';
import { googleReviewUrl, reviewReminderEmail, reviewReminderNote } from '@workspace/vehicle-meta';

describe('optional customer review request wording', () => {
  it('asks for an honest review once with the saved link and no positive-review gate', () => {
    const url = 'https://g.page/r/example/review';
    const copy = reviewReminderEmail(reviewReminderNote(url), 'Alex', 'Toyota Yaris', 'Example Motors');
    expect(copy?.subject).toBe('Share your experience with Example Motors');
    expect(copy?.message).toContain('Hi Alex,');
    expect(copy?.message).toContain('If you’d like to share your experience with Example Motors, you can leave an honest Google review here:');
    expect(copy?.message.match(/honest Google review/g)).toHaveLength(1);
    expect(copy?.message.match(/https:\/\/g\.page\/r\/example\/review/g)).toHaveLength(1);
    expect(copy?.message).not.toMatch(/happy|enjoy|positive|five.star|5.star|if.*satisfied/i);
  });

  it('does not substitute review wording for an ordinary or custom follow-up note', () => {
    for (const note of [undefined, null, '', 'Call Alex about the invoice.', 'Custom review message\nhttps://g.page/r/example/review']) {
      expect(reviewReminderEmail(note, 'Alex', '', 'Example Motors')).toBeNull();
    }
  });

  it.each(['http://google.com/review', 'https://google.com.other.example/review', 'https://other.example/review', 'javascript:alert(1)'])('rejects an unavailable or unsafe review link: %s', url => {
    expect(googleReviewUrl(url)).toBeNull();
    expect(reviewReminderEmail(reviewReminderNote(url), 'Alex', '', 'Example Motors')).toBeNull();
  });

  it('keeps the helper’s optional name and vehicle contract without inventing an ownership or satisfaction claim', () => {
    const note = reviewReminderNote('https://www.google.com/maps/reviews');
    const copy = reviewReminderEmail(note, '', '', 'Example Motors');
    expect(copy?.message).toContain('Hi there,');
    expect(copy?.message).not.toMatch(/your new car|hope you|enjoying/);
    expect(reviewReminderEmail(note, '', 'Toyota Yaris', 'Example Motors')).toEqual(copy);
    expect(note).toBe('Google review request\nhttps://www.google.com/maps/reviews');
  });
});
