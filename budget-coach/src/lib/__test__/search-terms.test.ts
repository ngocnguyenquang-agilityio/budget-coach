import { describe, expect, it } from "vitest";
import { toSearchTerms } from "../search-terms";

describe("toSearchTerms", () => {
  it("drops filler words and lowercases", () => {
    expect(toSearchTerms("my new Jacket transaction")).toEqual(["jacket"]);
  });

  it("keeps every identifying word", () => {
    expect(toSearchTerms("Trader  Joe's")).toEqual(["trader", "joe's"]);
  });

  it("keeps the words when all of them are filler", () => {
    expect(toSearchTerms("new")).toEqual(["new"]);
  });
});
