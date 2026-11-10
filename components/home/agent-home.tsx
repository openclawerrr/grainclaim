import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The agent's home screen: the finished production report and nothing else
 * (docs/spec.md Part 11). A placeholder until the report is built in
 * Milestone 7. The agent view uses the formal insurance terms.
 */
export function AgentHome() {
  return (
    <div className="p-6">
      <h1 className="sr-only">Agent home</h1>

      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Production report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-base text-ink-muted">
            No production report has been shared yet. It will appear here, by unit, once the insured approves it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
