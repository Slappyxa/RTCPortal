/* global window */

const {
  buildDriver,
  getUrl,
  EXPECTED_TITLE,
  getBrowserLogs,
} = require("./helpers");

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

const ICE_GATHERING_TIMEOUT = 30000;

function resolveApiBaseUrl(url) {
  const { hostname } = new URL(url);
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);

  return isLocal ? new URL(url).origin : "https://rtcportal.onrender.com";
}

async function gatherCandidateTypes(driver, rtcConfig, requiredType) {
  const result = await driver.executeAsyncScript(
    (config, timeout, expectedType, done) => {
      let peerConnection;
      let timer;
      let finished = false;
      const candidateTypes = new Set();

      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        peerConnection?.close();
        done(
          error
            ? { error }
            : {
                candidateTypes: [...candidateTypes],
                timedOut: false,
              },
        );
      };

      try {
        peerConnection = new window.RTCPeerConnection(config);
        peerConnection.createDataChannel("ice-route-test");
        peerConnection.onicecandidate = (event) => {
          if (!event.candidate) {
            finish();
            return;
          }

          const candidateType =
            event.candidate.candidateType ||
            /\btyp\s+([a-z]+)/i.exec(event.candidate.candidate)?.[1];
          if (candidateType) {
            const normalizedType = candidateType.toLowerCase();
            candidateTypes.add(normalizedType);
            if (normalizedType === expectedType) finish();
          }
        };
        peerConnection.onicegatheringstatechange = () => {
          if (peerConnection.iceGatheringState === "complete") finish();
        };
        timer = setTimeout(
          () => {
            if (finished) return;
            finished = true;
            peerConnection?.close();
            done({
              candidateTypes: [...candidateTypes],
              timedOut: true,
            });
          },
          timeout,
        );

        peerConnection
          .createOffer()
          .then((offer) => peerConnection.setLocalDescription(offer))
          .catch((error) => finish(error.message));
      } catch (error) {
        finish(error.message);
      }
    },
    rtcConfig,
    ICE_GATHERING_TIMEOUT,
    requiredType,
  );

  if (result.error) {
    throw new Error(result.error);
  }
  return result;
}

async function fetchTurnServers(driver, apiBaseUrl) {
  const result = await driver.executeAsyncScript((apiBase, done) => {
    (async () => {
      const tokenResponse = await fetch(`${apiBase}/api/turn-token`);
      if (!tokenResponse.ok) {
        throw new Error(`TURN token request failed with ${tokenResponse.status}`);
      }
      const { token } = await tokenResponse.json();
      if (!token) throw new Error("TURN token response did not contain a token");

      const credentialsResponse = await fetch(
        `${apiBase}/api/turn-credentials?token=${encodeURIComponent(token)}`,
      );
      if (!credentialsResponse.ok) {
        throw new Error(
          `TURN credentials request failed with ${credentialsResponse.status}`,
        );
      }
      const turnServers = await credentialsResponse.json();
      if (!Array.isArray(turnServers) || turnServers.length === 0) {
        throw new Error("TURN credentials response contained no servers");
      }
      done({ turnServers });
    })().catch((error) => done({ error: error.message }));
  }, apiBaseUrl);

  if (result.error) throw new Error(result.error);
  return result.turnServers;
}

async function runIceRouteTest() {
  let driver;

  try {
    const url = getUrl();
    driver = await buildDriver();
    await driver.manage().setTimeouts({
      script: ICE_GATHERING_TIMEOUT + 10000,
    });
    await driver.get(url);
    await driver.wait(async () => (await driver.getTitle()) === EXPECTED_TITLE, 20000);

    const stunResult = await gatherCandidateTypes(
      driver,
      {
      iceServers: STUN_SERVERS,
      iceTransportPolicy: "all",
      },
      "srflx",
    );
    if (!stunResult.candidateTypes.includes("srflx")) {
      throw new Error(
        `STUN did not produce a server-reflexive candidate: ${stunResult.candidateTypes.join(", ")}`,
      );
    }
    console.log(`STUN verified: ${stunResult.candidateTypes.join(", ")}`);

    const turnServers = await fetchTurnServers(
      driver,
      resolveApiBaseUrl(url),
    );
    const turnResult = await gatherCandidateTypes(
      driver,
      {
        iceServers: turnServers,
        iceTransportPolicy: "relay",
      },
      "relay",
    );
    if (!turnResult.candidateTypes.includes("relay")) {
      throw new Error(
        `TURN did not produce a relay candidate: ${turnResult.candidateTypes.join(", ")}`,
      );
    }
    console.log(`TURN verified: ${turnResult.candidateTypes.join(", ")}`);
    console.log("STUN and TURN route tests passed");
  } catch (error) {
    console.error("ICE route test failed:", error.message);
    if (driver) await getBrowserLogs(driver, "ICE route test");
    process.exitCode = 1;
  } finally {
    if (driver) await driver.quit();
  }
}

runIceRouteTest();
