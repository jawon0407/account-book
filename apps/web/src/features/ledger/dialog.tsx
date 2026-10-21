"use client";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./ledger.module.css";

/**
 * 브라우저 기본 dialog로 키보드 포커스를 내부에 가둔다. 닫히면 원래 버튼으로 포커스를 돌린다.
 * @param title 접근 가능한 이름. @param onClose Escape 처리. @param children 실제 폼.
 */
export function LedgerDialog({ title, children, onClose }: Readonly<{ title: string; children: ReactNode; onClose(): void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="ledger-dialog-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><h2 id="ledger-dialog-title">{title}</h2>{children}</dialog>;
}
