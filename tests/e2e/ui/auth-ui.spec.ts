import { authTest } from "../support/safe-ui-test.js";

const email = "verified@example.test";
const password = "correct horse battery staple";

authTest("login is responsive, labelled, keyboard reachable, and axe-clean", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.assertLoginUsable();
});

authTest("failed login stays fixed and never creates browser token state", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.submit({ email, password: `${password}!wrong` });
  await authUi.assertRejected();
  await authUi.assertNoBrowserCredentials();
  await authUi.assertNoAuthorizationHeaders();
});

authTest("successful login creates only an opaque cookie and reaches the application route", async ({ authUi }) => {
  await authUi.openLogin();
  await authUi.submit({ email, password });
  await authUi.assertAuthenticated();
  await authUi.assertNoBrowserCredentials();
  await authUi.assertNoAuthorizationHeaders();
});
