import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAgencyProfile, useTalentProfile } from "./profile-hooks";
import { FakeServer, ok } from "./test/fake-server";
import { mount } from "./test/render";

const Talent = ({ id }: { id: string }) => {
  const query = useTalentProfile(id);
  return <p>{query.isError ? "error" : (query.data?.toString() ?? "wait")}</p>;
};

const Agency = ({ id }: { id: string }) => {
  const query = useAgencyProfile(id);
  return <p>{query.isError ? "error" : (query.data?.toString() ?? "wait")}</p>;
};

describe("public profile hooks", () => {
  it("reads the talent profile by id", async () => {
    const server = new FakeServer();
    server.on("GET", "/api/v1/freelancer/profile/t-1", () => ok("talent"));
    const view = mount(<Talent id="t-1" />, { server });
    await waitFor(() => expect(view.getByText("talent")).toBeTruthy());
  });

  it("reads the agency profile by id", async () => {
    const server = new FakeServer();
    server.on("GET", "/api/v1/agency/profile/a-1", () => ok("agency"));
    const view = mount(<Agency id="a-1" />, { server });
    await waitFor(() => expect(view.getByText("agency")).toBeTruthy());
  });

  it("does not retry a missing profile", async () => {
    const server = new FakeServer();
    const view = mount(<Talent id="missing" />, { server });
    await waitFor(() => expect(view.getByText("error")).toBeTruthy());
    expect(server.count("GET", "/api/v1/freelancer/profile/missing")).toBe(1);
  });
});
