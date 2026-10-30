"use client";
import { useRef, useState, type FormEvent } from "react";
import { CreateAccountInputSchema, CreateCategoryInputSchema, type Account, type Category } from "@account-book/contracts";
import type { Resource } from "./query-options.js";
import { createIntent } from "./form-intent.js";
import { errorMessage, Feedback, needsReload } from "./feedback.js";
import styles from "./ledger.module.css";
export type ResourceDraft = { name: string; kind: string; sortOrder: number };
export type ResourceFormProps = Readonly<{ resource: Resource; item?: Account | Category; onSave(draft: ResourceDraft, key: string): Promise<unknown>; onClose(): void; onSaved(): void }>;

/**
 * 계좌/분류의 작은 편집 폼. 원본 item은 열었을 때의 버전을 보존하고 실패 시 입력을 지우지 않는다.
 * @param props resource와 선택 item, 실제 저장/완료/닫기 콜백. 금융 데이터는 메모리에만 둔다.
 */
export function ResourceForm({ resource, item, onSave, onClose, onSaved }: ResourceFormProps) {
  const account = resource === "accounts";
  const noun = account ? "계좌" : "카테고리";
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<string>(item?.kind ?? (account ? "bank" : "expense"));
  const [order, setOrder] = useState(String(item && "sortOrder" in item ? item.sortOrder : 0));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [validation, setValidation] = useState("");
  const busy = useRef(false);
  const [intent] = useState(createIntent);

  /** @param event 폼 제출. 이름/순서를 검사하고 한 의도당 같은 키로 한 번씩 요청한다. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || needsReload(error)) return;
    const parsedName = (account ? CreateAccountInputSchema.shape.name : CreateCategoryInputSchema.shape.name).safeParse(name);
    const parsedOrder = CreateCategoryInputSchema.shape.sortOrder.safeParse(order.trim() ? Number(order) : NaN);
    if (!parsedName.success) { setValidation(`이름을 1~${account ? 80 : 50}자로 입력해 주세요.`); return; }
    if (!account && !parsedOrder.success) { setValidation("정렬 순서는 0~10,000 사이 정수로 입력해 주세요."); return; }
    const draft = { name: parsedName.data, kind, sortOrder: account ? 0 : parsedOrder.data! };
    busy.current = true; setPending(true); setError(undefined); setValidation("");
    try { await onSave(draft, intent.keyFor(draft)); onSaved(); }
    catch (failure) { setError(failure); }
    finally { busy.current = false; setPending(false); }
  }
  return <form aria-label={`${noun} 편집`} className={styles.form} onSubmit={(event) => { void submit(event); }} noValidate>
    <fieldset disabled={pending}>
      <label htmlFor="resource-name">{noun} 이름</label>
      <input id="resource-name" name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={account ? 80 : 50} required autoComplete="off" aria-describedby={validation ? "resource-validation" : undefined} aria-invalid={Boolean(validation)} />
      <label htmlFor="resource-kind">종류</label>
      <select id="resource-kind" value={kind} onChange={(e) => setKind(e.target.value)} disabled={Boolean(item)}>
        {account ? <><option value="bank">은행 계좌</option><option value="cash">현금</option><option value="card">카드</option></> : <><option value="expense">지출</option><option value="income">수입</option></>}
      </select>
      {!account && <><label htmlFor="resource-order">정렬 순서</label><input id="resource-order" type="number" min="0" max="10000" step="1" value={order} onChange={(e) => setOrder(e.target.value)} /><p className={styles.hint}>작은 숫자가 먼저 표시됩니다.</p></>}
      {account && <p className={styles.hint}>장부에서 사용할 계좌예요. 은행 연결이나 실제 잔액 조회는 아직 제공하지 않아요.</p>}
    </fieldset>
    {validation && <p className={styles.error} id="resource-validation" role="alert">{validation}</p>}
    {error !== undefined && <Feedback error message={errorMessage(error)} />}
    <div className={styles.actions}><button type="button" className={styles.button} disabled={pending} onClick={onClose}>닫기</button><button className={styles.primary} disabled={pending || needsReload(error)} type="submit">{pending ? "저장 중…" : item ? "저장하기" : "추가하기"}</button></div>
  </form>;
}
