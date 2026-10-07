import { BankStartPage } from "../../../features/ledger/bank-connections/start-page.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "은행 연결 · Account Book", referrer: "no-referrer" as const };
/** 공식 endpoint·설정 검증이 끝나기 전에는 시작 버튼을 노출해도 활성화하지 않는다. */
export default function Page() { return <BankStartPage />; }
