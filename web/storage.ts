import type { Workspace } from "./types";
import { validateWorkspace } from "./engine";

export interface Saved {
  revision: number;
  workspace: Workspace | null;
}
export interface HistoryItem {
  id: number;
  createdAt: string;
  label: string;
}
export interface StorageAdapter {
  mode: "browser" | "server";
  load: () => Promise<Saved>;
  save: (
    revision: number,
    workspace: Workspace,
    label: string,
  ) => Promise<number>;
  history: () => Promise<HistoryItem[]>;
  restore: (revision: number, id: number) => Promise<Saved>;
  subscribe?: (listener: (revision: number) => void) => () => void;
}
interface LocalState extends Saved {
  label?: string;
  updatedAt?: string;
}
interface LocalSnapshot extends HistoryItem {
  workspace: Workspace;
}
const DB = "fairtable-v1";
const KEY = "workspace";
const CHANNEL = "fairtable-changes";
let database: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Storage request failed."));
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Storage failed."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("Storage transaction was cancelled."));
  });
}
async function open(): Promise<IDBDatabase> {
  if (database) return database;
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("state");
      req.result.createObjectStore("history", { keyPath: "id" });
    };
    req.onerror = () =>
      reject(req.error ?? new Error("Could not open browser storage."));
    req.onblocked = () =>
      reject(
        new Error(
          "Close other Fairtable tabs so browser storage can finish opening.",
        ),
      );
    req.onsuccess = () => {
      const db = req.result;
      database = db;
      db.onversionchange = () => {
        db.close();
        if (database === db) {
          database = undefined;
          opening = undefined;
        }
      };
      db.onclose = () => {
        if (database === db) {
          database = undefined;
          opening = undefined;
        }
      };
      resolve(db);
    };
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}
async function localLoad(): Promise<Saved> {
  const db = await open();
  const state: LocalState | undefined = await request(
    db.transaction("state").objectStore("state").get(KEY),
  );
  return state
    ? { revision: state.revision, workspace: state.workspace }
    : { revision: 0, workspace: null };
}
async function localSave(
  revision: number,
  workspace: Workspace,
  label: string,
): Promise<number> {
  const db = await open();
  const tx = db.transaction(["state", "history"], "readwrite");
  const done = complete(tx);
  // Attach a handler immediately: a failed request can abort the transaction before its await resumes.
  void done.catch(() => {});
  try {
    const state = tx.objectStore("state");
    const history = tx.objectStore("history");
    const current: LocalState = (await request(state.get(KEY))) ?? {
      revision: 0,
      workspace: null,
    };
    if (current.revision !== revision)
      throw new Error(
        "This workspace changed in another tab. Download your unsaved backup, then reload the saved version.",
      );
    const next = revision + 1;
    const now = new Date().toISOString();
    if (current.workspace)
      history.put({
        id: next,
        createdAt: current.updatedAt ?? now,
        label: current.label ?? "Saved workspace",
        workspace: current.workspace,
      } satisfies LocalSnapshot);
    const keys = await request(history.getAllKeys());
    for (const key of keys.slice(0, Math.max(0, keys.length - 30)))
      history.delete(key);
    state.put(
      { revision: next, workspace, label, updatedAt: now } satisfies LocalState,
      KEY,
    );
    await done;
    return next;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have aborted or completed. */
    }
    await done.catch(() => {});
    throw error;
  }
}
async function localHistory(): Promise<HistoryItem[]> {
  const db = await open();
  const values: LocalSnapshot[] = await request(
    db.transaction("history").objectStore("history").getAll(),
  );
  return values
    .map(({ id, createdAt, label }) => ({ id, createdAt, label }))
    .reverse();
}
async function localRestore(revision: number, id: number): Promise<Saved> {
  const db = await open();
  const item: LocalSnapshot | undefined = await request(
    db.transaction("history").objectStore("history").get(id),
  );
  if (!item) throw new Error("That history entry is no longer available.");
  validateWorkspace(item.workspace);
  const next = await localSave(
    revision,
    item.workspace,
    `Restored snapshot ${id}`,
  );
  return { revision: next, workspace: item.workspace };
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.error ??
        `The server returned ${response.status}. Download a backup of your edits before reloading.`,
    );
  }
  return response.json();
}

/** An API failure is not evidence that this is the static browser edition. */
export async function detectStorageMode(): Promise<"browser" | "server"> {
  let response: Response;
  try {
    response = await fetch("/api/health", { cache: "no-store" });
  } catch {
    throw new Error(
      "Could not check the Fairtable server. Check your connection, then try again.",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && contentType.includes("application/json")) {
    let health: { name?: string };
    try {
      health = await response.json();
    } catch {
      throw new Error("The Fairtable health endpoint returned invalid JSON.");
    }
    if (health.name !== "Fairtable")
      throw new Error("This server did not identify itself as Fairtable.");
    localStorage.setItem("fairtable-storage-mode", "server");
    return "server";
  }
  if (localStorage.getItem("fairtable-storage-mode") === "server")
    throw new Error(
      "Could not reach your Fairtable server. Start it again to open your saved workspace.",
    );
  if (
    response.status === 404 ||
    (response.ok && contentType.includes("text/html"))
  )
    return "browser";
  throw new Error(
    `Could not open Fairtable: the health endpoint returned ${response.status}. Your storage location has not been changed.`,
  );
}

export async function createStorage(): Promise<StorageAdapter> {
  const mode = await detectStorageMode();
  const source = crypto.randomUUID();
  const announce = (revision: number) => {
    // A browser can deny this optional feature without invalidating a committed save.
    try {
      const channel = new BroadcastChannel(CHANNEL);
      channel.postMessage({ revision, source, mode });
      channel.close();
    } catch {
      /* CAS remains the authority when notifications are unavailable. */
    }
  };
  const subscribe = (listener: (revision: number) => void) => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(CHANNEL);
    } catch {
      return () => {};
    }
    channel.onmessage = (event) => {
      const change = event.data;
      if (
        change &&
        change.source !== source &&
        change.mode === mode &&
        Number.isSafeInteger(change.revision) &&
        change.revision > 0
      )
        listener(change.revision);
    };
    return () => channel.close();
  };
  if (mode === "server")
    return {
      mode,
      subscribe,
      load: () => api("/api/workspace"),
      save: async (revision, workspace, label) => {
        const result = await api<{ revision: number }>("/api/workspace", {
          method: "PUT",
          body: JSON.stringify({ revision, workspace, label }),
        });
        announce(result.revision);
        return result.revision;
      },
      history: () => api("/api/history"),
      restore: async (revision, id) => {
        const result = await api<Saved>(`/api/restore/${id}`, {
          method: "POST",
          body: JSON.stringify({ revision }),
        });
        announce(result.revision);
        return result;
      },
    };
  await open();
  return {
    mode,
    subscribe,
    load: localLoad,
    save: async (revision, workspace, label) => {
      const next = await localSave(revision, workspace, label);
      announce(next);
      return next;
    },
    history: localHistory,
    restore: async (revision, id) => {
      const result = await localRestore(revision, id);
      announce(result.revision);
      return result;
    },
  };
}
