import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage, detectStorageMode } from "./storage";
import type { Workspace } from "./types";

const document: Workspace = { version: 1, name: "Saved document", bases: [] };
class Channel {
  static instances: Channel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(public name: string) {
    Channel.instances.push(this);
  }
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal("fetch", vi.fn());
  Channel.instances = [];
  vi.stubGlobal("BroadcastChannel", Channel);
});
afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const health = () =>
  response({ name: "Fairtable", version: "0.1.0", storage: "sqlite" });

describe("storage location detection", () => {
  it("does not silently choose browser storage after a first-load server failure", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ error: "Unavailable" }, 503));
    await expect(detectStorageMode()).rejects.toThrow("503");
    expect(localStorage.getItem("fairtable-storage-mode")).toBeNull();
  });
  it("does not choose browser storage after a network error or authentication failure", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(response({}, 401));
    await expect(detectStorageMode()).rejects.toThrow("Check your connection");
    await expect(detectStorageMode()).rejects.toThrow("401");
  });
  it("recognizes static hosting HTML fallbacks and missing API routes", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("<!doctype html><title>Fairtable</title>", {
          headers: { "content-type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    await expect(detectStorageMode()).resolves.toBe("browser");
    await expect(detectStorageMode()).resolves.toBe("browser");
  });
  it("keeps a previously identified server pinned even if its API returns HTML or 404", async () => {
    localStorage.setItem("fairtable-storage-mode", "server");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("<html/>", { headers: { "content-type": "text/html" } }),
      )
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    await expect(detectStorageMode()).rejects.toThrow("Start it again");
    await expect(detectStorageMode()).rejects.toThrow("Start it again");
  });
  it("requires a valid Fairtable identity and records the successful mode", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ name: "Other service" }))
      .mockResolvedValueOnce(
        new Response("{", { headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(health());
    await expect(detectStorageMode()).rejects.toThrow("identify itself");
    await expect(detectStorageMode()).rejects.toThrow("invalid JSON");
    await expect(detectStorageMode()).resolves.toBe("server");
    expect(localStorage.getItem("fairtable-storage-mode")).toBe("server");
  });
});

describe("server storage and cross-tab notifications", () => {
  it("sends the expected revision and document and only announces a committed save", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(response({ revision: 8 }));
    const adapter = await createStorage();
    await expect(adapter.save(7, document, "Renamed workspace")).resolves.toBe(
      8,
    );
    const [url, init] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe("/api/workspace");
    expect(JSON.parse(init!.body as string)).toEqual({
      revision: 7,
      workspace: document,
      label: "Renamed workspace",
    });
    expect(Channel.instances).toHaveLength(1);
    expect(Channel.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "server", revision: 8 }),
    );
    expect(Channel.instances[0].close).toHaveBeenCalledOnce();
  });
  it("surfaces CAS conflicts without retrying or broadcasting success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(
        response({ error: "Revision conflict", revision: 9 }, 409),
      );
    const adapter = await createStorage();
    await expect(adapter.save(7, document, "Edit")).rejects.toThrow(
      "Revision conflict",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Channel.instances).toHaveLength(0);
  });
  it("ignores its own notifications, accepts other matching revisions, and closes subscriptions", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(response({ revision: 3 }));
    const adapter = await createStorage();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe!(listener);
    const subscription = Channel.instances[0];
    await adapter.save(2, document, "Edit");
    const own = Channel.instances[1].postMessage.mock.calls[0][0];
    subscription.onmessage!({ data: own });
    subscription.onmessage!({
      data: { mode: "browser", revision: 4, source: "other" },
    });
    subscription.onmessage!({
      data: { mode: "server", revision: "4", source: "other" },
    });
    expect(listener).not.toHaveBeenCalled();
    subscription.onmessage!({
      data: { mode: "server", revision: 4, source: "other" },
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith(4);
    unsubscribe();
    expect(subscription.close).toHaveBeenCalledOnce();
  });
  it("does not report a committed write as failed when optional notifications are unavailable", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("Unsupported");
        }
      },
    );
    vi.mocked(fetch)
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(response({ revision: 2 }));
    const adapter = await createStorage();
    expect(() => adapter.subscribe!(vi.fn())()).not.toThrow();
    await expect(adapter.save(1, document, "Edit")).resolves.toBe(2);
  });
  it("restores with the current revision and announces only the successful new revision", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(response({ revision: 5, workspace: document }));
    const adapter = await createStorage();
    await expect(adapter.restore(4, 2)).resolves.toEqual({
      revision: 5,
      workspace: document,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[1];
    expect(url).toBe("/api/restore/2");
    expect(JSON.parse(init!.body as string)).toEqual({ revision: 4 });
    expect(Channel.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 5 }),
    );
  });
});
