export type HouseholdMembership = {
  household_id: string;
  role: string;
  households: {
    id: string;
    name: string;
    invite_code: string;
  };
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
