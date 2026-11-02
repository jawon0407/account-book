// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { PasswordResetRequestForm, PasswordUpdateForm, SignInForm, SignUpForm } from "./auth-form.js";

afterEach(cleanup);

describe("authentication before client hydration", () => {
  for (const Form of [SignInForm, SignUpForm, PasswordResetRequestForm, PasswordUpdateForm]) {
    it(`${Form.name} cannot submit credentials into a URL before JavaScript is ready`, () => {
      const host = document.createElement("div");
      host.innerHTML = renderToString(<Form submit={async () => undefined} />);
      expect(host.querySelector("form")?.method).toBe("post");
      expect(host.querySelector("button")?.disabled).toBe(true);
      expect(host.querySelector("noscript")?.textContent).toContain("JavaScript");
    });

    it(`${Form.name} enables submission after client hydration`, () => {
      render(<Form submit={async () => undefined} />);
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    });
  }
});
