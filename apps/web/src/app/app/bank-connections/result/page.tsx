import { BankConnectionRequestIdSchema } from "@account-book/contracts";
import { BankResultPage } from "../../../../features/ledger/bank-connections/result-page.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "은행 연결 결과 · Account Book", referrer: "no-referrer" as const };
/** @param searchParams Next 비동기 URL 매개변수. code/state·중복·추가 매개변수는 렌더링하지 않는다. */
export default async function Page({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const query = await searchParams;
  const parsed = BankConnectionRequestIdSchema.safeParse(query.requestId);
  const id = Object.keys(query).length === 1 && parsed.success && parsed.data === parsed.data.toLowerCase() ? parsed.data : null;
  return <BankResultPage requestId={id} />;
}
