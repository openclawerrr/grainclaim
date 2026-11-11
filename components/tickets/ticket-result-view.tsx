import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatBushels,
  formatDate,
  formatDayOf,
  formatDecimal,
  formatPercent,
  formatPounds,
  formatTime,
} from "@/lib/format";
import type { TicketCheck } from "@/lib/rules/ticket-checks";
import { FARM_TIME_ZONE } from "@/lib/tickets/farm-time-zone";
import type { TicketResult } from "@/lib/tickets/ticket-result";
import { cn } from "@/lib/utils";

/**
 * Everything saved for one ticket, in six groups: what the ticket says, its
 * weights and grade, the bushels, where the load came from, and the checks.
 * Read-only. "Looks right" and flagging a value come with ticket review
 * (Milestone 4).
 */
export function TicketResultView({ ticket }: { ticket: TicketResult }) {
  const { read, printed, calculated } = ticket;

  // Read down the left column, then the right: the ticket as printed, then what GrainClaim made of it.
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      <div className="flex flex-col gap-4">
        <Group title="Ticket">
          <Row label="Buyer" value={read.buyer_name} />
          <Row label="Ticket number" value={read.ticket_number} />
          <Row label="Date" value={show(read.ticket_date, formatDate)} />
          <Row label="Time in" value={show(read.ticket_time, formatTime)} />
          <Row label="Truck" value={read.truck_number} />
          <Row label="Crop" value={show(read.crop, capitalize)} />
          <Row label="Contract number" value={read.contract_number} />
        </Group>

        <Group title="Weights (lb)">
          <Row label="Gross" value={show(read.gross_lbs, formatPounds)} />
          <Row label="Tare" value={show(read.tare_lbs, formatPounds)} />
          <Row label="Net" value={show(read.net_lbs, formatPounds)} />
        </Group>

        <Group title="Grade">
          <Row label="Moisture" value={show(read.moisture_pct, formatPercent)} />
          <Row label="Test weight" value={show(read.test_weight, (v) => `${formatDecimal(v)} lb/bu`)} />
          <Row label="Foreign material" value={show(read.foreign_material_pct, formatPercent)} />
          <Row label="Damage" value={show(read.damage_pct, formatPercent)} />
          <Row label="Dockage" value={show(read.dockage_pct, formatPercent)} />
        </Group>
      </div>

      <div className="flex flex-col gap-4">
        <Group title="Bushels">
          <Row label="Wet" value={show(calculated.wet_bu, formatBushels)} note={ticketSays(printed.wet_bu, formatBushels)} />
          <Row
            label="Elevator dry"
            value={show(calculated.elevator_dry_bu, formatBushels)}
            note={ticketSays(printed.elevator_dry_bu, formatBushels)}
          />
          <Row label="Shrink on the ticket" value={show(printed.shrink_pct, formatPercent)} />
          <Row
            label="Production to count for insurance"
            value={show(calculated.production_to_count_bu, formatBushels)}
            strong
          />
        </Group>

        <Group title="Where it came from">
          {ticket.origin ? (
            <>
              <Row label="Field" value={ticket.origin.fieldName} />
              <Row
                label="Unit"
                value={ticket.origin.insured === false ? "Not insured" : ticket.origin.unitNumber ? `Unit ${ticket.origin.unitNumber}` : null}
              />
              <Row label="Trip" value={ticket.origin.tripCode} />
            </>
          ) : (
            <p className="text-base text-ink">{noTripSentence(ticket)}</p>
          )}
        </Group>

        <Group title="Checks">
          {ticket.checks.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {ticket.checks.map((check) => (
                <Check key={check.id} check={check} />
              ))}
            </ul>
          ) : (
            <p className="text-base text-ink-muted">No checks were saved for this ticket.</p>
          )}
        </Group>
      </div>
    </div>
  );
}

function noTripSentence(ticket: TicketResult): string {
  if (!ticket.duplicateOf) return "This ticket isn't linked to a field yet, so it isn't counted.";
  const number = ticket.duplicateOf.ticketNumber ? `No. ${ticket.duplicateOf.ticketNumber}` : "a ticket";
  return `Not counted. This is the same ticket as ${number}, added ${formatDayOf(ticket.duplicateOf.uploadedAt, FARM_TIME_ZONE)}.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A value formatted for display, or null when there is nothing to show. */
function show<T>(value: T | null, format: (value: T) => string): string | null {
  return value === null ? null : format(value);
}

function ticketSays<T>(value: T | null, format: (value: T) => string): string | undefined {
  return value === null ? undefined : `Ticket says ${format(value)}`;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** One value with its label. A value that wasn't read shows as a dash. */
function Row({ label, value, note, strong }: { label: string; value: string | null; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 first:pt-0 last:border-b-0 last:pb-0">
      <span className={cn("text-sm", strong ? "font-semibold text-ink" : "text-ink-muted")}>{label}</span>
      <span className="text-right">
        {value === null ? (
          <span className="text-base text-ink-muted">
            <span aria-hidden="true">—</span>
            <span className="sr-only">Not read</span>
          </span>
        ) : (
          <span className={cn("text-base tabular-nums text-ink", strong ? "font-heading text-xl font-semibold" : "font-medium")}>
            {value}
          </span>
        )}
        {note ? <span className="block text-sm text-ink-muted tabular-nums">{note}</span> : null}
      </span>
    </div>
  );
}

const CHECK_LABEL: Record<TicketCheck["status"], string> = {
  pass: "Passed",
  fail: "Failed",
  not_checked: "Not checked",
};

/** One check with its sentence. A failed one is the only thing here in yellow. */
function Check({ check }: { check: TicketCheck }) {
  const failed = check.status === "fail";
  return (
    <li className={cn("flex items-start gap-3 rounded-lg px-3 py-2", failed ? "bg-yellow-100" : "bg-page")}>
      <span
        className={cn(
          "mt-0.5 w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-semibold",
          check.status === "pass" && "bg-green-100 text-ink",
          failed && "bg-yellow-400 text-ink",
          check.status === "not_checked" && "bg-card text-ink-muted ring-1 ring-line",
        )}
      >
        {CHECK_LABEL[check.status]}
      </span>
      <span className="text-sm text-ink">{check.message}</span>
    </li>
  );
}
