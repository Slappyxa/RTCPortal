const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { DEFAULT_PORT } = require("../../server/config/constants");

const EXPECTED_TITLE = "RTCPortal - P2P Transfer Hub";
const LOCAL_TEST_URL = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/;

// Must exceed the app's own CONNECTION_TIMEOUT (30s) so a genuine handshake
// failure surfaces as the app's "Connection timed out" message rather than a
// harness timeout that races it.
const PEER_CONNECTION_TIMEOUT = 45000;

function buildChromeOptions(extra = []) {
  const options = new chrome.Options();
  options.addArguments("--headless");
  options.addArguments("--no-sandbox");
  options.addArguments("--disable-dev-shm-usage");
  options.addArguments("--window-size=1440,900");
  if (LOCAL_TEST_URL.test(process.env.TEST_URL || "")) {
    options.addArguments("--disable-features=WebRtcHideLocalIpsWithMdns");
  }
  options.setLoggingPrefs({ browser: "ALL" });
  for (const arg of extra) options.addArguments(arg);
  return options;
}

async function buildDriver(extra = []) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(buildChromeOptions(extra))
    .build();
  await driver.manage().setTimeouts({ pageLoad: 30000, implicit: 5000 });
  return driver;
}

function getUrl() {
  return process.env.TEST_URL || `http://localhost:${DEFAULT_PORT}`;
}

async function waitForAssignedPeerId(driver, timeout = 20000) {
  const myIdDisplay = await driver.wait(
    until.elementLocated(By.id("my-id-display")),
    timeout,
  );

  await driver.wait(
    async () => {
      const text = await myIdDisplay.getText();
      return (
        text !== "Waiting for PIN..." &&
        text !== "Waiting for ID..." &&
        text !== "" &&
        text !== "Connection Error" &&
        text.length > 5
      );
    },
    timeout,
    "Waiting for a PIN to be assigned",
  );

  return (await myIdDisplay.getText()).trim();
}

async function setupPeer({ driver, url, expectedTitle, label }) {
  console.log(`Setup ${label}`);
  await driver.get(url);
  console.log(`${label} navigated to: ${url}`);

  await driver.wait(until.titleIs(expectedTitle), 20000);
  console.log(`Page Title: ${await driver.getTitle()}`);

  const peerId = await waitForAssignedPeerId(driver);
  console.log(`${label} ID: ${peerId}`);

  const copyIdButton = await driver.findElement(By.id("copy-id-btn"));
  await driver.wait(until.elementIsVisible(copyIdButton), 20000);
  console.log("Copy ID button visible");

  return peerId;
}

async function waitForVisible(
  driver,
  locator,
  timeout = 20000,
  message = "visible",
) {
  const el = await driver.wait(until.elementLocated(locator), timeout);
  await driver.wait(
    async () => {
      try {
        return await el.isDisplayed();
      } catch {
        return false;
      }
    },
    timeout,
    `Waiting for ${message}`,
  );
  return el;
}

async function waitForHidden(
  driver,
  locator,
  timeout = 20000,
  message = "hidden",
) {
  const el = await driver.wait(until.elementLocated(locator), timeout);
  await driver.wait(
    async () => {
      try {
        return !(await el.isDisplayed());
      } catch {
        return true;
      }
    },
    timeout,
    `Waiting for ${message}`,
  );
  return el;
}

async function clickElement(driver, locator, timeout = 20000) {
  const el = await waitForVisible(driver, locator, timeout, `clickable ${locator}`);
  await driver.executeScript(
    "arguments[0].scrollIntoView({block: 'center'})",
    el,
  );
  await driver.wait(until.elementIsEnabled(el), timeout);
  await el.click();
  return el;
}

async function waitForPeerConnection(driver, expectedPeerId, label) {
  const container = await waitForVisible(
    driver,
    By.id("active-connection-container"),
    PEER_CONNECTION_TIMEOUT,
    "active connection container",
  );

  const status = await driver.findElement(By.id("active-connection-status"));
  await driver.wait(async () => {
    const text = (await status.getText()).trim();
    return text === expectedPeerId;
  }, PEER_CONNECTION_TIMEOUT);
  console.log(`${label} status: Connected to ${expectedPeerId}`);
  return container;
}

async function connectPeers(driver1, driver2, peer2Id, peer1Id) {
  const partnerIdField1 = await driver1.findElement(By.id("partner-id-field"));
  const connectButton1 = await driver1.findElement(By.id("connect-btn"));

  await partnerIdField1.clear();
  await partnerIdField1.sendKeys(peer2Id);
  await driver1.wait(until.elementIsEnabled(connectButton1), 20000);

  await connectButton1.click();

  console.log("Waiting for connection");
  await waitForPeerConnection(driver1, peer2Id, "Peer 1");
  await waitForPeerConnection(driver2, peer1Id, "Peer 2");
}

async function transferFile(
  driverFrom,
  driverTo,
  filePath,
  fileName,
  timeout = 45000,
) {
  const fileInput = await driverFrom.findElement(By.id("upload-field"));
  await fileInput.sendKeys(filePath);
  console.log(`File selected: ${fileName}`);

  const fileTransferBtn = await driverFrom.findElement(
    By.id("file-transfer-btn"),
  );
  await driverFrom.wait(until.elementIsEnabled(fileTransferBtn), 10000);
  await fileTransferBtn.click();
  console.log("File transfer initiated");

  await driverFrom.wait(
    async () => {
      try {
        const statusDiv = await driverFrom.findElement(
          By.id("transfer-status-sent"),
        );
        const text = await statusDiv.getText();
        return text.toLowerCase().includes("sent");
      } catch {
        return false;
      }
    },
    timeout,
    "Waiting for file transfer to complete",
  );
  console.log("File transfer completed on sender");

  await driverTo.wait(
    async () => {
      try {
        const incomingFiles = await driverTo.findElement(
          By.id("incoming-files"),
        );
        const text = await incomingFiles.getText();
        return text.includes(fileName);
      } catch {
        return false;
      }
    },
    timeout,
    `Waiting for ${fileName} on receiver`,
  );
  console.log(`File verified on receiver: ${fileName}`);
}

async function sendChatMessage(driver, text) {
  const chatInput = await driver.findElement(By.id("chat-input"));
  await chatInput.clear();
  await chatInput.sendKeys(text);
  const sendBtn = await driver.findElement(By.id("send-chat-btn"));
  await sendBtn.click();
}

async function verifyChatMessage(driver, text) {
  await driver.wait(
    async () => {
      const chatBox = await driver.findElement(By.id("chat-box"));
      const content = await chatBox.getText();
      return content.includes(text);
    },
    15000,
    `Waiting for chat message: ${text}`,
  );
  console.log(`Chat message verified: ${text}`);
}

async function getBrowserLogs(driver, label) {
  try {
    const entries = await driver.manage().logs().get("browser");
    if (!entries.length) {
      console.log(`${label}: no browser log entries`);
      return;
    }
    for (const entry of entries) {
      console.log(`${label} [${entry.level.name}] ${entry.message}`);
    }
  } catch (error) {
    console.log(`${label}: browser logs unavailable (${error.message})`);
  }
}

module.exports = {
  EXPECTED_TITLE,
  buildDriver,
  getUrl,
  waitForAssignedPeerId,
  setupPeer,
  waitForVisible,
  waitForHidden,
  clickElement,
  waitForPeerConnection,
  connectPeers,
  transferFile,
  sendChatMessage,
  verifyChatMessage,
  getBrowserLogs,
  By,
  until,
};
