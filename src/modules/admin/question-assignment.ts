import { randomInt } from "node:crypto";

type RandomIndex = (maximum: number) => number;

const shuffle = <T>(values: T[], randomIndex: RandomIndex) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
};

const signature = (values: string[]) => [...values].sort().join("|");
const overlap = (left: string[], right: string[]) => left.filter((value) => right.includes(value)).length;

/** Builds balanced four-question sets. Earlier teams consume disjoint questions first. */
export const buildRoundOneAssignments = (
  questionIds: string[],
  teamIds: string[],
  randomIndex: RandomIndex = randomInt,
) => {
  if (questionIds.length < 4) throw new Error("At least four questions are required.");
  const unused = shuffle(questionIds, randomIndex);
  const usedCombinations = new Set<string>();
  const usage = new Map(questionIds.map((id) => [id, 0]));
  const assignments: Array<{ teamId: string; questionIds: string[] }> = [];

  for (const teamId of teamIds) {
    let selected: string[];
    if (unused.length >= 4) {
      selected = unused.splice(0, 4);
    } else {
      const candidates = Array.from({ length: 384 }, () => shuffle(questionIds, randomIndex).slice(0, 4));
      selected = candidates.reduce((best, candidate) => {
        const candidateSignature = signature(candidate);
        const recent = assignments.slice(-3).reverse();
        const score = (usedCombinations.has(candidateSignature) ? -100_000 : 0)
          - (overlap(candidate, recent[0]?.questionIds ?? []) * 10_000)
          - (overlap(candidate, recent[1]?.questionIds ?? []) * 1_000)
          - (overlap(candidate, recent[2]?.questionIds ?? []) * 200)
          - candidate.reduce((sum, id) => sum + (usage.get(id) ?? 0) * 10, 0);
        const bestScore = (usedCombinations.has(signature(best)) ? -100_000 : 0)
          - (overlap(best, recent[0]?.questionIds ?? []) * 10_000)
          - (overlap(best, recent[1]?.questionIds ?? []) * 1_000)
          - (overlap(best, recent[2]?.questionIds ?? []) * 200)
          - best.reduce((sum, id) => sum + (usage.get(id) ?? 0) * 10, 0);
        return score > bestScore ? candidate : best;
      }, candidates[0]!);
    }
    selected = shuffle(selected, randomIndex);
    usedCombinations.add(signature(selected));
    selected.forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1));
    assignments.push({ teamId, questionIds: selected });
  }
  return assignments;
};
