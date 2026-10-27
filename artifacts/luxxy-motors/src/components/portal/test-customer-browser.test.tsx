import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { TestCustomerBrowser } from './test-customer-browser';

vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock:{cars:[{id:'a',title:'Ford Focus',make:'Ford',model:'Focus',price:5000,images:[],inventoryStatus:'available',fuel:'Petrol',transmission:'Manual'},{id:'b',title:'BMW 3 Series',make:'BMW',model:'3 Series',price:9000,images:[],inventoryStatus:'available',fuel:'Diesel',transmission:'Automatic'}]},isLoading:false,error:null})}));
const policy=vi.hoisted(()=>({enabled:true}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({enabled:()=>policy.enabled})}));
vi.mock('@/pages/enquire',()=>({EnquirePage:({testMode}:any)=><div data-testid="website-form">{testMode.type} for {testMode.vehicle.title}<button onClick={()=>testMode.submit({vehicleId:testMode.vehicle.id,type:testMode.type})}>Submit test</button></div>}));
const session={sessionId:'sandbox',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'copy',title:'Ford Focus',registration:'AB12 CDE',price:5000},customer:{name:'Customer',phone:'07700900123',email:'test@example.test',address:''}};
const config={...dealerConfig,testDriveBooking:{enabled:true},partExchange:{enabled:true}};

it('navigates and filters stock in memory without changing live browser state',()=>{
 localStorage.setItem('sentinel','unchanged');sessionStorage.setItem('sentinel','unchanged');const initialUrl=window.location.href;
 const submit=vi.fn();render(<TestCustomerBrowser session={session} config={config as any} submit={submit}/>);
 const browser=screen.getByRole('region',{name:'Customer website test browser'});
 fireEvent.click(within(browser).getByRole('button',{name:'Browse stock'}));
 expect(within(browser).getByText('2 cars')).toBeVisible();
 fireEvent.change(within(browser).getByRole('textbox',{name:'Search the showroom'}),{target:{value:'BMW'}});
 expect(within(browser).getByText('1 car')).toBeVisible();expect(within(browser).queryByText('Ford Focus',{selector:'h3'})).not.toBeInTheDocument();
 fireEvent.click(within(browser).getByRole('button',{name:'View car'}));expect(within(browser).getByRole('heading',{name:'BMW 3 Series'})).toBeVisible();
 fireEvent.click(within(browser).getByRole('button',{name:'Enquire about this car'}));expect(within(browser).getByTestId('website-form')).toHaveTextContent('general for BMW 3 Series');fireEvent.click(within(browser).getByRole('button',{name:'Submit test'}));expect(submit).toHaveBeenLastCalledWith({vehicleId:'b',type:'general'});
 fireEvent.click(within(browser).getByRole('button',{name:'Test drive'}));expect(within(browser).getByTestId('website-form')).toHaveTextContent('viewing for BMW 3 Series');fireEvent.click(within(browser).getByRole('button',{name:'Submit test'}));expect(submit).toHaveBeenLastCalledWith({vehicleId:'b',type:'viewing'});
 fireEvent.click(within(browser).getByRole('button',{name:'Part exchange'}));expect(within(browser).getByTestId('website-form')).toHaveTextContent('part_exchange for BMW 3 Series');fireEvent.click(within(browser).getByRole('button',{name:'Submit test'}));expect(submit).toHaveBeenLastCalledWith({vehicleId:'b',type:'part_exchange'});
 expect(window.location.href).toBe(initialUrl);expect(localStorage.getItem('sentinel')).toBe('unchanged');expect(sessionStorage.getItem('sentinel')).toBe('unchanged');
});

it('practises saving and watching a browsed vehicle without changing live saved cars',()=>{
 const original='["live-car"]',snapshot='{"live-car":{"price":1234}}';
 window.localStorage.setItem('luxxy.saved-cars.v1',original);
 window.localStorage.setItem('luxxy.saved-car-snapshots.v1',snapshot);
 render(<TestCustomerBrowser session={session} config={config as any} submit={vi.fn()}/>);
 const browser=screen.getByRole('region',{name:'Customer website test browser'});
 fireEvent.click(within(browser).getByRole('button',{name:'Save Ford Focus to saved cars'}));
 fireEvent.click(within(browser).getByRole('button',{name:'Saved & practice watches (1)'}));
 expect(within(browser).getByRole('heading',{name:'Saved cars'})).toBeVisible();
 expect(within(browser).getByText('Ford Focus')).toBeVisible();
 fireEvent.click(within(browser).getByRole('button',{name:'View'}));
 fireEvent.click(within(browser).getByRole('button',{name:'Practise watching'}));
 fireEvent.change(within(browser).getByLabelText('Email address for practice watch'),{target:{value:'customer@example.test'}});
 fireEvent.click(within(browser).getByRole('button',{name:'Practise request'}));
 fireEvent.click(within(browser).getByRole('button',{name:'Simulate confirmation'}));
 fireEvent.click(within(browser).getByRole('button',{name:'Saved & practice watches (1)'}));
 expect(within(browser).getByText('Ford Focus — confirmed')).toBeVisible();
 expect(within(browser).getByText(/No actual watches or alerts are created/)).toBeVisible();
 fireEvent.click(within(browser).getByRole('button',{name:'Clear practice saved cars'}));
 fireEvent.click(within(browser).getByRole('button',{name:'Stop practice watch'}));
 expect(within(browser).getByText('No practice saved cars.')).toBeVisible();
 expect(within(browser).getByText('No practice watched cars.')).toBeVisible();
 expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe(original);
 expect(window.localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(snapshot);
});

it('hides booking and part exchange links when test settings disable them',()=>{
 const disabled={...config,testDriveBooking:{...config.testDriveBooking,enabled:false},partExchange:{...config.partExchange,enabled:false}};
 render(<TestCustomerBrowser session={session} config={disabled as any} submit={vi.fn()}/>);
 const browser=screen.getByRole('region',{name:'Customer website test browser'});
 expect(within(browser).queryByRole('button',{name:'Test drive'})).not.toBeInTheDocument();
 expect(within(browser).queryByRole('button',{name:'Part exchange'})).not.toBeInTheDocument();
 fireEvent.click(within(browser).getAllByRole('button',{name:'View car'})[0]);
 expect(within(browser).queryByRole('button',{name:'Book a test drive'})).not.toBeInTheDocument();
 expect(within(browser).queryByRole('button',{name:'Part exchange'})).not.toBeInTheDocument();
});

it('hides test booking and part exchange when platform policy disables them',()=>{
 policy.enabled=false;
 try {
  render(<TestCustomerBrowser session={session} config={config as any} submit={vi.fn()}/>);
  const browser=screen.getByRole('region',{name:'Customer website test browser'});
  expect(within(browser).queryByRole('button',{name:'Test drive'})).not.toBeInTheDocument();expect(within(browser).queryByRole('button',{name:'Part exchange'})).not.toBeInTheDocument();
  fireEvent.click(within(browser).getAllByRole('button',{name:'View car'})[0]);
  expect(within(browser).queryByRole('button',{name:'Book a test drive'})).not.toBeInTheDocument();expect(within(browser).queryByRole('button',{name:'Part exchange'})).not.toBeInTheDocument();
 } finally {policy.enabled=true;}
});
