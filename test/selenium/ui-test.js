const {
  EXPECTED_TITLE,
  buildDriver,
  getUrl,
  setupPeer,
  clickElement,
  getBrowserLogs,
  By,
  until,
} = require("./helpers");

async function runUITest() {
  let driver;

  try {
    const url = getUrl();
    driver = await buildDriver();

    const peerId = await setupPeer({
      driver,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "UI Peer",
    });
    console.log(`UI Peer ID: ${peerId}`);

    console.log("Testing theme toggle");
    const bodyClassBefore = await driver
      .findElement(By.tagName("body"))
      .getAttribute("class");
    await clickElement(driver, By.id("theme-toggle"), 10000);
    await driver.wait(async () => {
      const cls = await driver
        .findElement(By.tagName("body"))
        .getAttribute("class");
      return (
        cls.includes("dark-mode") !== bodyClassBefore.includes("dark-mode")
      );
    }, 10000);
    const bodyClassAfter = await driver
      .findElement(By.tagName("body"))
      .getAttribute("class");
    console.log(
      `Theme toggled: dark-mode before=${bodyClassBefore.includes("dark-mode")}, after=${bodyClassAfter.includes("dark-mode")}`,
    );

    console.log("Testing QR code generation");
    await clickElement(driver, By.id("show-qr-btn"), 10000);
    await driver.wait(async () => {
      const container = await driver.findElement(By.id("qr-code-container"));
      const canvases = await container.findElements(By.tagName("canvas"));
      return canvases.length > 0;
    }, 10000);
    console.log("QR code canvas rendered");

    await clickElement(driver, By.id("show-qr-btn"), 10000);

    console.log("Testing invalid partner ID");
    const partnerField = await driver.findElement(By.id("partner-id-field"));
    await partnerField.clear();
    await partnerField.sendKeys("bad id with spaces!!");
    await clickElement(driver, By.id("connect-btn"), 10000);
    await driver.wait(async () => {
      const status = await driver.findElement(By.id("status-id-message"));
      const text = await status.getText();
      return text.length > 0;
    }, 10000);
    console.log("Invalid ID produced a status message");

    console.log("Testing file input presence");
    await driver.findElement(By.id("upload-field"));
    console.log("File upload input present in DOM");

    console.log("Testing page refresh");
    await driver.navigate().refresh();
    await driver.wait(until.titleIs(EXPECTED_TITLE), 20000);
    const newPeerId = await setupPeer({
      driver,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "UI Peer (after refresh)",
    });
    console.log(`New PIN after refresh: ${newPeerId}`);

    console.log("UI Test Results:");
    console.log("Theme toggle works");
    console.log("QR code renders");
    console.log("Invalid ID handled");
    console.log("File upload input present");
    console.log("Page refresh works");
    console.log("All UI tests passed");
  } catch (error) {
    console.error("UI Test failed:", error.message);
    if (driver) await getBrowserLogs(driver, "UI Peer");
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    try {
      if (driver) {
        console.log("Cleaning up UI Peer");
        await driver.quit();
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError.message);
    }
  }
}

runUITest();
