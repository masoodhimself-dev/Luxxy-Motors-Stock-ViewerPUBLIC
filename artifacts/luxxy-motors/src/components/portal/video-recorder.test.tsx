import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VideoRecorder } from "./video-recorder";
const stopTrack = vi.fn(),
  getCamera = vi.fn();
let last: any;
class Recorder {
  static isTypeSupported(type: string) {
    return type === "video/mp4";
  }
  state = "inactive";
  ondataavailable: any;
  onstop: any;
  onerror: any;
  constructor() {
    last = this;
  }
  start() {
    this.state = "recording";
  }
  pause() { this.state = "paused"; }
  resume() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded bytes"]) });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone");
  Object.defineProperty(window,"innerWidth",{configurable:true,value:844});
  Object.defineProperty(window,"innerHeight",{configurable:true,value:390});
  vi.spyOn(HTMLVideoElement.prototype,"videoWidth","get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype,"videoHeight","get").mockReturnValue(720);
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getCamera },
  });
  getCamera.mockReset();
  getCamera.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  stopTrack.mockClear();
  last = undefined;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:recorded"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("requests camera only after a click, reviews the clip and sends nothing automatically", async () => {
  const use = vi.fn();
  render(<VideoRecorder disabled={false} onRecorded={use} />);
  expect(getCamera).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record new video" })),
  );
  expect(getCamera).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish recording" }));
  expect(stopTrack).toHaveBeenCalled();
  expect(screen.getByText("Recorded clip")).toBeVisible();
  expect(use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use recording" }));
  expect(use.mock.calls[0][0]).toBeInstanceOf(File);
  expect(use.mock.calls[0][0].type).toBe("video/mp4");
});
it("stops automatically within the thirty-second cap", async () => {
  vi.useFakeTimers();
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record new video" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  act(() => vi.advanceTimersByTime(29000));
  expect(last.state).toBe("inactive");
  expect(stopTrack).toHaveBeenCalled();
  expect(screen.getByText("Recorded clip")).toBeVisible();
});
it("stops camera tracks when unmounted while permission is pending", async () => {
  let resolve: any;
  getCamera.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const view = render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record new video" }));
  view.unmount();
  await act(async () => resolve({ getTracks: () => [{ stop: stopTrack }] }));
  expect(stopTrack).toHaveBeenCalled();
});
it("handles denied camera permission and keeps upload as an alternative", async () => {
  getCamera.mockRejectedValueOnce(new Error("Camera permission denied"));
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record new video" })),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Camera permission denied",
  );
  expect(
    screen.getByRole("button", { name: "Record new video" }),
  ).toBeEnabled();
});
it("disabled recording never opens the camera", () => {
  render(<VideoRecorder disabled onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record new video" }));
  expect(getCamera).not.toHaveBeenCalled();
});

it("hides camera controls on desktop and tablets", () => {
  vi.spyOn(navigator,"userAgent","get").mockReturnValue("Macintosh");
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  expect(screen.queryByRole("button",{name:"Record new video"})).not.toBeInTheDocument();
  expect(getCamera).not.toHaveBeenCalled();
});
it("requires landscape before opening camera", () => {
  Object.defineProperty(window,"innerWidth",{configurable:true,value:390});
  Object.defineProperty(window,"innerHeight",{configurable:true,value:844});
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  expect(screen.getByRole("button",{name:"Record new video"})).toBeDisabled();
  expect(screen.getByText(/Turn your phone sideways/)).toBeVisible();
});
it("pauses on rotation, excludes paused time and resumes the same recording", async () => {
  vi.useFakeTimers();
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Record new video"})));
  fireEvent.click(screen.getByRole("button",{name:"Start recording"}));
  act(()=>vi.advanceTimersByTime(5000));
  Object.defineProperty(window,"innerWidth",{configurable:true,value:390});
  Object.defineProperty(window,"innerHeight",{configurable:true,value:844});
  fireEvent(window,new Event("resize"));
  expect(last.state).toBe("paused");
  expect(screen.getByRole("button",{name:"Resume recording"})).toBeDisabled();
  act(()=>vi.advanceTimersByTime(60000));
  expect(screen.getByRole("timer")).toHaveTextContent("00:05");
  Object.defineProperty(window,"innerWidth",{configurable:true,value:844});
  Object.defineProperty(window,"innerHeight",{configurable:true,value:390});
  fireEvent(window,new Event("resize"));
  fireEvent.click(screen.getByRole("button",{name:"Resume recording"}));
  expect(last.state).toBe("recording");
  act(()=>vi.advanceTimersByTime(24000));
  expect(last.state).toBe("inactive");
  expect(screen.getByText("Recorded clip")).toBeVisible();
});
it("can finish while paused and stops tracks", async () => {
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Record new video"})));
  fireEvent.click(screen.getByRole("button",{name:"Start recording"}));
  fireEvent.click(screen.getByRole("button",{name:"Pause recording"}));
  fireEvent.click(screen.getByRole("button",{name:"Finish recording"}));
  expect(screen.getByText("Recorded clip")).toBeVisible();
  expect(stopTrack).toHaveBeenCalled();
});
it("rejects portrait camera frames even in a landscape viewport", async () => {
  vi.spyOn(HTMLVideoElement.prototype,"videoWidth","get").mockReturnValue(720);
  vi.spyOn(HTMLVideoElement.prototype,"videoHeight","get").mockReturnValue(1280);
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Record new video"})));
  fireEvent.click(screen.getByRole("button",{name:"Start recording"}));
  expect(screen.getByRole("alert")).toHaveTextContent("landscape camera preview");
  expect(last?.state).not.toBe("recording");
});
it("pauses when the page is hidden and never resumes automatically", async () => {
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Record new video"})));
  fireEvent.click(screen.getByRole("button",{name:"Start recording"}));
  vi.spyOn(document,"hidden","get").mockReturnValue(true);
  fireEvent(document,new Event("visibilitychange"));
  expect(last.state).toBe("paused");
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
  fireEvent(document,new Event("visibilitychange"));
  expect(last.state).toBe("paused");
});
it("cancels a paused clip without creating an upload", async () => {
  const use=vi.fn();
  const view=render(<VideoRecorder disabled={false} onRecorded={use} />);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Record new video"})));
  fireEvent.click(screen.getByRole("button",{name:"Start recording"}));
  fireEvent.click(screen.getByRole("button",{name:"Pause recording"}));
  view.unmount();
  expect(last.state).toBe("inactive");
  expect(stopTrack).toHaveBeenCalled(); expect(use).not.toHaveBeenCalled();
});
