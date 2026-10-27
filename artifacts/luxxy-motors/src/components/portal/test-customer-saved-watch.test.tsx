import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { clearTestCustomerShortlist } from '@/lib/test-customer-shortlist-storage';
import { TestCustomerShortlist, TestSaveWatchControls, useTestCustomerShortlist } from './test-customer-saved-watch';

const car = { id: 'car-1', title: 'Ford Focus', make: 'Ford', model: 'Focus' } as Car;
beforeEach(() => { clearTestCustomerShortlist('test-one'); clearTestCustomerShortlist('test-two'); window.sessionStorage.clear(); });

describe('customer practice saves and watches', () => {
  it('keeps real browser shortlists and snapshots unchanged across save, clear and separate sessions', () => {
    const saved = '["real-car"]', snapshots = '{"real-car":{"title":"Real"}}';
    window.localStorage.setItem('luxxy.saved-cars.v1', saved);
    window.localStorage.setItem('luxxy.saved-car-snapshots.v1', snapshots);
    const first = renderHook(({ sessionId }) => useTestCustomerShortlist(sessionId), { initialProps: { sessionId: 'test-one' } });
    const second = renderHook(() => useTestCustomerShortlist('test-two'));
    act(() => { first.result.current.toggleSaved(car.id); first.result.current.startWatch(car.id, 'practice@example.test'); first.result.current.confirmWatch(car.id); });
    expect(first.result.current.savedIds).toEqual([car.id]);
    expect(first.result.current.watches[car.id].confirmed).toBe(true);
    expect(second.result.current.savedIds).toEqual([]);
    expect(second.result.current.watches).toEqual({});
    act(() => { first.result.current.clearSaved(); first.result.current.removeWatch(car.id); });
    expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe(saved);
    expect(window.localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(snapshots);
    act(() => { first.result.current.toggleSaved(car.id); });
    first.rerender({ sessionId: 'test-two' });
    expect(first.result.current.savedIds).toEqual([]);
    expect(first.result.current.watches).toEqual({});
  });

  it('lets staff practise save, watch confirmation and removal without network or live storage writes', () => {
    const network = vi.spyOn(window, 'fetch');
    const localWrites = vi.spyOn(Storage.prototype, 'setItem');
    function Example() {
      const shortlist = useTestCustomerShortlist('test-one');
      return <><TestSaveWatchControls car={car} shortlist={shortlist}/><TestCustomerShortlist cars={[car]} shortlist={shortlist} openCar={vi.fn()}/></>;
    }
    render(<Example/>);
    fireEvent.click(screen.getByRole('button', { name: 'Save Ford Focus to saved cars' }));
    expect(screen.getByRole('heading', { name: 'Saved cars' })).toBeVisible();
    expect(screen.getByText('Ford Focus')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Practise watching' }));
    fireEvent.change(screen.getByLabelText('Email address for practice watch'), { target: { value: 'customer@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Practise request' }));
    expect(screen.getByText(/No actual alerts or emails are sent/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate confirmation' }));
    expect(screen.getByText(/Practice watch confirmed/)).toBeVisible();
    expect(screen.getByText(/Ford Focus — confirmed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear practice saved cars' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop practice watch' })[0]);
    expect(screen.getByText('No practice saved cars.')).toBeVisible();
    expect(screen.getByText('No practice watched cars.')).toBeVisible();
    expect(network).not.toHaveBeenCalled();
    expect(localWrites.mock.calls.every(([key]) => key === 'luxxy.test-customer-shortlist.v1:test-one' || key === 'luxxy.test-customer-snapshots.v1:test-one')).toBe(true);
    network.mockRestore(); localWrites.mockRestore();
  });

  it('restores only the same session after reopening and removes it on cleanup', () => {
    const first = renderHook(() => useTestCustomerShortlist('test-one'));
    act(() => { first.result.current.toggleSaved(car.id); first.result.current.startWatch(car.id, 'practice@example.test'); });
    first.unmount();
    const reopened = renderHook(() => useTestCustomerShortlist('test-one'));
    expect(reopened.result.current.savedIds).toEqual([car.id]);
    expect(reopened.result.current.watches[car.id].email).toBe('practice@example.test');
    reopened.unmount();
    clearTestCustomerShortlist('test-one');
    const cleaned = renderHook(() => useTestCustomerShortlist('test-one'));
    expect(cleaned.result.current.savedIds).toEqual([]);
    expect(cleaned.result.current.watches).toEqual({});
  });

  it('synchronises two open panels in the same test session while keeping other sessions and live storage separate', () => {
    window.localStorage.setItem('luxxy.saved-cars.v1','["live-car"]');
    const first=renderHook(()=>useTestCustomerShortlist('test-one'));
    const second=renderHook(()=>useTestCustomerShortlist('test-one'));
    const other=renderHook(()=>useTestCustomerShortlist('test-two'));
    act(()=>first.result.current.toggleSaved(car.id,car));
    expect(second.result.current.savedIds).toEqual([car.id]);
    act(()=>second.result.current.startWatch(car.id,'practice@example.test'));
    expect(first.result.current.watches[car.id]).toEqual({email:'practice@example.test',confirmed:false});
    act(()=>first.result.current.confirmWatch(car.id));
    expect(second.result.current.watches[car.id].confirmed).toBe(true);
    act(()=>second.result.current.clearSaved());
    expect(first.result.current.savedIds).toEqual([]);
    expect(other.result.current.savedIds).toEqual([]);
    expect(other.result.current.watches).toEqual({});
    expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["live-car"]');
  });
  it('updates both concurrently visible customer panels after saving and watching in either one', () => {
    function Panel({label}:{label:string}) { const shortlist=useTestCustomerShortlist('test-one'); return <section aria-label={label}><TestSaveWatchControls car={car} shortlist={shortlist}/></section>; }
    render(<><Panel label="First panel"/><Panel label="Second panel"/></>);
    const first=within(screen.getByRole('region',{name:'First panel'}));
    const second=within(screen.getByRole('region',{name:'Second panel'}));
    fireEvent.click(first.getByRole('button',{name:'Save Ford Focus to saved cars'}));
    expect(second.getByRole('button',{name:'Remove Ford Focus from saved cars'})).toBeVisible();
    fireEvent.click(second.getByRole('button',{name:'Practise watching'}));
    fireEvent.change(second.getByLabelText('Email address for practice watch'),{target:{value:'practice@example.test'}});
    fireEvent.click(second.getByRole('button',{name:'Practise request'}));
    expect(first.getByText(/Practice watch awaiting confirmation/)).toBeVisible();
    fireEvent.click(first.getByRole('button',{name:'Simulate confirmation'}));
    expect(second.getByText(/Practice watch confirmed/)).toBeVisible();
    fireEvent.click(second.getByRole('button',{name:'Remove Ford Focus from saved cars'}));
    expect(first.getByRole('button',{name:'Save Ford Focus to saved cars'})).toBeVisible();
  });
});
