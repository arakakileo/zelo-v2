'use client';

import { useEffect, useRef } from 'react';

type RequestClose = () => void;

/**
 * Encapsula o ciclo de vida do `<dialog>` nativo:
 *  - showModal/close imperativo conforme `open`.
 *  - Restaura foco ao elemento previamente focado após fechar.
 *  - `cancel` event (Esc) → preventDefault + requestClose (deixa o caller
 *    decidir via dirty-check).
 *  - Click no backdrop (alvo === dialog) → requestClose.
 *
 * Não conhece `isDirty` nem `submitting` — isso fica no caller via
 * `requestClose`, que veta o fechamento quando aplicável.
 */
export function useDialogLifecycle(
  open: boolean,
  requestClose: RequestClose,
): React.RefObject<HTMLDialogElement | null> {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // showModal/close imperativo + restore focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        previouslyFocusedRef.current =
          typeof document !== 'undefined'
            ? (document.activeElement as HTMLElement | null)
            : null;
        dialog.showModal();
      }
    } else {
      if (dialog.open) dialog.close();
      previouslyFocusedRef.current?.focus?.();
    }
  }, [open]);

  // Esc dispara `cancel` antes de fechar — preventDefault + requestClose
  // (caller decide se dirty-check barra).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [requestClose]);

  // Click no backdrop (área fora do conteúdo) = fechar.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target === dialog) requestClose();
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [requestClose]);

  return dialogRef;
}