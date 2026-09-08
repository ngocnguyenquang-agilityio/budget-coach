"use client";

import { SavingsPotSchema, type SavingsPot } from "@/domain/savings-pot";
import { SavingsPotProgress } from "@/components/savings-pot-progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Dashboard section listing every Savings Pot, driven straight off
// state.savingsPots (synced from working memory via agent.state). Rendered
// only when the user has at least one pot, to keep the dashboard uncluttered
// for those who never use the feature.
export const SavingsPotsCard = ({ pots }: { pots: SavingsPot[] }) => {
  // agent.state can reflect a working-memory update mid-stream (or one that
  // ultimately fails server-side validation), so entries here aren't
  // guaranteed to match SavingsPotSchema yet — drop anything incomplete
  // rather than crash or render without a stable key.
  const validPots = pots.filter((pot) => SavingsPotSchema.safeParse(pot).success);

  if (validPots.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Savings pots</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {validPots.map((pot) => (
          <SavingsPotProgress key={pot.id} pot={pot} />
        ))}
      </CardContent>
    </Card>
  );
};
