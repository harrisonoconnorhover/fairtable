import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      className={"dialog " + (wide ? "wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  message,
  onConfirm,
  onClose,
  action = "Delete",
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onClose: () => void;
  action?: string;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-copy">{message}</p>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {action}
        </button>
      </div>
    </Dialog>
  );
}
