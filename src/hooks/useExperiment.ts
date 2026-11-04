import { useMemo } from "react";
import { EXPERIMENTS, getAssignment, type Assignment, type ExperimentId } from "@/lib/abTest";

/** Resolve (once per mount) which variant of an experiment this visitor sees. */
export function useExperiment(id: ExperimentId): Assignment {
  return useMemo(() => getAssignment(EXPERIMENTS[id]), [id]);
}
