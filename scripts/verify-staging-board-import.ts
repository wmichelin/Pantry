// Staging-only public HTTPS acceptance for recoverable board imports. Test
// credentials stay in memory; the script never uses an administrator token.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { BoardImportEventKind, BoardImportItemStatus, BoardImportService } from "../lib/gen/pantry/v1/board_import_pb";
import { importBoard, pantryConnectTransport, type BoardRecipeImport } from "../lib/pantry-api";
import { identity, origin, publicKey, rest, rpc } from "./verify-staging-recipe-import.mjs";

type RecordedEvent = {
  kind: BoardImportEventKind;
  itemIndex: number;
  title: string;
  status: BoardImportItemStatus;
  recipeID?: string;
  processed: number;
  total: number;
  saved: number;
  skipped: number;
  failed: number;
  failedTitles: string[];
  catalogWarning: boolean;
  receivedAt: number;
};

function item(householdID: string, index: number, title: string, sourceURL: string, rawIngredients = ["Salt"]): BoardRecipeImport {
  return {
    household_id: householdID,
    item_index: index,
    title,
    raw_ingredients: rawIngredients,
    ingredients: [],
    metadata: {
      source_url: sourceURL,
      source_type: "url",
      image_url: "",
      instructions: ["Second", "First"],
      tags: ["edited", ""],
      servings: 0,
      cook_time_minutes: 8,
    },
  };
}

function wireItems(items: BoardRecipeImport[]) {
  return items.map((value) => ({
    itemIndex: value.item_index,
    title: value.title,
    rawIngredients: value.raw_ingredients,
    metadata: {
      sourceUrl: value.metadata.source_url,
      sourceType: value.metadata.source_type,
      imageUrl: value.metadata.image_url,
      instructions: value.metadata.instructions,
      tags: value.metadata.tags,
      servings: value.metadata.servings,
      prepTimeMinutes: value.metadata.prep_time_minutes,
      cookTimeMinutes: value.metadata.cook_time_minutes,
    },
  }));
}

async function collectStream(
  token: string,
  householdID: string,
  operationID: string,
  items: BoardRecipeImport[],
  options: {
    signal?: AbortSignal;
    onEvent?: (event: RecordedEvent) => void;
    onResponse?: (response: Response) => void;
  } = {},
) {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    options.onResponse?.(response);
    return response;
  };
  const client = createClient(BoardImportService, pantryConnectTransport(origin, token, fetcher));
  const events: RecordedEvent[] = [];
  const requestOptions = options.signal ? { signal: options.signal } : undefined;
  for await (const response of client.importBoard({
    householdId: householdID,
    operationId: operationID,
    items: wireItems(items),
  }, requestOptions)) {
    const event: RecordedEvent = {
      kind: response.kind,
      itemIndex: response.itemIndex,
      title: response.title,
      status: response.status,
      recipeID: response.recipe?.id,
      processed: response.processed,
      total: response.total,
      saved: response.saved,
      skipped: response.skipped,
      failed: response.failed,
      failedTitles: [...response.failedTitles],
      catalogWarning: response.catalogWarning,
      receivedAt: Date.now(),
    };
    events.push(event);
    options.onEvent?.(event);
  }
  return events;
}

function itemEvents(events: RecordedEvent[]) {
  return events.filter((event) => event.kind === BoardImportEventKind.ITEM);
}

function assertComplete(events: RecordedEvent[], items: BoardRecipeImport[]) {
  assert.equal(events.length, items.length + 2, "Stream returned an unexpected event count");
  assert.equal(events[0]?.kind, BoardImportEventKind.PREFLIGHTED, "Stream did not begin with preflight");
  assert.equal(events[0]?.total, items.length);
  assert.equal(events.at(-1)?.kind, BoardImportEventKind.COMPLETE, "Stream did not end with completion");
  const progress = itemEvents(events);
  assert.deepEqual(progress.map((event) => event.itemIndex), items.map((value) => value.item_index));
  assert.deepEqual(progress.map((event) => event.processed), items.map((_, index) => index + 1));
  assert.equal(progress.at(-1)?.processed, items.length);
  assert.equal(progress.at(-1)!.saved + progress.at(-1)!.skipped + progress.at(-1)!.failed, items.length);
  const complete = events.at(-1)!;
  const last = progress.at(-1)!;
  assert.deepEqual(
    [complete.processed, complete.total, complete.saved, complete.skipped, complete.failed, complete.failedTitles, complete.catalogWarning],
    [last.processed, last.total, last.saved, last.skipped, last.failed, last.failedTitles, last.catalogWarning],
    "Completion did not exactly match final progress",
  );
}

async function expectConnectRejected(action: () => Promise<unknown>, label: string, expectedCodes: Code[]) {
  let rejection: unknown;
  try {
    await action();
  } catch (error) {
    rejection = error;
  }
  assert(rejection, `${label} was accepted`);
  const code = ConnectError.from(rejection).code;
  assert(expectedCodes.includes(code), `${label} returned unexpected Connect code ${code}`);
}

async function recipeRows(key: string, token: string, householdID: string) {
  return rest(key, token, `recipes?select=id,title,source_url,source_type,image_url,instructions,tags,servings,prep_time_minutes,cook_time_minutes,recipe_ingredients(name,quantity,unit,raw_string)&household_id=eq.${householdID}`);
}

async function verify() {
  const key = await publicKey();
  const owner = await identity(key, "board-owner");
  const member = await identity(key, "board-member");
  const outsider = await identity(key, "board-outsider");
  const created = await rpc(owner.token, "HouseholdService/CreateHousehold", { name: "Go Board Import Acceptance", displayName: "Owner" });
  assert.equal(created.status, 200);
  const householdID = created.body.household.id as string;
  assert.equal((await rpc(member.token, "HouseholdService/JoinHousehold", {
    inviteCode: created.body.household.inviteCode,
    displayName: "Member",
  })).status, 200);

  const storedURL = `https://example.invalid/board-stored-${randomUUID()}`;
  const newURL = `https://example.invalid/board-new-${randomUUID()}`;
  await rest(key, owner.token, "recipes", "POST", {
    household_id: householdID,
    created_by: owner.id,
    title: "Stored exact URL",
    source_url: storedURL,
    source_type: "url",
  });

  const board = [
    item(householdID, 4, "Stored request title", storedURL),
    item(householdID, 9, "Saved exact metadata", newURL, ["0 cups Water", "Salt"]),
    item(householdID, 11, "Same-batch duplicate", newURL),
    item(householdID, 20, "URL-less saved", "", ["Pepper"]),
  ];
  const operationID = randomUUID();
  const responseHeaders: Record<string, string | null> = {};
  const first = await collectStream(owner.token, householdID, operationID, board, {
    onResponse: (response) => {
      responseHeaders.cacheControl = response.headers.get("cache-control");
    },
  });
  assertComplete(first, board);
  assert(responseHeaders.cacheControl?.includes("no-store"), "Streaming response was cacheable");
  assert.deepEqual(itemEvents(first).map((event) => event.status), [
    BoardImportItemStatus.SKIPPED,
    BoardImportItemStatus.SAVED,
    BoardImportItemStatus.SKIPPED,
    BoardImportItemStatus.SAVED,
  ]);
  const firstIDs = itemEvents(first).map((event) => event.recipeID);

  const persisted = await recipeRows(key, owner.token, householdID);
  const metadataRow = persisted.find((recipe: { title: string }) => recipe.title === "Saved exact metadata");
  assert(metadataRow, "Saved board recipe missing");
  metadataRow.recipe_ingredients.sort((left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name));
  assert.equal(metadataRow.source_url, newURL);
  assert.equal(metadataRow.source_type, "url");
  assert.equal(metadataRow.image_url, "");
  assert.deepEqual(metadataRow.instructions, ["Second", "First"]);
  assert.deepEqual(metadataRow.tags, ["edited", ""]);
  assert.equal(metadataRow.servings, 0);
  assert.equal(metadataRow.prep_time_minutes, null);
  assert.equal(metadataRow.cook_time_minutes, 8);
  assert.deepEqual(metadataRow.recipe_ingredients, [
    { name: "salt", quantity: null, unit: null, raw_string: "Salt" },
    { name: "water", quantity: 0, unit: "cups", raw_string: "0 cups Water" },
  ]);

  const countAfterFirst = persisted.length;
  const replay = await collectStream(owner.token, householdID, operationID, board);
  assertComplete(replay, board);
  assert.deepEqual(itemEvents(replay).map((event) => event.recipeID), firstIDs, "Replay changed recipe identities");
  assert.equal((await recipeRows(key, owner.token, householdID)).length, countAfterFirst, "Replay duplicated recipes");

  const changed = board.map((value) => ({ ...value, raw_ingredients: [...value.raw_ingredients] }));
  changed[3].raw_ingredients = ["Changed"];
  let changedEvents = 0;
  await expectConnectRejected(() => collectStream(owner.token, householdID, operationID, changed, {
    onEvent: () => { changedEvents++; },
  }), "Changed operation payload", [Code.Unavailable]);
  assert.equal(changedEvents, 0, "Changed operation emitted progress before rejection");
  assert.equal((await recipeRows(key, owner.token, householdID)).length, countAfterFirst, "Rejected payload changed recipes");

  let outsiderEvents = 0;
  await expectConnectRejected(() => collectStream(outsider.token, householdID, randomUUID(), board, {
    onEvent: () => { outsiderEvents++; },
  }), "Outsider import", [Code.Unavailable]);
  assert.equal(outsiderEvents, 0, "Outsider received board progress");
  let anonymousEvents = 0;
  await expectConnectRejected(() => collectStream("", householdID, randomUUID(), board, {
    onEvent: () => { anonymousEvents++; },
  }), "Anonymous import", [Code.Unauthenticated]);
  assert.equal(anonymousEvents, 0, "Anonymous caller received board progress");
  const memberDuplicate = [item(householdID, 0, "Member sees household duplicate", newURL)];
  const memberResult = await collectStream(member.token, householdID, randomUUID(), memberDuplicate);
  assertComplete(memberResult, memberDuplicate);
  assert.equal(itemEvents(memberResult)[0]?.status, BoardImportItemStatus.SKIPPED);

  const concurrentURL = `https://example.invalid/concurrent-${randomUUID()}`;
  const concurrentBoards = [
    [item(householdID, 0, "Concurrent A", concurrentURL)],
    [item(householdID, 0, "Concurrent B", concurrentURL)],
  ];
  const concurrent = await Promise.all(concurrentBoards.map((items) => collectStream(owner.token, householdID, randomUUID(), items)));
  concurrent.forEach((events, index) => assertComplete(events, concurrentBoards[index]));
  assert.deepEqual(concurrent.map((events) => itemEvents(events)[0]?.status).sort(), [
    BoardImportItemStatus.SAVED,
    BoardImportItemStatus.SKIPPED,
  ]);
  assert.equal((await recipeRows(key, owner.token, householdID)).filter((recipe: { source_url: string }) => recipe.source_url === concurrentURL).length, 1);

  const sameOperation = randomUUID();
  const sameOperationBoard = [item(householdID, 0, "Concurrent operation replay", "")];
  const sameOperationResults = await Promise.all([
    collectStream(owner.token, householdID, sameOperation, sameOperationBoard),
    collectStream(owner.token, householdID, sameOperation, sameOperationBoard),
    collectStream(owner.token, householdID, sameOperation, sameOperationBoard),
    collectStream(owner.token, householdID, sameOperation, sameOperationBoard),
  ]);
  sameOperationResults.forEach((events) => assertComplete(events, sameOperationBoard));
  const sameOperationIDs = sameOperationResults.map((events) => itemEvents(events)[0]?.recipeID);
  assert(sameOperationIDs[0] && sameOperationIDs.every((recipeID) => recipeID === sameOperationIDs[0]),
    "Concurrent operation replay changed identity");

  const interruptedOperation = randomUUID();
  const interruptedBoard = Array.from({ length: 20 }, (_, index) => item(householdID, index, `Interrupted ${index}`, ""));
  const controller = new AbortController();
  let canceledItemEvents = 0;
  const confirmedBeforeCancel = new Map<number, string>();
  await expectConnectRejected(() => collectStream(owner.token, householdID, interruptedOperation, interruptedBoard, {
    signal: controller.signal,
    onEvent: (event) => {
      if (event.kind === BoardImportEventKind.ITEM) {
        canceledItemEvents++;
        if (event.recipeID) confirmedBeforeCancel.set(event.itemIndex, event.recipeID);
        controller.abort();
      }
    },
  }), "Canceled stream", [Code.Canceled]);
  assert.equal(controller.signal.aborted, true, "Cancellation signal was not triggered");
  assert(canceledItemEvents >= 1, "Canceled stream did not observe a committed item first");
  assert(confirmedBeforeCancel.size >= 1, "Cancellation lost the confirmed recipe identity");
  const partialInterruptedRows = (await recipeRows(key, owner.token, householdID)).filter((recipe: { title: string }) => recipe.title.startsWith("Interrupted "));
  assert(partialInterruptedRows.length >= 1 && partialInterruptedRows.length < interruptedBoard.length,
    "Cancellation did not stop the in-flight board before completion");
  const resumed = await collectStream(owner.token, householdID, interruptedOperation, interruptedBoard);
  assertComplete(resumed, interruptedBoard);
  const resumedIDs = new Map(itemEvents(resumed).map((event) => [event.itemIndex, event.recipeID]));
  for (const [index, recipeID] of confirmedBeforeCancel) {
    assert.equal(resumedIDs.get(index), recipeID, "Resume changed an already confirmed recipe identity");
  }
  const interruptedRows = (await recipeRows(key, owner.token, householdID)).filter((recipe: { title: string }) => recipe.title.startsWith("Interrupted "));
  assert.equal(interruptedRows.length, interruptedBoard.length, "Canceled stream replay duplicated or lost items");

  const longOperation = randomUUID();
  const longBoard = Array.from({ length: 250 }, (_, index) => item(householdID, index, `Long stream ${index}`, "", ["Salt"]));
  const startedAt = Date.now();
  const longResult = await collectStream(owner.token, householdID, longOperation, longBoard);
  const finishedAt = Date.now();
  assertComplete(longResult, longBoard);
  const longProgress = itemEvents(longResult);
  assert(longResult[0].receivedAt - startedAt < 10_000, "Preflight was not delivered promptly through the proxy");
  assert(longProgress[0].receivedAt - startedAt < 10_000, "First item progress was not delivered promptly through the proxy");
  assert(longProgress.at(-1)!.receivedAt - longProgress[0].receivedAt > 15_000, "Item progress was buffered or did not span 15 seconds");

  const largeTitle = `Large board ${randomUUID()}`;
  const largeBoard = [item(householdID, 0, largeTitle, "", ["x".repeat(1_200_000)])];
  const largeResult = await collectStream(owner.token, householdID, randomUUID(), largeBoard);
  assertComplete(largeResult, largeBoard);
  const largeRecipeID = itemEvents(largeResult)[0]?.recipeID;
  assert(largeRecipeID, "Large valid board request was not saved");
  await rest(key, owner.token, `recipes?id=eq.${largeRecipeID}`, "DELETE");

  const beforeOversize = (await recipeRows(key, owner.token, householdID)).length;
  const oversizedTitle = `Oversized board ${randomUUID()}`;
  const oversizedBoard = [item(householdID, 0, oversizedTitle, "", ["x".repeat(4_300_000)])];
  let oversizedStatus = 0;
  await expectConnectRejected(() => collectStream(owner.token, householdID, randomUUID(), oversizedBoard, {
    onResponse: (response) => { oversizedStatus = response.status; },
  }), "Oversized board request", [Code.Unknown]);
  assert.equal(oversizedStatus, 413, "Oversized request was not rejected by the staging proxy body limit");
  assert.equal((await recipeRows(key, owner.token, householdID)).length, beforeOversize, "Oversized request changed recipes");

  await importBoard(origin, owner.token, householdID, operationID, board, () => {});
  assert.equal((await recipeRows(key, owner.token, householdID)).length,
    countAfterFirst + 2 + interruptedBoard.length + longBoard.length,
    "Validated client retry changed persisted recipe count");

  console.log(JSON.stringify({
    orderedStreaming: true,
    exactMetadataAndParsing: true,
    responseNotBuffered: true,
    storedAndBatchDedup: true,
    urlLessReplay: true,
    changedPayloadDenied: true,
    memberScoped: true,
    outsiderDenied: true,
    anonymousDenied: true,
    concurrentURLDedup: true,
    concurrentOperationReplay: true,
    canceledStreamResumed: true,
    over15SecondIncrementalProgress: longProgress.at(-1)!.receivedAt - longProgress[0].receivedAt,
    maxBoardItems: longBoard.length,
    overOneMiBRequestAccepted: true,
    overFourMiBRequestDenied: true,
  }));
}

await verify();
