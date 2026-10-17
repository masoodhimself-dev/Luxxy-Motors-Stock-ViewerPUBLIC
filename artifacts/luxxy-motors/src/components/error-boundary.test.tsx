import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ErrorBoundary, isChunkLoadError } from "./error-boundary";

afterEach(cleanup);

test("the crash fallback offers recovery without displaying internal exception details", async () => {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  let broken = true;
  function Page() {
    if (broken) throw new Error("Database customer token private diagnostic");
    return <p>Recovered page</p>;
  }
  try {
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("heading", {
        name: "This page couldn’t load",
        level: 1,
      }),
    ).toBeVisible();
    expect(
      screen.queryByText("Database customer token private diagnostic"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "/contact",
    );
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered page")).toBeVisible();
  } finally {
    consoleError.mockRestore();
  }
});

test.each([
  [
    "Failed to fetch dynamically imported module: https://dealer.test/assets/portal-old.js",
    true,
  ],
  [
    "error loading dynamically imported module: https://dealer.test/assets/portal-old.js",
    true,
  ],
  ["Importing a module script failed.", true],
  ["Loading chunk 42 failed.", true],
  ["Loading CSS chunk portal failed.", true],
  ["Failed to fetch the customer record", false],
  ["Unexpected invoice calculation error", false],
])("detects only module-load failures: %s", (message, expected) => {
  expect(isChunkLoadError(new Error(message))).toBe(expected);
});

test("recognises named chunk failures without treating ordinary errors as deployment failures", () => {
  const error = new Error("A bundle could not load");
  error.name = "ChunkLoadError";
  expect(isChunkLoadError(error)).toBe(true);
  expect(isChunkLoadError(null)).toBe(false);
});

test("reloads the full page only after the user retries a failed dynamic import", () => {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const reload = vi.fn();
  function Page(): never {
    throw new Error(
      "Failed to fetch dynamically imported module: https://dealer.test/assets/private-chunk.js",
    );
  }
  try {
    render(
      <ErrorBoundary showCustomerHelp={false}>
        <Page />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("heading", { name: "This page needs a refresh" }),
    ).toBeVisible();
    expect(screen.getByText(/website may have updated/)).toBeInTheDocument();
    expect(screen.queryByText(/private-chunk/)).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    const actualWindow = window;
    vi.stubGlobal(
      "window",
      new Proxy(actualWindow, {
        get(target, property) {
          return property === "location"
            ? { reload }
            : Reflect.get(target, property);
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  }
});
