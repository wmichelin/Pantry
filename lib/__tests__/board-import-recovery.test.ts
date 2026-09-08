import { expect, test } from "bun:test";
import { boardRecoveryMarkersPresent, boardResumeState } from "../board-import-recovery";

const operationID = "123e4567-e89b-42d3-a456-426614174000";
const recipes = [{ suggested_tags: ["default-a"] }, { suggested_tags: ["default-b"] }];

test("restores the exact selected indexes and edited tags", () => {
  const state = boardResumeState(recipes, operationID, "[1]", JSON.stringify({ 1: ["edited", ""] }));
  expect(state?.operationID).toBe(operationID);
  expect([...state!.selected]).toEqual([1]);
  expect(state?.tags).toEqual({ 0: ["default-a"], 1: ["edited", ""] });
});

test("detects any partial recovery marker and rejects incomplete snapshots", () => {
  expect(boardRecoveryMarkersPresent(operationID, undefined, undefined)).toBe(true);
  expect(boardRecoveryMarkersPresent(undefined, "[0]", undefined)).toBe(true);
  expect(boardRecoveryMarkersPresent()).toBe(false);
  expect(boardResumeState(recipes, operationID, "[0]", undefined)).toBeNull();
  expect(boardResumeState(recipes, undefined, "[0]", '{"0":[]}')).toBeNull();
});

test("rejects corrupt, duplicate, out-of-range and incomplete recovery state", () => {
  expect(boardResumeState(recipes, operationID, "not-json", '{"0":[]}')).toBeNull();
  expect(boardResumeState(recipes, operationID, "[0,0]", '{"0":[]}')).toBeNull();
  expect(boardResumeState(recipes, operationID, "[2]", '{"2":[]}')).toBeNull();
  expect(boardResumeState(recipes, operationID, "[0]", "[]")).toBeNull();
  expect(boardResumeState(recipes, operationID, "[0]", "{}")).toBeNull();
  expect(boardResumeState(recipes, operationID, "[0]", '{"0":[1]}')).toBeNull();
});
