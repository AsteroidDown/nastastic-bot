import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMovieRequest,
  parseShowRequest,
} from "../src/parsing/requests.js";

test("parses a movie request", () => {
  const result = parseMovieRequest("Superbad 2011 1080p");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.title, "Superbad");
  assert.equal(result.value.year, 2011);
  assert.equal(result.value.qualityToken, "1080p");
});

test("parses a movie request without quality", () => {
  const result = parseMovieRequest("Superbad 2011");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.qualityToken, undefined);
});

test("parses a full show request", () => {
  const result = parseShowRequest("Severance 2022 Full 1080p");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.title, "Severance");
  assert.equal(result.value.scope, "full");
  assert.equal(result.value.monitorWholeShow, true);
});

test("parses a season show request", () => {
  const result = parseShowRequest("Severance 2022 Season 2 2160p");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.scope, "season");
  assert.equal(result.value.seasonNumber, 2);
  assert.equal(result.value.monitorWholeShow, true);
});

test("defaults show requests to season one", () => {
  const result = parseShowRequest("Severance 2022 1080p");
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.value.scope, "season");
  assert.equal(result.value.seasonNumber, 1);
  assert.equal(result.value.monitorWholeShow, false);
});

test("rejects episode show requests", () => {
  const result = parseShowRequest("Severance 2022 S01E03 1080p");
  assert.equal(result.ok, false);
});
