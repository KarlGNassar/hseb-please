"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ReceiptText, X } from "lucide-react";

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
};

/** App-styled confirmations with native focus trapping and background isolation. */
export function useConfirmation() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (confirmation) {
      dialogRef.current?.showModal();
      cancelRef.current?.focus();
    }
  }, [confirmation]);

  useEffect(
    () => () => {
      resolveRef.current?.(false);
    },
    [],
  );

  function finish(accepted: boolean) {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    dialogRef.current?.close();
    setConfirmation(null);
    resolve?.(accepted);
  }

  function confirm(options: Confirmation): Promise<boolean> {
    resolveRef.current?.(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setConfirmation(options);
    });
  }

  const confirmationDialog = confirmation && (
    <dialog
      ref={dialogRef}
      className="modal confirmation-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          finish(false);
      }}
    >
      <button
        className="modal-close icon-button"
        type="button"
        onClick={() => finish(false)}
        aria-label="Close confirmation"
      >
        <X size={20} />
      </button>
      <span className="modal-icon">
        <ReceiptText size={25} />
      </span>
      <div className="eyebrow">A QUICK CHECK</div>
      <h2 id={`${id}-title`}>{confirmation.title}</h2>
      <p id={`${id}-description`}>{confirmation.description}</p>
      <div className="confirmation-actions">
        <button
          className="button button-white"
          type="button"
          ref={cancelRef}
          onClick={() => finish(false)}
        >
          {confirmation.cancelLabel || "Keep my bill"}
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={() => finish(true)}
        >
          {confirmation.confirmLabel}
          <ArrowRight size={16} />
        </button>
      </div>
    </dialog>
  );

  return { confirm, confirmationDialog };
}
