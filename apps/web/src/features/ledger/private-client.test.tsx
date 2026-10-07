// @vitest-environment jsdom
import { StrictMode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePrivateClient } from "./private-client.js";
afterEach(cleanup);

it("finishes a query through React StrictMode's cleanup/remount rehearsal", async () => {
  function Reader() {
    const query = useQuery({ queryKey: ["ledger", "synthetic-user"], queryFn: async () => { await new Promise((r) => setTimeout(r, 10)); return "loaded"; } });
    return <p>{query.data ?? "pending"}</p>;
  }
  function Workspace() {
    const client = usePrivateClient(() => undefined);
    return <QueryClientProvider client={client}><Reader /></QueryClientProvider>;
  }
  render(<StrictMode><Workspace /></StrictMode>);
  expect(await screen.findByText("loaded")).toBeTruthy();
});
