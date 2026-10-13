import { useRef, useState, useCallback, useEffect } from "react";
import type { Workspace } from "./types";
import { validateWorkspace } from "./engine";
import type { StorageAdapter, Saved } from "./storage";

export function useWorkspace(adapter: StorageAdapter, initial: Saved) {
  const [workspace, setWorkspace] = useState(initial.workspace!);
  const ref = useRef(workspace);
  const lastSaved = useRef(workspace);
  const revision = useRef(initial.revision);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const failure = useRef<Error | null>(null);
  const writeFailed = useRef(false);
  const restoring = useRef(false);
  const undo = useRef<Workspace[]>([]),
    redo = useRef<Workspace[]>([]);
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const fail = useCallback((cause: unknown) => {
    // Keep the first cause: later queued edits must not obscure a conflict or disk error.
    if (!failure.current) {
      failure.current =
        cause instanceof Error ? cause : new Error(String(cause));
      setError(failure.current.message);
    }
    setStatus("error");
  }, []);
  const writable = () => {
    if (failure.current)
      throw new Error(
        "Saving is paused. Download your unsaved backup, then reload the saved version.",
      );
    if (restoring.current)
      throw new Error(
        "A history restore is in progress. Wait for it to finish before editing.",
      );
  };
  const persist = useCallback(
    (next: Workspace, label: string) => {
      pending.current++;
      setStatus("saving");
      queue.current = queue.current.then(async () => {
        try {
          if (failure.current) return;
          revision.current = await adapter.save(revision.current, next, label);
          lastSaved.current = next;
        } catch (cause) {
          writeFailed.current = true;
          fail(cause);
        } finally {
          pending.current--;
          if (!pending.current && !failure.current) setStatus("saved");
        }
      });
    },
    [adapter, fail],
  );
  const update = useCallback(
    (change: (workspace: Workspace) => void, label = "Edited workspace") => {
      writable();
      const next = structuredClone(ref.current);
      change(next);
      validateWorkspace(next);
      undo.current.push(ref.current);
      if (undo.current.length > 50) undo.current.shift();
      redo.current = [];
      ref.current = next;
      setWorkspace(next);
      persist(next, label);
    },
    [persist],
  );
  const undoChange = () => {
    if (failure.current || restoring.current) return;
    const previous = undo.current.pop();
    if (!previous) return;
    redo.current.push(ref.current);
    ref.current = previous;
    setWorkspace(previous);
    persist(previous, "Undo");
  };
  const redoChange = () => {
    if (failure.current || restoring.current) return;
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ref.current);
    ref.current = next;
    setWorkspace(next);
    persist(next, "Redo");
  };
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      // A failed or pending edit remains in `workspace` for the existing backup button.
      // Reload deliberately reopens the durable copy; it must never silently replace it with a stale draft.
      if (
        pending.current ||
        writeFailed.current ||
        ref.current !== lastSaved.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    const unsubscribe = adapter.subscribe?.((next) => {
      if (next > revision.current)
        fail(
          new Error(
            "Another tab saved a newer workspace. Download a backup if you have unsaved edits, then reload to open the latest version.",
          ),
        );
    });
    return () => {
      window.removeEventListener("beforeunload", before);
      unsubscribe?.();
    };
  }, [adapter, fail]);
  const restore = async (id: number) => {
    writable();
    restoring.current = true;
    pending.current++;
    setStatus("saving");
    const operation = queue.current.then(async () => {
      try {
        if (failure.current) throw failure.current;
        const saved = await adapter.restore(revision.current, id);
        if (!saved.workspace)
          throw new Error("The server returned an empty history entry.");
        validateWorkspace(saved.workspace);
        revision.current = saved.revision;
        ref.current = saved.workspace;
        lastSaved.current = saved.workspace;
        setWorkspace(saved.workspace);
        undo.current = [];
        redo.current = [];
      } catch (cause) {
        writeFailed.current = true;
        fail(cause);
        throw cause;
      } finally {
        pending.current--;
        restoring.current = false;
        if (!pending.current && !failure.current) setStatus("saved");
      }
    });
    queue.current = operation.catch(() => {});
    await operation;
  };
  return {
    workspace,
    update,
    undo: undoChange,
    redo: redoChange,
    canUndo: undo.current.length > 0 && !failure.current && !restoring.current,
    canRedo: redo.current.length > 0 && !failure.current && !restoring.current,
    status,
    error,
    restore,
  };
}
