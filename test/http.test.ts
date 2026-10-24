import assert from "node:assert/strict";
import test from "node:test";
import { ArrApiError, ArrHttpClient, ArrRequestError } from "../src/arr/http.js";
import { formatRequestFailure } from "../src/discord/messages.js";

function closedSocket(): Error {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
  });
}

test("read retry stops after two socket failures and preserves diagnostic context", async (t) => {
  t.mock.method(console, "warn", () => {});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw closedSocket(); });
  const client = new ArrHttpClient("http://sonarr.test", "secret-test-key");
  await assert.rejects(client.get("/api/v3/release", { episodeId: 1 }), (error: unknown) => {
    assert.ok(error instanceof ArrRequestError);
    assert.equal(error.method, "GET");
    assert.equal(error.path, "/api/v3/release");
    assert.equal(error.kind, "connection");
    assert.ok(error.cause instanceof TypeError);
    const message = formatRequestFailure(error);
    assert.match(message, /connection.*interrupted/);
    assert.doesNotMatch(message, /secret-test-key|sonarr.test|episodeId/);
    return true;
  });
  assert.equal(calls, 2);
});

for (const method of ["post", "put"] as const) {
  test(`${method.toUpperCase()} is never retried after a socket error`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; throw closedSocket(); });
    const client = new ArrHttpClient("http://sonarr.test", "test");
    await assert.rejects(client[method]("/api/v3/release", {}), ArrRequestError);
    assert.equal(calls, 1);
  });
}

test("HTTP errors remain distinct from broken connections and are not retried", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("Private server details", { status: 401 });
  });
  const client = new ArrHttpClient("http://sonarr.test", "test");
  await assert.rejects(client.get("/api/v3/release"), (error: unknown) => {
    assert.ok(error instanceof ArrApiError);
    assert.equal(error.status, 401);
    assert.equal(error.responseBody, "Private server details");
    assert.match(formatRequestFailure(error), /HTTP 401/);
    assert.doesNotMatch(formatRequestFailure(error), /Private server details/);
    return true;
  });
  assert.equal(calls, 1);
});

test("interactive searches can have a longer timeout without changing metadata requests", async (t) => {
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  const client = new ArrHttpClient("http://sonarr.test", "test");
  await client.get("/api/v3/series");
  await client.get("/api/v3/release", { episodeId: 1 }, 60_000);
  assert.deepEqual(timeouts, [30_000, 60_000]);
});

test("aborted requests report a timeout and do not retry", async (t) => {
  const controller = new AbortController();
  controller.abort();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw controller.signal.reason; });
  const client = new ArrHttpClient("http://sonarr.test", "test");
  await assert.rejects(client.get("/api/v3/release"), (error: unknown) => {
    assert.ok(error instanceof ArrRequestError);
    assert.equal(error.kind, "timeout");
    assert.match(formatRequestFailure(error), /too long to respond/);
    return true;
  });
  assert.equal(calls, 1);
});
