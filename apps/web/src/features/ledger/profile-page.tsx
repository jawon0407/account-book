"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UpdateProfileInputSchema } from "@account-book/contracts";
import { useLedgerApi, useLedgerUser } from "./session.js";
import { profileQuery } from "./query-options.js";
import { errorMessage, Feedback, Loading, needsReload } from "./feedback.js";
import styles from "./ledger.module.css";

const providers = { email: "이메일", google: "Google", kakao: "Kakao", naver: "Naver", unknown: "확인되지 않음" };

/** 본인 공개 프로필만 보여 준다. 닉네임 입력 시작 시의 버전을 유지하여 동시 수정 충돌을 감지한다. */
export function ProfilePage() {
  const id = useLedgerUser();
  const ledgerApi = useLedgerApi();
  const client = useQueryClient();
  const options = profileQuery(id, ledgerApi);
  const query = useQuery(options);
  const mutation = useMutation({ mutationFn: ledgerApi.profile.update, retry: false });
  const [nickname, setNickname] = useState<string | null>(null);
  const version = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  const active = useRef(false);
  // 화면이 닫힌 뒤 도착한 저장 응답이 지워진 사용자 캐시를 다시 만들지 못하게 한다.
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const profile = query.data;

  /** @param event 제출 이벤트. 공백 닉네임은 미설정(null)으로 저장하고 role 등은 전송하지 않는다. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile || busy.current || needsReload(mutation.error)) return;
    const input = UpdateProfileInputSchema.safeParse({ nickname: (nickname ?? profile.nickname ?? "").trim() || null, expectedVersion: version.current ?? profile.version });
    if (!input.success) { setValidation("닉네임은 50자 이내로 입력해 주세요."); return; }
    busy.current = true; setValidation(""); setNotice("");
    try {
      const result = await mutation.mutateAsync(input.data);
      if (!active.current) return;
      client.setQueryData(options.queryKey, result);
      setNickname(null); version.current = undefined; setNotice("닉네임을 저장했어요.");
    } catch { /* useMutation의 공개 오류를 아래에서 안내하며 입력을 유지한다. */ }
    finally { busy.current = false; }
  }
  return <>
    <div className={styles.heading}><div><h1>내 정보</h1><p>장부에서 사용할 이름과 가입 정보를 확인하세요.</p></div></div>
    <section className={`${styles.panel} ${styles.profile}`} aria-label="내 프로필">
      {query.isPending ? <Loading /> : query.isError || !profile ? <><Feedback error message="프로필을 불러오지 못했어요." /><button className={styles.button} onClick={() => { void query.refetch(); }}>다시 시도</button></> : <>
        <dl className={styles.details}><dt>가입 경로</dt><dd>{providers[profile.signupProvider]}</dd><dt>계정 권한</dt><dd>{profile.role === "admin" ? "관리자" : "일반 회원"}</dd></dl>
        <form className={styles.form} onSubmit={(event) => { void submit(event); }} noValidate>
          <fieldset disabled={mutation.isPending}><label htmlFor="profile-nickname">닉네임</label><input id="profile-nickname" maxLength={50} value={nickname ?? profile.nickname ?? ""} onChange={(event) => { if (nickname === null) version.current = profile.version; setNickname(event.target.value); setNotice(""); }} autoComplete="off" aria-describedby="nickname-hint" /><p id="nickname-hint" className={styles.hint}>최대 50자. 비워 두면 닉네임을 사용하지 않아요.</p></fieldset>
          {validation && <Feedback error message={validation} />}
          {mutation.isError && <Feedback error message={errorMessage(mutation.error)} />}
          {notice && <Feedback message={notice} />}
          <div className={styles.actions}>{needsReload(mutation.error) && <button type="button" className={styles.button} onClick={() => { setNickname(null); version.current = undefined; mutation.reset(); void query.refetch(); }}>최신 정보 불러오기</button>}<button className={styles.primary} disabled={mutation.isPending || needsReload(mutation.error) || query.isFetching}>{mutation.isPending ? "저장 중…" : "저장하기"}</button></div>
        </form>
      </>}
    </section>
  </>;
}
