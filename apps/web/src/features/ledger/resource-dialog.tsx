"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AccountKindSchema, CategoryKindSchema, type Account, type Category } from "@account-book/contracts";
import { useLedgerApi } from "./session.js";
import { ResourceForm, type ResourceDraft } from "./resource-form.js";
import { LedgerDialog } from "./dialog.js";
import { errorMessage, Feedback, needsReload } from "./feedback.js";
import type { Resource } from "./query-options.js";
import styles from "./ledger.module.css";

type Props = Readonly<{ resource: Resource; item?: Account | Category; archive?: boolean; onClose(): void; onSaved(): void }>;

/** @param props 열린 항목의 스냅샷과 리소스. 변경 후 버전은 refetch로 얻고 자동 덮어쓰기하지 않는다. */
export function ResourceDialog({ resource, item, archive = false, onClose, onSaved }: Props) {
  const ledgerApi = useLedgerApi();
  const noun = resource === "accounts" ? "계좌" : "카테고리";
  const [error, setError] = useState<unknown>();
  const mutation = useMutation({ mutationFn: async ({ draft, key }: { draft?: ResourceDraft; key?: string }) => {
    if (archive && item) return ledgerApi[resource].archive(item.id, { expectedVersion: item.version });
    if (!draft || !key) throw new Error("FORM_INVALID");
    if (resource === "accounts") return item
      ? ledgerApi.accounts.update(item.id, { name: draft.name, expectedVersion: item.version })
      : ledgerApi.accounts.create({ name: draft.name, kind: AccountKindSchema.parse(draft.kind), idempotencyKey: key });
    return item
      ? ledgerApi.categories.update(item.id, { name: draft.name, sortOrder: draft.sortOrder, expectedVersion: item.version })
      : ledgerApi.categories.create({ name: draft.name, kind: CategoryKindSchema.parse(draft.kind), sortOrder: draft.sortOrder, idempotencyKey: key });
  }, retry: false });
  const close = () => { if (!mutation.isPending) onClose(); };
  return <LedgerDialog title={`${noun} ${archive ? "보관" : item ? "수정" : "추가"}`} onClose={close}>
    {archive ? <>
      <p><strong>{item?.name}</strong> 항목을 보관할까요?</p>
      <p className={styles.hint}>기존 내역은 삭제되지 않아요. 보관한 항목은 새 거래에 사용할 수 없고, 현재 화면에서는 복원할 수 없어요.</p>
      {error !== undefined && <Feedback error message={errorMessage(error)} />}
      <div className={styles.actions}><button className={styles.button} disabled={mutation.isPending} onClick={close}>취소</button><button className={styles.dangerButton} disabled={mutation.isPending || needsReload(error)} onClick={() => { setError(undefined); mutation.mutate({}, { onSuccess: onSaved, onError: setError }); }}>{mutation.isPending ? "보관 중…" : "보관하기"}</button></div>
    </> : <ResourceForm resource={resource} {...(item ? { item } : {})} onClose={close} onSaved={onSaved} onSave={(draft, key) => mutation.mutateAsync({ draft, key })} />}
  </LedgerDialog>;
}
