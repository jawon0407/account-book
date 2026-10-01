import type { Account, Category, Transaction } from "@account-book/contracts";
import { transactionLabels } from "./transaction-filters.js";
import styles from "../ledger.module.css";
const krw = new Intl.NumberFormat("ko-KR");
/** @param props 공개 거래와 참조 목록. 종류·부호를 함께 표시하고 금융 메모를 HTML로 해석하지 않는다. */
export function TransactionTable({ items, accounts, categories }: Readonly<{ items: Transaction[]; accounts: Account[]; categories: Category[] }>) {
  const names = new Map(accounts.map(row => [row.id,row.name])), labels = new Map(categories.map(row => [row.id,row.name]));
  return <div className={styles.tableScroll} role="region" aria-label="거래 표" tabIndex={0}><table className={`${styles.table} ${styles.transactionTable}`}><thead><tr>{["거래일","종류","계좌","카테고리","메모"].map(label => <th key={label} scope="col">{label}</th>)}<th scope="col" className={styles.number}>금액</th></tr></thead><tbody>{items.map(row => {
    const plus = row.kind === "income" || row.kind === "transfer_in" || (row.kind === "opening_balance" && row.direction === "asset");
    return <tr key={row.id}><td className={styles.date}>{row.occurredOn}</td><td><span className={styles.badge}>{transactionLabels[row.kind]}</span></td><td className={styles.name}>{names.get(row.accountId) ?? "계좌 정보 확인 필요"}</td><td>{row.categoryId ? labels.get(row.categoryId) ?? "분류 정보 확인 필요" : "—"}</td><td className={styles.memo}>{row.memo ?? "—"}</td><td className={`${styles.number} ${plus ? styles.income : ""}`}>{plus ? "+" : "−"}{krw.format(row.amountKrw)}원</td></tr>;
  })}</tbody></table></div>;
}
