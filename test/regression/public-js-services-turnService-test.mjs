import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  bundleModule,
  createBundleDir,
  PUBLIC_JS,
} from "./helpers/bundle-client-module.mjs";
import { setupJSDOMEnv, teardownJSDOMEnv } from "./helpers/setup-jsdom-env.mjs";

let bundleDir;
let originalFetch;

beforeEach(() => {
  setupJSDOMEnv();
  bundleDir = createBundleDir();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  teardownJSDOMEnv();
  globalThis.fetch = originalFetch;
});

async function loadTurnService(fetchImpl) {
  globalThis.fetch = fetchImpl;
  const mod = await bundleModule(
    path.join(PUBLIC_JS, "services/turnService.js"),
    bundleDir,
  );
  return mod.turnService;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  };
}

test("in development mode no TURN request is made and no token is issued", async () => {
  const requested = [];
  const service = await loadTurnService(async (url) => {
    requested.push(url);
    return jsonResponse({});
  });

  await service.awaitReady();
  assert.deepEqual(requested, [], "dev mode must not call the TURN endpoints");
  assert.equal(service._token, null);
});

test("rtcConfig starts from the default RTC config", async () => {
  const service = await loadTurnService(async () => jsonResponse({}));
  await service.awaitReady();

  const config = service.getRtcConfig();
  assert.ok(Array.isArray(config.iceServers));
  assert.ok(
    config.iceServers.length > 0,
    "default STUN servers must be present even without TURN",
  );
});

test("getRtcConfig returns the same reference handed to peer connections", async () => {
  const service = await loadTurnService(async () => jsonResponse({}));
  await service.awaitReady();
  assert.equal(service.getRtcConfig(), service.rtcConfig);
});

test("a valid token appends the returned TURN servers after the defaults", async () => {
  const turnServers = [
    { urls: "turn:relay.example.com:443", username: "u", credential: "c" },
  ];

  const service = await loadTurnService(async (url) => {
    if (url.includes("/turn-token")) {
      return jsonResponse({ token: "abc.def", expiresIn: 300000 });
    }
    return jsonResponse(turnServers);
  });

  const defaultCount = service.getRtcConfig().iceServers.length;
  await service._refreshTurnCredentials();

  const merged = service.getRtcConfig().iceServers;
  assert.equal(merged.length, defaultCount + turnServers.length);
  assert.deepEqual(merged[merged.length - 1], turnServers[0]);
  assert.ok(service._tokenExpiresAt > Date.now());
});

test("a malformed token is rejected and the default STUN servers survive", async () => {
  let credentialCalls = 0;

  const service = await loadTurnService(async (url) => {
    if (url.includes("/turn-credentials")) credentialCalls++;
    return jsonResponse({ token: 12345 });
  });

  const before = service.getRtcConfig().iceServers.length;
  await service._refreshTurnCredentials();

  assert.equal(
    credentialCalls,
    0,
    "a non-string token must abort before the credentials request",
  );
  assert.equal(service.getRtcConfig().iceServers.length, before);
  assert.equal(service._token, null);
});

test("an empty TURN server list leaves the STUN defaults untouched", async () => {
  const service = await loadTurnService(async (url) => {
    if (url.includes("/turn-token")) {
      return jsonResponse({ token: "abc.def", expiresIn: 300000 });
    }
    return jsonResponse([]);
  });

  const before = service.getRtcConfig().iceServers.length;
  await service._refreshTurnCredentials();
  assert.equal(service.getRtcConfig().iceServers.length, before);
});

test("a network failure while fetching TURN degrades instead of throwing", async () => {
  const service = await loadTurnService(async () => {
    throw new Error("network down");
  });

  const before = service.getRtcConfig().iceServers.length;
  await assert.doesNotReject(
    service._refreshTurnCredentials(),
    "TURN failure must degrade to STUN-only, not break connection setup",
  );
  assert.equal(service.getRtcConfig().iceServers.length, before);
  assert.equal(service._tokenExpiresAt, 0);
});

test("a failed refresh clears a previously valid expiry so the next call retries", async () => {
  let failNext = false;

  const service = await loadTurnService(async (url) => {
    if (url.includes("/turn-token")) {
      if (failNext) throw new Error("network down");
      return jsonResponse({ token: "abc.def", expiresIn: 300000 });
    }
    return jsonResponse([]);
  });

  await service._refreshTurnCredentials();
  assert.ok(
    service._tokenExpiresAt > Date.now(),
    "precondition: a successful refresh must cache a future expiry",
  );

  failNext = true;
  await service._refreshTurnCredentials();
  assert.equal(
    service._tokenExpiresAt,
    0,
    "a failed refresh must clear the cached expiry, otherwise _ensureTokenFresh keeps treating the stale token as valid",
  );

  failNext = false;
  await service._refreshTurnCredentials();
  assert.ok(
    service._tokenExpiresAt > Date.now(),
    "the retry after a failure must issue a fresh token",
  );
});

test("concurrent refreshes share a single in-flight request", async () => {
  let tokenCalls = 0;

  const service = await loadTurnService(async (url) => {
    if (url.includes("/turn-token")) {
      tokenCalls++;
      return jsonResponse({ token: "abc.def", expiresIn: 300000 });
    }
    return jsonResponse([]);
  });

  await Promise.all([
    service._refreshTurnCredentials(),
    service._refreshTurnCredentials(),
    service._refreshTurnCredentials(),
  ]);

  assert.equal(
    tokenCalls,
    1,
    "concurrent refreshes must coalesce onto one request, not stampede the server",
  );
});
