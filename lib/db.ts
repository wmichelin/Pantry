import { Alert } from "react-native";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Small helpers for talking to Supabase consistently. The app uses the raw
 * supabase-js client, so every call returns `{ data, error }` and it's easy to
 * forget to check `error`. These helpers make the happy path throw on failure so
 * a single try/catch can guard one or more mutations, and give callers a uniform
 * way to surface failures to the user.
 */

type DbResult<T> = { data: T; error: PostgrestError | null };

/**
 * Throw if a supabase-js response carries an error; otherwise return its data.
 * Wrap a sequence of awaited calls in `throwOnError(...)` inside one try/catch so
 * a mid-sequence failure stops the rest instead of silently continuing.
 */
export function throwOnError<T>(result: DbResult<T>): T {
  if (result.error) throw result.error;
  return result.data;
}

/** Best-effort human-readable message from any thrown/returned value. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (typeof err === "string" && err.trim()) return err;
  return "Something went wrong. Please try again.";
}

/** Show a user-facing alert for a caught error. */
export function showError(title: string, err: unknown): void {
  Alert.alert(title, errorMessage(err));
}
