/** Command-line options for `npm run seed`. Pure, so it is tested without a database. */

export type SeedCommand =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "reset-only" }
  | { kind: "load"; through: string };

export function usage(stageNames: readonly string[]): string {
  return [
    "Usage: npm run seed [-- options]",
    "",
    "Removes the sample farm, then loads it again.",
    "",
    "  (no options)        load every stage",
    "  --through <stage>   load stages up to and including <stage>",
    "  --reset-only        remove the sample farm and load nothing",
    "  --list              list the stages",
    "  --help              show this message",
    "",
    `Stages, in order: ${stageNames.join(", ")}`,
  ].join("\n");
}

export function parseSeedArgs(argv: readonly string[], stageNames: readonly string[]): SeedCommand {
  let command: SeedCommand | undefined;
  const set = (next: SeedCommand) => {
    if (command) throw new Error("Use only one of --through, --reset-only, --list and --help.");
    command = next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") set({ kind: "help" });
    else if (arg === "--list") set({ kind: "list" });
    else if (arg === "--reset-only") set({ kind: "reset-only" });
    else if (arg === "--through" || arg.startsWith("--through=")) {
      const stage = arg === "--through" ? argv[++i] : arg.slice("--through=".length);
      if (!stage) throw new Error("--through needs a stage name.");
      if (!stageNames.includes(stage)) {
        throw new Error(`Unknown stage "${stage}". Stages: ${stageNames.join(", ")}.`);
      }
      set({ kind: "load", through: stage });
    } else {
      throw new Error(`Unknown option "${arg}".\n\n${usage(stageNames)}`);
    }
  }

  return command ?? { kind: "load", through: stageNames[stageNames.length - 1] };
}
