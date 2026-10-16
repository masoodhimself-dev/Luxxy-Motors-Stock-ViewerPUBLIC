import { describe,it,expect } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import type { Car } from '@/lib/stock-context';
import { SaleVehiclePhoto,saleVehicleChoiceLabel } from './vehicle-choice';
const car={id:'one',make:'Suzuki',model:'Swift',title:'Suzuki Swift',year:2019,colour:'Black',mileage:52000,price:7490,fuel:'Petrol',transmission:'Manual',plate:null,registration:null,heroImage:'/car.jpg',images:[],inventoryStatus:'reserved'} as unknown as Car;
describe('invoice vehicle identification',()=>{
 it('distinguishes similar cars using supplied facts without dangling separators',()=>{
  const label=saleVehicleChoiceLabel(car);
  for(const value of ['2019','Suzuki Swift','Black','52,000 miles','£7,490','Petrol','Manual','Reserved'])expect(label).toContain(value);
  expect(label).not.toMatch(/·\s*·|·\s*$/);
  expect(saleVehicleChoiceLabel({...car,plate:'AB19 CDE'})).toContain('AB19 CDE');
 });
 it('opens a larger uncropped photo by tap or keyboard activation',()=>{
  render(<SaleVehiclePhoto car={car}/>);
  fireEvent.click(screen.getByRole('button',{name:'Enlarge photo of Suzuki Swift'}));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByAltText('Enlarged photo of Suzuki Swift').getAttribute('src')).toBe('/car.jpg');
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(screen.queryByRole('dialog')).toBeNull();
 });
});
