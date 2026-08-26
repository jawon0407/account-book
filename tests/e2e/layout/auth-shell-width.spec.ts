import { expect, test } from "@playwright/test";

test("authentication shell follows the approved desktop viewport widths", async ({
  page,
}) => {
  await page.goto("/login");

  // Each pair represents [viewport width, approved authentication content width] in CSS pixels.
  for (const [viewportWidth, expectedShellWidth] of [
    [1080, 648],
    [1920, 1152],
    [1921, 1080],
  ] as const) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await expect(page.locator(".auth-shell")).toHaveJSProperty(
      "clientWidth",
      expectedShellWidth,
    );
  }
});

test("authentication shell pixel cap is independent of the page root font size", async ({ page }) => {
  await page.goto("/login");
  await page.setViewportSize({ width: 1921, height: 900 });
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "20px";
  });

  await expect(page.locator(".auth-shell")).toHaveJSProperty("clientWidth", 1080);
});
