# Decision: how a load is recorded and finished

**Status:** decided 2026-11-11 (Derrick). It is built in steps 6 to 8 of `docs/build-plan.md`. Step 6 updates this page when the rules are built.

## What we picked

**The farmer records each load when the truck is loaded, and the ticket finishes it.**

- "Start harvesting" opens a harvest log entry for a field, reading the browser's location once to pre-select it.
- "New load" records one truckload: it is linked to that harvest log entry, with the truck and where it's going.
- A load to a buyer stays open until its ticket is photographed. That is the only way to finish it.
- A load to a bin is finished at once, with the truck's capacity as its estimate. The bin keeps which field and harvest log entry each load came from.
- A load out of a bin is started from the bin and waits for its ticket the same way. Its ticket traces back through the bin to the fields.
- A ticket first looks for the open load it fits (`docs/spec.md` Part 4): same buyer, the truck number when printed, weighed after the load started and by the end of the next day. One fitting load links by itself and the farmer confirms; several, GrainClaim asks.

A load is stored as a trip, so the pipeline is field, bin, trip, ticket.

## The main alternative

**Link each ticket by its printed time alone.** The farmer only clicks "Start harvesting". A ticket is linked to whichever field was being harvested at the date and time printed on it, and its trip is created and finished in that one step.

This asks less of the farmer: one click per field, none per truck.

## Why

- **The record is made when the grain moves.** A crop insurance adjuster asks for load records: crop, field, date, truck, estimated bushels and where the load went. A load recorded as the truck is filled is that record. A link worked out later from a ticket's time is an inference.
- **A missing ticket shows.** An open load is a ticket the farmer is still owed. If it stays open for more than 3 days it goes to Needs attention. With time alone, a load whose ticket never arrives leaves no trace.
- **Time alone can't tell two fields apart.** A ticket weighed just after the farmer moves to another field, or on a day with two fields going to the same buyer, could belong to either. A load already names its field.
- **Bins need it anyway.** A load into a bin never gets a ticket, so it has to be recorded when it goes in. One "New load" button covers a load to a buyer, a load into a bin and a load out of a bin.
- **Every record links to the one before it.** Ticket to load, load to harvest log entry or bin, harvest log entry to field. Each link can be shown and checked.

## What it costs, and how that is handled

- **One more click per truck.** "New load" pre-fills the truck's last destination, so it is usually a single click.
- **A load the farmer forgets.** A ticket with no open load uses the printed-time rules (a field printed on the ticket, then the field being harvested at its printed time, then ask), creates and finishes a trip in one step, and is marked lower trust. So the alternative is the fallback. For loads into a bin, the end-of-day "How many loads went into Bin 3?" is the catch-up.
- **Tickets photographed late.** A truck can have several loads waiting for tickets, because a ticket may be photographed after the truck's next load has left. When a ticket prints one of the farmer's own trucks, it fits that truck's latest load started before the ticket was weighed, because a truck carries one load at a time. The database today allows one open trip per truck; step 6's migration lifts that limit.
- **A wrong link.** After linking, the ticket's bushels are checked against the load's estimate. A ticket more than 15% away is linked anyway and marked for review; a load with no estimate skips the check. The farmer has the final say: he can pick another load, and both answers are kept.
