export type HouseholdMembership = {
  household_id: string;
  role: string;
  households: {
    id: string;
    name: string;
    invite_code: string;
  };
};

export type CreatedHousehold = {
  id: string;
  name: string;
  invite_code: string;
};

export type JoinedHousehold = {
  id: string;
  name: string;
  already_member: boolean;
};

type APIProblem = { message?: unknown };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const apiOrigin = process.env.EXPO_PUBLIC_PANTRY_API_URL?.trim();

// This is intentionally opt-in. Production builds do not receive the variable,
// so their established direct Supabase path remains unchanged until its own gate.
export function stagingAPIOrigin(): string | null {
  if (!apiOrigin) return null;
  try {
    const parsed = new URL(apiOrigin);
    return parsed.protocol === "https:" && parsed.pathname === "/" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export async function findMembership(
  apiURL: string,
  accessToken: string,
  fetcher: Fetch = fetch
): Promise<HouseholdMembership | null> {
  const response = await fetcher(`${apiURL}/api/v1/membership`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Couldn’t load your household."
    );
  }
  if (payload.membership === null || payload.membership === undefined) return null;
  if (!isMembership(payload.membership)) {
    throw new Error("Pantry returned an invalid household response.");
  }
  return payload.membership;
}

export async function createHousehold(
  apiURL: string,
  accessToken: string,
  name: string,
  displayName: string,
  fetcher: Fetch = fetch
): Promise<CreatedHousehold> {
  const payload = await postJSON(apiURL, "/api/v1/households", accessToken, {
    name,
    display_name: displayName,
  }, fetcher);
  if (!isCreatedHousehold(payload.household)) {
    throw new Error("Pantry returned an invalid household response.");
  }
  return payload.household;
}

export async function joinHousehold(
  apiURL: string,
  accessToken: string,
  inviteCode: string,
  displayName: string,
  fetcher: Fetch = fetch
): Promise<JoinedHousehold> {
  const payload = await postJSON(apiURL, "/api/v1/household-joins", accessToken, {
    invite_code: inviteCode,
    display_name: displayName,
  }, fetcher);
  if (!isJoinedHousehold(payload.household)) {
    throw new Error("Pantry returned an invalid household response.");
  }
  return payload.household;
}

async function postJSON(
  apiURL: string,
  path: string,
  accessToken: string,
  body: Record<string, string>,
  fetcher: Fetch
): Promise<{ household?: unknown } & APIProblem> {
  const response = await fetcher(`${apiURL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Pantry could not update your household right now."
    );
  }
  return payload;
}

async function responsePayload(response: Response): Promise<{ membership?: unknown } & APIProblem> {
  try {
    return (await response.json()) as { membership?: unknown } & APIProblem;
  } catch {
    return {};
  }
}

function isMembership(value: unknown): value is HouseholdMembership {
  if (!value || typeof value !== "object") return false;
  const membership = value as Record<string, unknown>;
  const household = membership.households;
  if (!household || typeof household !== "object") return false;
  const fields = household as Record<string, unknown>;
  return (
    typeof membership.household_id === "string" &&
    typeof membership.role === "string" &&
    typeof fields.id === "string" &&
    typeof fields.name === "string" &&
    typeof fields.invite_code === "string"
  );
}

function isCreatedHousehold(value: unknown): value is CreatedHousehold {
  if (!value || typeof value !== "object") return false;
  const household = value as Record<string, unknown>;
  return (
    typeof household.id === "string" &&
    typeof household.name === "string" &&
    typeof household.invite_code === "string"
  );
}

function isJoinedHousehold(value: unknown): value is JoinedHousehold {
  if (!value || typeof value !== "object") return false;
  const household = value as Record<string, unknown>;
  return (
    typeof household.id === "string" &&
    typeof household.name === "string" &&
    typeof household.already_member === "boolean"
  );
}
