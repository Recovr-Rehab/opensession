import { describe, expect, test } from "bun:test";
import { boxMachineType } from "./box";

describe("Box machine profiles", () => {
  test("maps the three provider-supported resource combinations", () => {
    expect(boxMachineType({ cpu: 2, memoryMb: 4_096, diskGb: 40 })).toBe("small");
    expect(boxMachineType({ cpu: 4, memoryMb: 8_192, diskGb: 80 })).toBe("default");
    expect(boxMachineType({ cpu: 8, memoryMb: 16_384, diskGb: 100 })).toBe("large");
  });

  test("uses default when no project profile exists and rejects arbitrary combinations", () => {
    expect(boxMachineType()).toBe("default");
    expect(() => boxMachineType({ cpu: 4, memoryMb: 4_096, diskGb: 80 })).toThrow(
      "Choose one of Box's Small, Default, or Large machine sizes",
    );
  });
});
