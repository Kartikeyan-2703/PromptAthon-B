import { describe, expect, it } from "vitest";
import { buildRoundOneAssignments } from "../src/modules/admin/question-assignment.js";

const cyclingRandom = () => {
  let value = 0;
  return (maximum: number) => (value++ * 7 + 3) % maximum;
};

describe("Round 1 question allocation", () => {
  it("assigns exactly four unique questions to every team", () => {
    const result = buildRoundOneAssignments(
      Array.from({ length: 12 }, (_, index) => `q${index + 1}`),
      Array.from({ length: 20 }, (_, index) => `team${index + 1}`),
      cyclingRandom(),
    );
    expect(result).toHaveLength(20);
    result.forEach(({ questionIds }) => {
      expect(questionIds).toHaveLength(4);
      expect(new Set(questionIds).size).toBe(4);
    });
  });

  it("uses completely disjoint sets for the first teams while unused questions remain", () => {
    const result = buildRoundOneAssignments(
      Array.from({ length: 8 }, (_, index) => `q${index + 1}`),
      ["team1", "team2"],
      cyclingRandom(),
    );
    expect(result[0]!.questionIds.filter((id) => result[1]!.questionIds.includes(id))).toHaveLength(0);
  });

  it("does not repeat the same four-question combination for nearby teams when alternatives exist", () => {
    const result = buildRoundOneAssignments(
      Array.from({ length: 8 }, (_, index) => `q${index + 1}`),
      Array.from({ length: 10 }, (_, index) => `team${index + 1}`),
      cyclingRandom(),
    );
    const signatures = result.map(({ questionIds }) => [...questionIds].sort().join('|'));
    signatures.forEach((value, index) => {
      if (index > 0) expect(value).not.toBe(signatures[index - 1]);
    });
  });
});
