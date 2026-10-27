import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { Car } from '@/lib/stock-context';
import { vehicleDisplayTitle } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { readTestCustomerShortlist, subscribeTestCustomerShortlist, writeTestCustomerShortlist, type TestShortlistState } from '@/lib/test-customer-shortlist-storage';
import { rememberSavedCar, forgetSavedSnapshots } from '@/lib/saved-car-snapshots';

/** Isolated session storage, with in-memory fallback; never touches the live shortlist. */
export function useTestCustomerShortlist(sessionId: string) {
  const state = useSyncExternalStore(notify=>subscribeTestCustomerShortlist(sessionId,notify),()=>readTestCustomerShortlist(sessionId),()=>readTestCustomerShortlist(sessionId));
  const update = (fn: (current: TestShortlistState) => TestShortlistState) => writeTestCustomerShortlist(fn(readTestCustomerShortlist(sessionId)));
  return {
    savedIds: state.savedIds,
    watches: state.watches,
    toggleSaved: (id: string, car?:Car) => { if(readTestCustomerShortlist(sessionId).savedIds.includes(id))forgetSavedSnapshots([id],sessionId);else if(car)rememberSavedCar(car,sessionId); update(current => ({ ...current, savedIds: current.savedIds.includes(id) ? current.savedIds.filter(saved => saved !== id) : [id, ...current.savedIds] })); },
    removeSaved: (ids: string[]) => { forgetSavedSnapshots(ids,sessionId); update(current => ({ ...current, savedIds: current.savedIds.filter(id => !ids.includes(id)) })); },
    clearSaved: () => { forgetSavedSnapshots(undefined,sessionId); update(current => ({ ...current, savedIds: [] })); },
    startWatch: (id: string, email: string) => update(current => ({ ...current, watches: { ...current.watches, [id]: { email, confirmed: false } } })),
    confirmWatch: (id: string) => update(current => current.watches[id] ? { ...current, watches: { ...current.watches, [id]: { ...current.watches[id], confirmed: true } } } : current),
    removeWatch: (id: string) => update(current => { const watches = { ...current.watches }; delete watches[id]; return { ...current, watches }; }),
  };
}
type Shortlist = ReturnType<typeof useTestCustomerShortlist>;

export function TestSaveCarButton({ car, shortlist }: { car: Car; shortlist: Shortlist }) {
  const saved = shortlist.savedIds.includes(car.id);
  const title = vehicleDisplayTitle(car);
  return <Button type="button" variant="outline" onClick={() => shortlist.toggleSaved(car.id,car)} aria-label={`${saved ? 'Remove' : 'Save'} ${title}${saved ? ' from saved cars' : ' to saved cars'}`}>{saved ? 'Saved' : 'Save car'}</Button>;
}

export function TestSaveWatchControls({ car, shortlist, showSave = true }: { car: Car; shortlist: Shortlist; showSave?: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const emailId=useId();
  const watch = shortlist.watches[car.id];
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!email.trim()) return; shortlist.startWatch(car.id, email.trim()); setShowForm(false); };
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {showSave && <TestSaveCarButton car={car} shortlist={shortlist}/>}
      {!watch && <Button type="button" variant="outline" onClick={() => setShowForm(!showForm)} aria-expanded={showForm}>Practise watching</Button>}
      {watch && <Button type="button" variant="outline" onClick={() => shortlist.removeWatch(car.id)}>Stop practice watch</Button>}
    </div>
    {showForm && !watch && <form onSubmit={submit} className="space-y-2 rounded border p-3">
      <p className="text-sm">Practice only: no customer subscription or email will be created.</p>
      <label className="block text-sm" htmlFor={emailId}>Email address for practice watch</label>
      <input className="w-full rounded border bg-background p-2" id={emailId} type="email" maxLength={320} required value={email} onChange={event => setEmail(event.target.value)} />
      <Button type="submit">Practise request</Button>
    </form>}
    {watch && <div className="rounded bg-muted p-3 text-sm"><p>{watch.confirmed ? 'Practice watch confirmed' : 'Practice watch awaiting confirmation'} for {watch.email}. No actual alerts or emails are sent.</p>{!watch.confirmed && <Button type="button" variant="outline" className="mt-2" onClick={() => shortlist.confirmWatch(car.id)}>Simulate confirmation</Button>}</div>}
  </div>;
}

export function TestCustomerShortlist({ cars, shortlist, openCar }: { cars: Car[]; shortlist: Shortlist; openCar: (car: Car) => void }) {
  const saved = shortlist.savedIds.map(id => cars.find(car => car.id === id)).filter((car): car is Car => Boolean(car));
  const watched = Object.keys(shortlist.watches).map(id => cars.find(car => car.id === id)).filter((car): car is Car => Boolean(car));
  const missingSaved = shortlist.savedIds.filter(id => !cars.some(car => car.id === id));
  const missingWatches = Object.keys(shortlist.watches).filter(id => !cars.some(car => car.id === id));
  return <div className="space-y-6">
    <div><h2 className="text-xl font-semibold">Saved cars</h2><p className="text-sm text-muted-foreground">Practice saves last until this test ends in this browser tab. Your real saved cars are unchanged.</p></div>
    {shortlist.savedIds.length ? <><ul className="space-y-2">{saved.map(car => <li key={car.id} className="flex flex-wrap items-center gap-2"><span>{vehicleDisplayTitle(car)}</span><Button type="button" variant="outline" onClick={() => openCar(car)}>View</Button><Button type="button" variant="outline" onClick={() => shortlist.toggleSaved(car.id)}>Remove</Button></li>)}{missingSaved.map(id => <li key={id} className="flex flex-wrap items-center gap-2"><span>Car no longer available</span><Button type="button" variant="outline" onClick={() => shortlist.toggleSaved(id)}>Remove</Button></li>)}</ul><Button type="button" variant="outline" onClick={shortlist.clearSaved}>Clear practice saved cars</Button></> : <p>No practice saved cars.</p>}
    <div><h2 className="text-xl font-semibold">Practice watched cars</h2><p className="text-sm text-muted-foreground">This is a simulation only. No actual watches or alerts are created.</p></div>
    {watched.length || missingWatches.length ? <ul className="space-y-2">{watched.map(car => <li key={car.id} className="flex flex-wrap items-center gap-2"><span>{vehicleDisplayTitle(car)} — {shortlist.watches[car.id].confirmed ? 'confirmed' : 'awaiting confirmation'}</span><Button type="button" variant="outline" onClick={() => openCar(car)}>View</Button><Button type="button" variant="outline" onClick={() => shortlist.removeWatch(car.id)}>Stop practice watch</Button></li>)}{missingWatches.map(id => <li key={id} className="flex flex-wrap items-center gap-2"><span>Car no longer available</span><Button type="button" variant="outline" onClick={() => shortlist.removeWatch(id)}>Stop practice watch</Button></li>)}</ul> : <p>No practice watched cars.</p>}
  </div>;
}

export function TestCustomerWatches({cars, shortlist, openCar}: {cars: Car[]; shortlist: Shortlist; openCar: (car: Car) => void}) {
  const ids = Object.keys(shortlist.watches);
  return <section aria-label="Practice watched cars" className="space-y-3 p-4"><h2 className="text-xl font-semibold">Practice watched cars</h2><p className="text-sm">Simulation only: no customer watches, emails or alerts are created.</p>{ids.length ? <ul className="space-y-2">{ids.map(id => { const car=cars.find(item=>item.id===id); return <li key={id} className="flex flex-wrap items-center gap-2"><span>{car ? vehicleDisplayTitle(car) : 'Car no longer available'} — {shortlist.watches[id].confirmed ? 'confirmed' : 'awaiting confirmation'}</span>{car && <Button type="button" variant="outline" onClick={()=>openCar(car)}>View car</Button>}<Button type="button" variant="outline" onClick={()=>shortlist.removeWatch(id)}>Stop practice watch</Button></li>; })}</ul> : <p>No practice watched cars.</p>}</section>;
}
