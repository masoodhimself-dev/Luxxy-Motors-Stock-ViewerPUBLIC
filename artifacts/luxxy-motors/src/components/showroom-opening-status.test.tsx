import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShowroomOpeningStatus } from './showroom-opening-status';
const state = vi.hoisted(() => ({ error: false, hours: [{days: 'Monday – Saturday', times: '10:00 – 18:00'}, {days: 'Sunday', times: 'Closed'}] }));
vi.mock('@/lib/dealer-settings-context', () => ({useDealerSettings: () => ({settings: {hours: state.hours}, isLoading: false, isError: state.error})}));
afterEach(() => {cleanup(); vi.useRealTimers(); state.error = false;});
it('uses UK opening hours and next opening without network polling', () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
 const {unmount} = render(<ShowroomOpeningStatus/>);
 expect(screen.getByText('Open today until 18:00')).toBeVisible();
 unmount(); vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
 render(<ShowroomOpeningStatus/>);
 expect(screen.getByText(/Opens tomorrow at 10:00/)).toBeVisible();
});
it('does not make an opening claim when settings cannot load', () => {
 state.error = true;
 const {container} = render(<ShowroomOpeningStatus/>);
 expect(container).toBeEmptyDOMElement();
});
