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
  expect(screen.getByRole("heading", { name: "Record a walkaround" })).toBeVisible();
  expect(screen.getAllByText(/Turn your phone sideways/)).toHaveLength(1);
  expect(screen.queryByLabelText("Camera preview")).not.toBeInTheDocument();
  expect(getCamera).not.toHaveBeenCalled();
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

async function recordClip() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish recording" }));
}

it("keeps a finished clip while its upload is pending and retries the same file after failure", async () => {
  let resolve!: (saved: boolean) => void;
  const use = vi.fn().mockImplementationOnce(() => new Promise<boolean>(r => { resolve = r; })).mockResolvedValueOnce(true);
  const view = render(<VideoRecorder disabled={false} onRecorded={use} />);
  await recordClip();
  fireEvent.click(screen.getByRole("button", { name: "Use recording" }));
  view.rerender(<VideoRecorder disabled onRecorded={use} />);
  expect(screen.getByLabelText("Recorded clip preview")).toBeVisible();
  expect(screen.getByRole("button", { name: "Saving recording…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard recording" })).toBeDisabled();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  await act(async () => resolve(false));
  view.rerender(<VideoRecorder disabled={false} onRecorded={use} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Your recording is still here");
  expect(screen.getByLabelText("Recorded clip preview")).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use recording" })));
  expect(use).toHaveBeenCalledTimes(2);
  expect(use.mock.calls[1][0]).toBe(use.mock.calls[0][0]);
  expect(screen.queryByLabelText("Recorded clip preview")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:recorded");
});

it("keeps the clip when the upload callback throws", async () => {
  render(<VideoRecorder disabled={false} onRecorded={vi.fn().mockRejectedValue(new Error("Network unavailable"))} />);
  await recordClip();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use recording" })));
  expect(screen.getByRole("alert")).toHaveTextContent("Upload failed. Your recording is still here");
  expect(screen.getByLabelText("Recorded clip preview")).toBeVisible();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it("does not let an old permission rejection stop a newer camera session", async () => {
  let reject!: (reason: Error) => void;
  getCamera.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record new video" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  await act(async () => reject(new Error("Old permission was cancelled")));
  expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  expect(stopTrack).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("stops tracks from a cancelled permission request without replacing a newer camera", async () => {
  let resolve!: (camera: unknown) => void;
  const stopOldTrack = vi.fn();
  getCamera.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record new video" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  await act(async () => resolve({ getTracks: () => [{ stop: stopOldTrack }] }));
  expect(stopOldTrack).toHaveBeenCalledOnce();
  expect(stopTrack).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
});

it("ignores a late stop event from a discarded recording", async () => {
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  const old = last;
  old.stop = () => { old.state = "inactive"; };
  fireEvent.click(screen.getByRole("button", { name: "Cancel recording" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  stopTrack.mockClear();
  act(() => old.onstop());
  expect(stopTrack).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start recording" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not leave the camera active when permission arrives in the background", async () => {
  let resolve!: (camera: unknown) => void;
  getCamera.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Record new video" }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => resolve({ getTracks: () => [{ stop: stopTrack }] }));
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Camera preview")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("in the background");
});

it("explains how to restore denied camera and microphone access", async () => {
  getCamera.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  expect(screen.getByRole("alert")).toHaveTextContent("Allow both in your browser’s site settings");
  expect(screen.getByRole("alert")).toHaveTextContent("upload an existing video");
});

it("explains an interrupted camera and allows staff to reconnect", async () => {
  let ended!: () => void;
  getCamera.mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack, addEventListener: (_: string, fn: () => void) => { ended = fn; } }] });
  render(<VideoRecorder disabled={false} onRecorded={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  act(() => ended());
  expect(screen.getByRole("alert")).toHaveTextContent("Camera access ended");
  expect(screen.getByRole("button", { name: "Record new video" })).toBeEnabled();
  expect(stopTrack).toHaveBeenCalled();
});

it("reports camera and clip review activity until staff finish or discard", async () => {
  const activity = vi.fn();
  const view = render(<VideoRecorder disabled={false} onRecorded={vi.fn()} onActiveChange={activity} />);
  expect(activity).toHaveBeenLastCalledWith(false);
  await recordClip();
  expect(activity).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Discard recording" }));
  expect(activity).toHaveBeenLastCalledWith(false);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Record new video" })));
  expect(activity).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(activity).toHaveBeenLastCalledWith(false);
});
