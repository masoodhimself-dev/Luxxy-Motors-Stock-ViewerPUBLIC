import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  VehicleVideoEditor,
  PublicVehicleVideo,
  inspectVideoFile,
} from "./vehicle-video";
const state = vi.hoisted(() => ({ api: vi.fn(), videos: [] as any[] }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.api(...args),
}));
vi.mock("@/components/share-qr", () => ({
  ShareQr: ({ label, url, whatsapp }: { label: string; url?: string; whatsapp?: boolean }) => (
    <button data-url={url} data-whatsapp={whatsapp}>{label}</button>
  ),
}));
function mount(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.videos = [];
  state.api.mockReset();
  state.api.mockImplementation(async (path: string, options?: RequestInit) =>
    options
      ? {}
      : {
          enabled: true,
          videos: state.videos,
          shareUrl: "https://dealer.example/vehicle/car?video=1#walkaround",
        },
  );
});
it("draft video requires staff review before publishing and does not autoplay", async () => {
  state.videos = [
    {
      id: "draft",
      status: "ready",
      published: false,
      revision: 3,
      durationMs: 10000,
      byteSize: 1000000,
      previewUrl: "/private-video",
    },
  ];
  const view = mount(<VehicleVideoEditor vehicleId="car" writable />);
  await screen.findByText("Draft preview");
  const publish = screen.getByRole("button", { name: "Publish video" });
  expect(publish).toBeDisabled();
  expect(view.container.querySelector("video")).not.toHaveAttribute("autoplay");
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have reviewed this video/ }),
  );
  fireEvent.click(publish);
  await waitFor(() =>
    expect(
      state.api.mock.calls.some(([path]) => String(path).endsWith("/publish")),
    ).toBe(true),
  );
  const call = state.api.mock.calls.find(([path]) =>
    String(path).endsWith("/publish"),
  )!;
  expect(JSON.parse(call[1].body)).toEqual({
    expectedRevision: 3,
    confirm: true,
  });
});
it("an existing published clip stays separate from a new draft", async () => {
  state.videos = [
    {
      id: "new",
      status: "ready",
      published: false,
      revision: 1,
      previewUrl: "/draft",
      durationMs: 1000,
      byteSize: 1000,
    },
    {
      id: "old",
      status: "ready",
      published: true,
      revision: 2,
      previewUrl: "/old",
      durationMs: 1000,
      byteSize: 1000,
    },
  ];
  mount(<VehicleVideoEditor vehicleId="car" writable />);
  await screen.findByText("Shareable video");
  const whatsapp = new URL(
    screen
      .getByRole("button", { name: "WhatsApp QR" })
      .getAttribute("data-url")!,
  );
  expect(whatsapp.href).toBe("https://dealer.example/vehicle/car?video=1#walkaround");
  expect(screen.getByRole("button",{name:"WhatsApp QR"})).toHaveAttribute("data-whatsapp","true");
  expect(
    screen.getByRole("button", { name: "Email video link" }),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: "Email video link" })).toBeNull();
  expect(screen.getByText("Draft preview")).toBeVisible();
  expect(
    screen.getByText(/current published video stays available/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Video QR / share link" }),
  ).toBeVisible();
});
it("prepares video emails inside the dealership app instead of opening an external email client",async()=>{
  state.videos=[{id:"live",status:"ready",published:true,revision:1,previewUrl:"/live",durationMs:1000,byteSize:1000}];
  const view=mount(<VehicleVideoEditor vehicleId="car" writable/>);
  fireEvent.click(await screen.findByRole("button",{name:"Email video link"}));
  expect(await screen.findByRole("heading",{name:"Prepare customer email"})).toBeVisible();
  expect(screen.getByRole("textbox",{name:"Customer email"})).toBeVisible();
  expect(view.container.querySelector('a[href^="mailto:"]')).toBeNull();
  expect(state.api.mock.calls.some(([,options])=>options?.method==="POST")).toBe(false);
});
it("read-only staff see previews without publication or upload controls", async () => {
  state.videos = [
    {
      id: "new",
      status: "ready",
      published: false,
      revision: 1,
      previewUrl: "/draft",
      durationMs: 1000,
      byteSize: 1000,
    },
  ];
  mount(<VehicleVideoEditor vehicleId="car" writable={false} />);
  await screen.findByText("Draft preview");
  expect(screen.queryByRole("button", { name: "Publish video" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Upload video" })).toBeNull();
});
it("unconfigured storage disables uploads and explains the requirement", async () => {
  state.api.mockResolvedValue({ enabled: false, videos: [] });
  mount(<VehicleVideoEditor vehicleId="car" writable />);
  await screen.findByText(/storage needs connecting/);
  expect(screen.getByRole("button", { name: "Upload video" })).toBeDisabled();
});
it("the public player only renders published API results, with inline playback and sharing", async () => {
  state.api.mockResolvedValue({
    video: {
      url: "/public-clip",
      shareUrl: "https://dealer.example/vehicle/car?video=1#walkaround",
    },
  });
  const view = mount(<PublicVehicleVideo vehicleId="car" />);
  await screen.findByRole("region", { name: "Watch car video" });
  expect(view.container.querySelector("video")).toHaveAttribute("playsinline");
  expect(view.container.querySelector("video")).toHaveAttribute(
    "preload",
    "none",
  );
  expect(screen.getByRole("button", { name: "Share video" })).toBeVisible();
});
it("unpublished or unavailable videos leave the customer gallery usable", async () => {
  state.api.mockResolvedValue({ video: null });
  const view = mount(<PublicVehicleVideo vehicleId="car" />);
  await waitFor(() => expect(state.api).toHaveBeenCalled());
  expect(view.container.querySelector("video")).toBeNull();
});
it("client preflight refuses unsupported and oversized sources before decoding", async () => {
  await expect(
    inspectVideoFile(new File(["fake"], "test.txt", { type: "text/plain" })),
  ).rejects.toThrow(/MP4/);
  const file = new File(["fake"], "test.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: 201 * 1024 * 1024 });
  await expect(inspectVideoFile(file)).rejects.toThrow(/200 MB/);
});

it("offers an authenticated phone recording QR and no desktop recorder", async () => {
  mount(<VehicleVideoEditor vehicleId="car" writable />);
  const qr = await screen.findByRole("button",{name:"Record on phone · QR"});
  const link = new URL(qr.getAttribute("data-url")!);
  expect(link.pathname).toBe("/portal");
  expect(link.searchParams.get("vehicleId")).toBe("car");
  expect(link.searchParams.get("recordVideo")).toBe("1");
  expect(screen.queryByRole("button",{name:"Record new video"})).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button",{name:"Upload video"})).toBeEnabled());
});
it("focused recording page shows capture before draft review and distinguishes published footage", async () => {
  state.videos=[{id:'draft',status:'ready',published:false,revision:1,durationMs:2000,byteSize:1000,previewUrl:'/draft'},{id:'live',status:'ready',published:true,revision:1,durationMs:2000,byteSize:1000,previewUrl:'/live'}];
  const view=mount(<VehicleVideoEditor vehicleId="car" writable recordingPage/>);
  await screen.findByText('Draft preview');
  expect(screen.getByRole('list',{name:'Video steps'})).toBeVisible();
  expect(screen.getByText('Current published video')).toBeVisible();
  const capture=view.container.querySelector('.video-capture-tools')!;
  const draft=view.container.querySelector('.video-draft-card')!;
  expect(capture.compareDocumentPosition(draft)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("failed file upload offers the same clip and upload ID for retry", async () => {
  const create=document.createElement.bind(document);
  const createSpy=vi.spyOn(document,'createElement').mockImplementation(((tag:string,options?:ElementCreationOptions)=>{
    const element=create(tag,options);
    if(tag==='video'){
      Object.defineProperty(element,'duration',{value:4});
      Object.defineProperty(element,'src',{configurable:true,set(){queueMicrotask(()=>{(element as HTMLVideoElement).onloadedmetadata?.(new Event('loadedmetadata'));});}});
      (element as HTMLVideoElement).load=vi.fn();
    }
    return element;
  }) as typeof document.createElement);
  vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:vi.fn(()=> 'blob:upload'),revokeObjectURL:vi.fn()}));
  let attempts=0;
  state.api.mockImplementation(async(path:string,options?:RequestInit)=>{
    if(options?.method==='PUT'){if(++attempts===1)throw new Error('Connection lost');return{};}
    return {enabled:true,videos:[],shareUrl:'https://dealer.example/vehicle/car'};
  });
  try{
    mount(<VehicleVideoEditor vehicleId="car" writable/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Upload video'})).toBeEnabled());
    const file=new File(['clip bytes'],'car.mp4',{type:'video/mp4'});
    fireEvent.change(screen.getByLabelText('Choose car video'),{target:{files:[file]}});
    fireEvent.click(await screen.findByRole('button',{name:'Retry upload'}));
    await screen.findByText('Video saved as a draft. Watch it below before publishing.');
    const calls=state.api.mock.calls.filter(([,options])=>options?.method==='PUT');
    expect(calls).toHaveLength(2);expect(calls[0][0]).toBe(calls[1][0]);expect(calls[0][1].body).toBe(file);expect(calls[1][1].body).toBe(file);
  }finally{createSpy.mockRestore();vi.unstubAllGlobals();}
});
