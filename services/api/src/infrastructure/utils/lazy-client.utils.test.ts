import { describe, expect, it, vi } from "vitest";
import { createLazyClient } from "./lazy-client.utils.js";

class Greeter {
  name = "ada";
  nested = { value: 7 };

  greet(): string {
    return `hi ${this.name}`;
  }
}

describe("createLazyClient", () => {
  it("does not call the factory until a property is read", () => {
    const factory = vi.fn(() => new Greeter());

    createLazyClient(factory);

    expect(factory).not.toHaveBeenCalled();
  });

  it("constructs the client once across property reads", () => {
    const factory = vi.fn(() => new Greeter());
    const client = createLazyClient(factory);

    void client.name;
    void client.nested;
    client.greet();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("forwards properties and methods to the instance", () => {
    const client = createLazyClient(() => new Greeter());

    expect(client.name).toBe("ada");
    expect(client.nested.value).toBe(7);
    expect(client.greet()).toBe("hi ada");
  });
});
