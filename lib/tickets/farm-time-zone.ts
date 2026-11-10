/**
 * THIN SLICE: the farm's time zone isn't stored yet, and the sample farm is
 * in Iowa. A ticket's printed time is the elevator's local clock, so this is
 * the zone it is read in when it becomes the trip's time, and the zone days
 * are shown in. Replace it with the farm's own zone when the farm has one.
 */
export const FARM_TIME_ZONE = "America/Chicago";
