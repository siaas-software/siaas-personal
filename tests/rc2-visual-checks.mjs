// Invoked by the real Playwright structured API scenario (--ui).
// These assertions are not a substitute for actually running a browser.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
export async function verifyRc2Visuals(
  page,
  api,
  project,
  assistant,
  otherProject,
  otherAssistant,
) {
  await mkdir("test-results/rc2-ui", { recursive: true });
  for (const [name, color, rgb] of [
    ["lavender", "#F0EAFE", "rgb(240, 234, 254)"],
    ["mint", "#E5F7EE", "rgb(229, 247, 238)"],
    ["sky", "#E9F0FA", "rgb(233, 240, 250)"],
  ]) {
    await api(`/api/projects/${project.id}`, "PATCH", {
      name: project.name,
      color,
    });
    await page.goto(
      new URL(`/?project=${project.id}&assistant=${assistant.id}`, page.url())
        .href,
    );
    await page.locator(".assistant-workbench").waitFor();
    await page
      .getByRole("heading", { name: "Structured Data Analysis", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(".project-detail")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb,
    );
    for (const selector of [
      ".knowledge-panel",
      ".workbench-chat",
      ".chat-layout",
      ".shortcut-sidebar",
      ".assistant-heading .assistant-icon",
      ".chat-top .assistant-icon",
      ".app-footer",
    ])
      assert.equal(
        await page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(255, 255, 255)",
        selector,
      );
    assert.equal(
      await page.locator(".structured-advanced").getAttribute("open"),
      null,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Confirm mapping", exact: true })
        .first()
        .isVisible(),
      false,
    );
    assert.notEqual(
      await page
        .locator(".knowledge-panel .button.primary")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await page.screenshot({
      path: `test-results/rc2-ui/${name}.png`,
      fullPage: true,
    });
  }
  // Visit a separate project and return: the palette must follow project identity.
  await api(`/api/projects/${otherProject.id}`, "PATCH", {
    name: otherProject.name,
    color: "#E5F7EE",
  });
  for (const [p, a, rgb] of [
    [otherProject, otherAssistant, "rgb(229, 247, 238)"],
    [project, assistant, "rgb(233, 240, 250)"],
  ]) {
    await page.goto(
      new URL(`/?project=${p.id}&assistant=${a.id}`, page.url()).href,
    );
    await page.locator(".assistant-workbench").waitFor();
    assert.equal(
      await page
        .locator(".project-detail")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      rgb,
    );
  }
  const button = page.locator(".send-button");
  assert(await button.isDisabled(), "idle empty composer remains disabled");
  await page.getByPlaceholder("Type a message…").fill("Quanto fa 2 + 2?");
  assert(await button.isEnabled());
  let release;
  const responseHeld = new Promise((r) => {
    release = r;
  });
  await page.route("**/api/chat", async (route) => {
    await responseHeld;
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({ type: "delta", text: "4" }) +
        "\n" +
        JSON.stringify({ type: "done" }) +
        "\n",
    });
  });
  try {
    await button.click();
    await page.locator('.send-button[aria-busy="true"]').waitFor();
    assert(await button.isDisabled());
    const style = await button.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      opacity: getComputedStyle(el).opacity,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    assert.equal(style.bg, "rgb(229, 231, 235)");
    assert.equal(style.opacity, "1");
    assert.equal(style.width, 36);
    assert.equal(style.height, 36);
    assert.equal(await button.locator(".siaas-loading-star").count(), 2);
    const box = await button.locator("svg").boundingBox(),
      parent = await button.boundingBox();
    assert(
      box.x >= parent.x &&
        box.y >= parent.y &&
        box.x + box.width <= parent.x + parent.width &&
        box.y + box.height <= parent.y + parent.height,
    );
    const delays = await button
      .locator(".siaas-loading-star")
      .evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).animationDelay),
      );
    assert.notEqual(delays[0], delays[1]);
    await page.screenshot({
      path: "test-results/rc2-ui/generating.png",
      fullPage: true,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const animation of await button
      .locator(".siaas-loading-star")
      .evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).animationName),
      ))
      assert.equal(animation, "none");
    release();
    await page.locator('.send-button[aria-busy="false"]').waitFor();
  } finally {
    release();
    await page.unroute("**/api/chat");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  console.log(
    "PASS actual browser: three palettes, white panels, retained functional green, advanced settings hidden, idle/generating/disabled states, original stars, reduced motion and screenshots.",
  );
}
