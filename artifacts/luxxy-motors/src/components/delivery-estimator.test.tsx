import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({settings:{delivery:{enabled:true},deliveryPricing:{enabled:true,basePrice:'50.00',pricePerMile:'1.50'},address:{postcode:'HA2 7LU'}},fetch:vi.fn()}));
vi.mock('@/lib/dealer-settings-context',()=>({useDealerSettings:()=>({settings:state.settings})}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.fetch(...args)}));
vi.mock('./postcode-field',()=>({PostcodeField:({label,value,onChange}:any)=><label>{label}<input value={value} onChange={e=>onChange(e.target.value)}/></label>}));
import {DeliveryEstimator} from './delivery-estimator';
const quote={postcode:'SW1A 1AA',roadMiles:23.4,basePricePence:5000,pricePerMilePence:150,mileageChargePence:3510,totalPence:8510,distanceBasis:'driving',estimated:true};
beforeEach(()=>{state.settings.delivery.enabled=true;state.settings.deliveryPricing.enabled=true;state.settings.deliveryPricing.basePrice="50.00";state.settings.deliveryPricing.pricePerMile="1.50";state.settings.address.postcode="HA2 7LU";state.fetch.mockReset();state.fetch.mockResolvedValue(quote);});
function open(){fireEvent.click(screen.getByText('Estimate your delivery cost'));}
it('requests the road estimate only when asked and displays a matching price breakdown',async()=>{
 render(<DeliveryEstimator/>);open();expect(state.fetch).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Delivery postcode'),{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));await screen.findByText('£85.10');expect(screen.getByText(/23.4 road miles/)).toBeVisible();expect(screen.getByText('£35.10')).toBeVisible();expect(state.fetch.mock.calls[0][0]).toBe('/api/postcodes/delivery-estimate?postcode=SW1A1AA');
 expect(screen.getByText(/Nothing is booked or charged/)).toBeVisible();
});
it('does not substitute straight-line distance or a zero price when road routing fails',async()=>{
 state.fetch.mockRejectedValue({data:{code:'routing_not_configured'}});render(<DeliveryEstimator/>);open();fireEvent.change(screen.getByLabelText('Delivery postcode'),{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));await screen.findByRole('alert');expect(screen.queryByText('£0.00')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Calculate delivery'})).toBeEnabled();
});
it('ignores a stale quote after the customer changes their postcode',async()=>{
 let resolve:(value:unknown)=>void=()=>{};state.fetch.mockImplementation(()=>new Promise(r=>resolve=r));render(<DeliveryEstimator/>);open();const field=screen.getByLabelText('Delivery postcode');fireEvent.change(field,{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));fireEvent.change(field,{target:{value:'N1 1AA'}});resolve(quote);await waitFor(()=>expect(screen.queryByText('£85.10')).not.toBeInTheDocument());
});
it('keeps the calculator absent when delivery or estimation is disabled',()=>{
 state.settings.deliveryPricing.enabled=false;const {rerender}=render(<DeliveryEstimator/>);expect(screen.queryByText('Estimate your delivery cost')).not.toBeInTheDocument();state.settings.deliveryPricing.enabled=true;state.settings.delivery.enabled=false;rerender(<DeliveryEstimator/>);expect(screen.queryByText('Estimate your delivery cost')).not.toBeInTheDocument();expect(state.fetch).not.toHaveBeenCalled();
});

async function calculate() {
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "SW1A1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  await screen.findByText("£85.10");
}
it("shows the GBP car, delivery and total, and includes them only after the explicit button", async () => {
  const onEnquire = vi.fn();
  render(
    <DeliveryEstimator
      expanded
      vehiclePrice={2790}
      currency="GBP"
      onEnquire={onEnquire}
    />,
  );
  await calculate();
  expect(screen.getByText("Car price")).toBeVisible();
  expect(screen.getByText("£2,790.00")).toBeVisible();
  expect(screen.getByText("Estimated total")).toBeVisible();
  expect(screen.getByText("£2,875.10")).toBeVisible();
  expect(onEnquire).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Include estimate in my enquiry" }),
  );
  expect(onEnquire).toHaveBeenCalledExactlyOnceWith(
    "I’m interested in delivery to SW1A 1AA (23.4 one-way road miles).\nCar price: £2,790.00\nEstimated delivery: £85.10\nEstimated total for car and delivery: £2,875.10\nPlease confirm the final price and delivery availability. This is an estimate; nothing is booked or charged.",
  );
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("recalculates the combined total locally from the current vehicle price and uses the latest callback", async () => {
  const oldCallback = vi.fn(),
    onEnquire = vi.fn();
  const { rerender } = render(
    <DeliveryEstimator
      expanded
      vehiclePrice={2790}
      currency="GBP"
      onEnquire={oldCallback}
    />,
  );
  await calculate();
  rerender(
    <DeliveryEstimator
      expanded
      vehiclePrice={2999.99}
      currency="GBP"
      onEnquire={onEnquire}
    />,
  );
  expect(screen.queryByText("£2,875.10")).not.toBeInTheDocument();
  expect(screen.getByText("£3,085.09")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Include estimate in my enquiry" }),
  );
  expect(oldCallback).not.toHaveBeenCalled();
  expect(onEnquire.mock.calls[0][0]).toContain("Car price: £2,999.99");
  expect(onEnquire.mock.calls[0][0]).toContain("£3,085.09");
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it.each([null, undefined, "EUR", "USD"])(
  "keeps delivery alone for unknown or non-GBP currency %s",
  async (currency) => {
    const onEnquire = vi.fn();
    render(
      <DeliveryEstimator
        expanded
        vehiclePrice={2790}
        currency={currency}
        onEnquire={onEnquire}
      />,
    );
    await calculate();
    expect(screen.queryByText("Car price")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Include estimate in my enquiry" }),
    );
    expect(onEnquire.mock.calls[0][0]).toContain("Estimated delivery: £85.10");
    expect(onEnquire.mock.calls[0][0]).not.toContain("Car price:");
  },
);
it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
  "never combines an invalid or unsafe car price %s",
  async (vehiclePrice) => {
    render(
      <DeliveryEstimator expanded vehiclePrice={vehiclePrice} currency="GBP" />,
    );
    await calculate();
    expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Include estimate in my enquiry" }),
    ).not.toBeInTheDocument();
  },
);
it("removes an existing quote and enquiry button immediately when the postcode changes", async () => {
  const onEnquire = vi.fn();
  render(
    <DeliveryEstimator
      expanded
      vehiclePrice={2790}
      currency="GBP"
      onEnquire={onEnquire}
    />,
  );
  await calculate();
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "N1 1AA" },
  });
  expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Include estimate in my enquiry" }),
  ).not.toBeInTheDocument();
  expect(onEnquire).not.toHaveBeenCalled();
});
it.each(["tariff", "showroom"] as const)(
  "invalidates a displayed quote when the %s changes without requesting a new route",
  async (changed) => {
    const onEnquire = vi.fn();
    const { rerender } = render(
      <DeliveryEstimator
        expanded
        vehiclePrice={2790}
        currency="GBP"
        onEnquire={onEnquire}
      />,
    );
    await calculate();
    if (changed === "tariff")
      state.settings.deliveryPricing.basePrice = "60.00";
    else state.settings.address.postcode = "UB3 3EP";
    rerender(
      <DeliveryEstimator
        expanded
        vehiclePrice={2790}
        currency="GBP"
        onEnquire={onEnquire}
      />,
    );
    expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Include estimate in my enquiry" }),
    ).not.toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(onEnquire).not.toHaveBeenCalled();
  },
);
it("ignores an old failure after a new successful postcode request", async () => {
  let reject: (value: unknown) => void = () => {};
  state.fetch.mockImplementationOnce(
    () => new Promise((_resolve, rejectPromise) => (reject = rejectPromise)),
  );
  render(<DeliveryEstimator expanded />);
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "N1 1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  await calculate();
  await act(async () => reject(new Error("Old request failed")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("£85.10")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Calculate delivery" }),
  ).toBeEnabled();
});
it("rejects late quotes and failures after a showroom change", async () => {
  let resolve: (value: unknown) => void = () => {};
  state.fetch.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const { rerender } = render(
    <DeliveryEstimator expanded onEnquire={vi.fn()} />,
  );
  fireEvent.change(screen.getByLabelText("Delivery postcode"), {
    target: { value: "SW1A1AA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
  state.settings.address.postcode = "UB3 3EP";
  rerender(<DeliveryEstimator expanded onEnquire={vi.fn()} />);
  await act(async () => resolve(quote));
  expect(screen.queryByText("£85.10")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Calculate delivery" }),
  ).toBeEnabled();
});
it.each([
  { ...quote, totalPence: 8510.5 },
  { ...quote, totalPence: -1 },
  { ...quote, mileageChargePence: 3500 },
  { ...quote, postcode: "N1 1AA" },
  { ...quote, currency: "EUR" },
  { ...quote, roadMiles: -1 },
])(
  "rejects an inconsistent or non-driving-money response %#",
  async (badQuote) => {
    state.fetch.mockResolvedValue(badQuote);
    render(<DeliveryEstimator expanded onEnquire={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Delivery postcode"), {
      target: { value: "SW1A1AA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Calculate delivery" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: "Include estimate in my enquiry" }),
    ).not.toBeInTheDocument();
  },
);


it.each(["+ VAT", "exVAT", "VAT qualifying", "unknown"])("keeps delivery only and qualifies an unconfirmed car-price basis: %s", async priceType => {
  const onEnquire=vi.fn();render(<DeliveryEstimator expanded vehiclePrice={2790} currency="GBP" priceType={priceType} onEnquire={onEnquire}/>);await calculate();
  expect(screen.queryByText("Car price")).not.toBeInTheDocument();expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();expect(screen.getByText(/This estimate covers delivery only/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Include estimate in my enquiry"}));expect(onEnquire).toHaveBeenCalledOnce();expect(onEnquire.mock.calls[0][0]).toContain("Estimated delivery: £85.10");expect(onEnquire.mock.calls[0][0]).toContain("confirm the full car price");expect(onEnquire.mock.calls[0][0]).not.toContain("Car price:");expect(onEnquire.mock.calls[0][0]).not.toContain("Estimated total for car and delivery:");
});
it("updates a changed price basis without another route request or stale combined enquiry", async () => {
  const onEnquire=vi.fn();const {rerender}=render(<DeliveryEstimator expanded vehiclePrice={2790} currency="GBP" priceType="fixed" onEnquire={onEnquire}/>);await calculate();expect(screen.getByText("£2,875.10")).toBeVisible();
  rerender(<DeliveryEstimator expanded vehiclePrice={2790} currency="GBP" priceType="+VAT" onEnquire={onEnquire}/>);expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Include estimate in my enquiry"}));expect(onEnquire.mock.calls[0][0]).not.toContain("Car price:");expect(onEnquire.mock.calls[0][0]).toContain("excludes VAT");
  rerender(<DeliveryEstimator expanded vehiclePrice={2790} currency="GBP" priceType="VAT included" onEnquire={onEnquire}/>);expect(screen.getByText("£2,875.10")).toBeVisible();expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("shows delivery alone for a price-on-application/zero-price car", async () => {
  render(<DeliveryEstimator expanded vehiclePrice={0} currency="GBP" priceType="fixed"/>);await calculate();expect(screen.queryByText("Car price")).not.toBeInTheDocument();expect(screen.queryByText("Estimated total")).not.toBeInTheDocument();
});


it("shows the official Cazoo retail car plus delivery total without relaxing VAT or POA safeguards", async () => {
  state.settings.deliveryPricing.basePrice="40.00";state.settings.deliveryPricing.pricePerMile="1.20";
  state.fetch.mockResolvedValue({...quote,roadMiles:7.8,basePricePence:4000,pricePerMilePence:120,mileageChargePence:936,totalPence:4936});
  const onEnquire=vi.fn();render(<DeliveryEstimator expanded vehiclePrice={8790} currency="GBP" priceType="retail" onEnquire={onEnquire}/>);
  fireEvent.change(screen.getByLabelText("Delivery postcode"),{target:{value:"SW1A1AA"}});fireEvent.click(screen.getByRole("button",{name:"Calculate delivery"}));
  await screen.findByText("£8,839.36");expect(screen.getByText("£8,790.00")).toBeVisible();expect(screen.getByText("£49.36")).toBeVisible();expect(onEnquire).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Include estimate in my enquiry"}));expect(onEnquire.mock.calls[0][0]).toContain("Estimated total for car and delivery: £8,839.36");expect(state.fetch).toHaveBeenCalledTimes(1);
});
