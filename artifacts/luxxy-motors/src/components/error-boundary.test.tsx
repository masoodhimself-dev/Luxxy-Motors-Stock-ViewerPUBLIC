import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';

afterEach(cleanup);

test('the crash fallback offers recovery without displaying internal exception details', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let broken = true;
  function Page() {
    if (broken) throw new Error('Database customer token private diagnostic');
    return <p>Recovered page</p>;
  }
  try {
    render(<ErrorBoundary><Page /></ErrorBoundary>);
    expect(screen.getByRole('heading', { name: 'This page couldn’t load', level: 1 })).toBeVisible();
    expect(screen.queryByText('Database customer token private diagnostic')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact the showroom' })).toHaveAttribute('href', '/contact');
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered page')).toBeVisible();
  } finally { consoleError.mockRestore(); }
});
