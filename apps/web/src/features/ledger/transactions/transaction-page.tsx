"use client";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeleteTransactionInput, UpdateTransactionInput, Transaction, TransactionListQuery } from "@account-book/contracts";
import { useLedgerApi, useLedgerUser } from "../session.js";
import { coreKeys } from "../query-options.js";
import { LedgerDialog } from "../dialog.js";
import { Feedback, Loading } from "../feedback.js";
import { createTransactionsApi } from "./api.js";
import { transactionQuery } from "./query-options.js";
import { TransactionForm } from "./transaction-form.js";
import { TransactionFilters } from "./transaction-filters.js";
import { TransactionTable } from "./transaction-table.js";
import { TransactionEditForm } from "./transaction-edit-form.js";
import { TransactionDeleteForm } from "./transaction-delete-form.js";
import styles from "../ledger.module.css";

/** 인증 경계 안에서만 마운트된다. 사용자 변경 시 모든 필터·폼·금융 캐시가 함께 폐기된다. */
export function TransactionPage() {
  const userId = useLedgerUser(), core = useLedgerApi(), client = useQueryClient();
  const api = useMemo(() => createTransactionsApi(undefined, userId), [userId]);
  const [filters, setFilters] = useState<TransactionListQuery>({}), [open, setOpen] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [selected, setSelected] = useState<{ row: Transaction; action: "edit" | "delete" } | null>(null);
  const accounts = useQuery({ queryKey: [...coreKeys(userId), "accounts", true], queryFn: ({ signal }) => core.accounts.list(true, signal), retry: false, gcTime: 0 });
  const categories = useQuery({ queryKey: [...coreKeys(userId), "categories", true], queryFn: ({ signal }) => core.categories.list(true, signal), retry: false, gcTime: 0 });
  const query = useInfiniteQuery(transactionQuery(userId, filters, api));
  const create = useMutation({ mutationFn: api.create, retry: false });
  // MutationCache가 인증 만료를 감지해 장부 전체를 숨기도록 모든 변경을 Query 경계로 보낸다.
  const update = useMutation({ mutationFn: ({ id, value }: { id: string; value: UpdateTransactionInput }) => api.update(id, value), retry: false });
  const remove = useMutation({ mutationFn: ({ id, value }: { id: string; value: DeleteTransactionInput }) => api.remove(id, value), retry: false });
  const items = [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(row => [row.id,row])).values()];
  const loading = accounts.isPending || categories.isPending || query.isPending;
  const failed = accounts.isError || categories.isError || (query.isError && !query.data);
  /** 목록·잔액을 모두 다시 읽는다. 응답 유실 후 닫을 때도 실제 저장 여부를 확인한다. */
  function refresh() { void client.invalidateQueries({ queryKey: coreKeys(userId) }); }
  /** 성공 응답만 저장 완료로 알리고, 현재 필터에 가려질 수 있음을 함께 설명한다. */
  function saved() { setOpen(false); setMessage("거래를 저장했어요. 현재 조회 조건에 따라 목록에 보이지 않을 수 있어요."); refresh(); }
  /** 편집 시작 snapshot을 폐기하고 목록/잔액을 다시 읽는다. 실패를 저장 성공으로 표시하지 않는다. */
  function closeChange() { if (!pending) { setSelected(null); refresh(); } }
  /** @param action 성공한 변경. 필터에서 사라지더라도 서버의 성공 응답 뒤에만 안내한다. */
  function changed(action: "edit" | "delete") { setSelected(null); setMessage(action === "edit" ? "거래를 수정했어요. 현재 조회 조건에 따라 목록에 보이지 않을 수 있어요." : "거래를 삭제했어요. 목록과 잔액을 다시 확인합니다."); refresh(); }
  return <>
    <div className={styles.heading}><div><h1>거래 내역</h1><p>수입과 지출을 기록하고, 날짜와 분류로 흐름을 확인하세요.</p></div><button className={styles.primary} disabled={loading || failed} onClick={() => { setMessage(""); setOpen(true); }}><span aria-hidden="true">+ </span>거래 추가</button></div>
    {message && <Feedback message={message} />}
    <section className={styles.panel} aria-label="거래 목록">
      <div className={styles.toolbar}><h2>나의 거래</h2><button className={styles.button} disabled={query.isFetching || accounts.isFetching || categories.isFetching} onClick={refresh}>새로고침</button></div>
      <TransactionFilters accounts={accounts.data?.items ?? []} categories={categories.data?.items ?? []} onApply={setFilters} />
      {loading ? <Loading label="거래를 불러오는 중…" /> : failed ? <div className={styles.loading}><Feedback error message="목록을 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요." /></div> : <>
        {query.isFetching && !query.isFetchingNextPage && <p className={styles.progress} role="status">최신 거래를 확인하는 중…</p>}
        {items.length ? <TransactionTable items={items} accounts={accounts.data?.items ?? []} categories={categories.data?.items ?? []} onEdit={row => { setMessage(""); setSelected({ row, action: "edit" }); }} onDelete={row => { setMessage(""); setSelected({ row, action: "delete" }); }} /> : <div className={styles.empty}><h3>조회된 거래가 없어요</h3><p>조회 조건을 바꾸거나 첫 수입·지출을 기록해 보세요.</p></div>}
        {query.isError && <Feedback error message="다음 거래를 불러오지 못했어요. 다시 시도해 주세요." />}
        {query.hasNextPage && <div className={styles.pagination}><button className={styles.button} disabled={query.isFetching} onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "불러오는 중…" : "더 보기"}</button></div>}
      </>}
    </section>
    <p className={styles.hint}>현재는 직접 기록하는 장부예요. 은행 자동 수집, 시작 잔액 및 이체 입력은 다음 단계에서 제공할 예정이에요.</p>
    {selected && <LedgerDialog title={selected.action === "edit" ? "거래 수정" : "거래 삭제"} onClose={closeChange}>{selected.action === "edit" ? <TransactionEditForm row={selected.row} accounts={accounts.data?.items ?? []} categories={categories.data?.items ?? []} onSave={value => update.mutateAsync({ id: selected.row.id, value })} onSaved={() => changed("edit")} onPending={setPending} onClose={closeChange} /> : <TransactionDeleteForm row={selected.row} accountName={accounts.data?.items.find(row => row.id === selected.row.accountId)?.name ?? "계좌 정보 확인 필요"} onDelete={value => remove.mutateAsync({ id: selected.row.id, value })} onDeleted={() => changed("delete")} onPending={setPending} onClose={closeChange} />}</LedgerDialog>}
    {open && <LedgerDialog title="거래 추가" onClose={() => { if (!pending) { setOpen(false); refresh(); } }}><TransactionForm accounts={accounts.data?.items ?? []} categories={categories.data?.items ?? []} onSave={value => create.mutateAsync(value)} onSaved={saved} onPending={setPending} onClose={() => { setOpen(false); refresh(); }} /></LedgerDialog>}
  </>;
}
