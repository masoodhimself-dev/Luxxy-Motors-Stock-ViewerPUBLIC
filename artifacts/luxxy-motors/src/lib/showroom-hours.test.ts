import { it, expect } from 'vitest';
import { showroomHours } from './showroom-hours';
const hours=[{days:'Monday – Friday',times:'09:00 – 18:00'},{days:'Saturday',times:'10:00 – 14:00'},{days:'Sunday',times:'Closed'}];
it('uses London time including daylight saving and exact closing boundary',()=>{
 expect(showroomHours(hours,new Date('2026-09-28T08:00:00Z')).state).toBe('open');
 expect(showroomHours(hours,new Date('2026-09-28T17:00:00Z'))).toEqual({state:'closed',next:'tomorrow at 09:00 (UK time)'});
 expect(showroomHours(hours,new Date('2026-12-28T08:30:00Z'))).toEqual({state:'closed',next:'today at 09:00 (UK time)'});
});
it('skips closed Sundays and does not invent hours for appointment-only schedules',()=>{
 expect(showroomHours(hours,new Date('2026-09-27T12:00:00Z'))).toEqual({state:'closed',next:'tomorrow at 09:00 (UK time)'});
 expect(showroomHours([{days:'Monday',times:'By appointment'}],new Date('2026-09-28T12:00:00Z')).state).toBe('unknown');
});
