import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAccount, type Account } from "./account";
import { FakeServer, ok } from "./test/fake-server";
import { mount } from "./test/render";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const AGENCY_ID = "22222222-2222-4222-8222-222222222222";
const CLERK_ID = "user_2clerkIdThatMustNeverAppear";

let latest: Account;
const Probe = () => {
  latest = useAccount();
  return <p data-testid="status">{latest.status}</p>;
};

const server = () => {
  const s = new FakeServer();
  s.on("GET", "/api/v1/auth/status", () =>
    ok({
      role: "freelancer",
      accountExists: true,
      accountId: ACCOUNT_ID,
      isOnboarded: true,
    }),
  );
  s.on("GET", "/api/v1/agency/membership", () => ok({ agencyId: AGENCY_ID }));
  return s;
};

describe("useAccount", () => {
  it("uses the account id for senders and presence outside agency scope", async () => {
    const s = server();
    const { getByTestId } = mount(<Probe />, { server: s, role: "freelancer" });
    expect(latest.status).toBe("loading");
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("ready"),
    );

    expect(latest.accountId).toBe(ACCOUNT_ID);
    expect(latest.agencyId).toBeNull();
    expect(latest.actorId).toBe(ACCOUNT_ID);
    expect(latest.presenceId).toBe(ACCOUNT_ID);
    expect(latest.isMine(ACCOUNT_ID)).toBe(true);
    expect(latest.isMine("someone-else")).toBe(false);
    expect(latest.isMine(null)).toBe(false);
    expect(s.count("GET", "/api/v1/agency/membership")).toBe(0);
    expect(s.calls[0]?.search.get("role")).toBe("freelancer");
  });

  it("uses the agency id as the presence id in agency scope while senders stay account ids", async () => {
    const s = server();
    const { getByTestId } = mount(<Probe />, {
      server: s,
      role: "freelancer",
      scope: "agency",
    });
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("ready"),
    );

    expect(latest.agencyId).toBe(AGENCY_ID);
    expect(latest.presenceId).toBe(AGENCY_ID);
    expect(latest.actorId).toBe(ACCOUNT_ID);
    expect(latest.isMine(ACCOUNT_ID)).toBe(true);
    expect(latest.isMine(AGENCY_ID)).toBe(false);
    expect(
      s.calls
        .find((c) => c.path === "/api/v1/agency/membership")
        ?.search.get("role"),
    ).toBe("freelancer");
  });

  it("reports an error status when the status call fails", async () => {
    const s = new FakeServer();
    const { getByTestId } = mount(<Probe />, {
      server: s,
      getToken: async () => null,
    });
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("error"),
    );
    expect(latest.accountId).toBeNull();
    expect(latest.isMine(ACCOUNT_ID)).toBe(false);
  });

  it("never exposes the token or a Clerk id", async () => {
    const s = server();
    const { getByTestId } = mount(<Probe />, {
      server: s,
      role: "freelancer",
      getToken: async () => CLERK_ID,
    });
    await waitFor(() =>
      expect(getByTestId("status").textContent).toBe("ready"),
    );

    const snapshot = JSON.stringify(latest);
    expect(snapshot).not.toContain(CLERK_ID);
    expect(Object.keys(latest)).not.toContain("userId");
  });

  it("serves a second mount from the cache", async () => {
    const s = server();
    const { getAllByTestId } = mount(
      <>
        <Probe />
        <Probe />
      </>,
      { server: s, role: "freelancer" },
    );
    await waitFor(() =>
      expect(getAllByTestId("status").map((e) => e.textContent)).toEqual([
        "ready",
        "ready",
      ]),
    );
    expect(s.count("GET", "/api/v1/auth/status")).toBe(1);
  });
});
