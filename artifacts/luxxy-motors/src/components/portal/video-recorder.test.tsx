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
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded bytes"]) });
    this.onstop?.();
  }
}
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", Recorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getCamera },
  });
  getCamera.mockReset();
  getCamera.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  stopTrack.mockClear();
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
});
it("requests camera only after a click, reviews the clip and sends nothing automatically", async () => {
  const use = vi.fn();
  render(<VideoRecorder disabled={false} onRecorded={use} />);
  expect(getCamera).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Record new video" })),
  );
  expect(getCamera).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
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
