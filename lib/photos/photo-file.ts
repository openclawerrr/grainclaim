/**
 * What GrainClaim takes from a photo file itself, before anything is read
 * off the document in it: its type, its SHA-256 hash, and the time and GPS
 * the camera wrote into it (EXIF).
 *
 * The hash is of the original bytes, which are stored untouched. The time and
 * GPS prove when and where the photo was taken; for a ticket that is not
 * where the grain came from.
 */
import { createHash } from "node:crypto";
import exifr from "exifr";

export interface PhotoType {
  mediaType: "image/jpeg" | "image/png";
  /** The file's real extension, from its contents, not from its name. */
  extension: "jpg" | "png";
}

/** JPEG or PNG, told from the first bytes. Null for anything else. */
export function photoType(photo: Uint8Array): PhotoType | null {
  if (photo[0] === 0xff && photo[1] === 0xd8) return { mediaType: "image/jpeg", extension: "jpg" };
  if (photo[0] === 0x89 && photo[1] === 0x50 && photo[2] === 0x4e && photo[3] === 0x47) {
    return { mediaType: "image/png", extension: "png" };
  }
  return null;
}

/** The SHA-256 hash of the file, as 64 lower-case hex characters. */
export function sha256Hex(photo: Uint8Array): string {
  return createHash("sha256").update(photo).digest("hex");
}

/** Where a ticket photo is kept in the `photos` bucket: named by its hash, with its real extension. */
export function ticketPhotoPath(hash: string, type: PhotoType): string {
  return `tickets/${hash}.${type.extension}`;
}

export interface CaptureInfo {
  /**
   * When the photo was taken, in a form Postgres reads as a moment in time:
   * "2026-11-09T14:28:06-08:00", or "2026-11-09 14:28:06 America/Chicago"
   * when the camera recorded no time zone. Null when it recorded no time.
   */
  capturedAt: string | null;
  location: { longitude: number; latitude: number } | null;
}

/** The EXIF tags used, as exifr returns them with `reviveValues: false`. */
export interface ExifTags {
  DateTimeOriginal?: unknown;
  OffsetTimeOriginal?: unknown;
  GPSDateStamp?: unknown;
  GPSTimeStamp?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

const EXIF_TIME = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})$/;
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

const two = (n: number) => String(Math.floor(n)).padStart(2, "0");

function capturedAt(tags: ExifTags, fallbackTimeZone: string): string | null {
  // 1. The camera's clock with its own time zone offset (phones write both).
  const local = typeof tags.DateTimeOriginal === "string" ? EXIF_TIME.exec(tags.DateTimeOriginal) : null;
  if (local && typeof tags.OffsetTimeOriginal === "string" && EXIF_OFFSET.test(tags.OffsetTimeOriginal)) {
    const [, y, mo, d, h, mi, s] = local;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${tags.OffsetTimeOriginal}`;
  }

  // 2. The GPS clock, which is always UTC.
  const gpsDate = typeof tags.GPSDateStamp === "string" ? EXIF_DATE.exec(tags.GPSDateStamp) : null;
  const gpsTime = tags.GPSTimeStamp;
  if (
    gpsDate &&
    Array.isArray(gpsTime) &&
    gpsTime.length === 3 &&
    gpsTime.every((part) => typeof part === "number" && Number.isFinite(part) && part >= 0)
  ) {
    const [, y, mo, d] = gpsDate;
    const [h, mi, s] = gpsTime as number[];
    return `${y}-${mo}-${d}T${two(h)}:${two(mi)}:${two(s)}Z`;
  }

  // 3. The camera's clock with no time zone: taken to be the farm's.
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    return `${y}-${mo}-${d} ${h}:${mi}:${s} ${fallbackTimeZone}`;
  }
  return null;
}

function location(tags: ExifTags): CaptureInfo["location"] {
  const { latitude, longitude } = tags;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { longitude, latitude };
}

/** The capture time and GPS in a photo's EXIF tags. Pure. */
export function captureInfoFromExif(tags: ExifTags | null | undefined, fallbackTimeZone: string): CaptureInfo {
  if (!tags) return { capturedAt: null, location: null };
  return { capturedAt: capturedAt(tags, fallbackTimeZone), location: location(tags) };
}

/**
 * Reads the capture time and GPS from a photo with exifr. A photo with no
 * EXIF data (most PNGs, screenshots, files a chat app has stripped) gives
 * nulls, not an error.
 */
export async function readCaptureInfo(photo: Uint8Array, fallbackTimeZone: string): Promise<CaptureInfo> {
  let tags: ExifTags | undefined;
  try {
    tags = await exifr.parse(Buffer.from(photo), {
      // Keep the tags as written; exifr would otherwise read the time in the server's time zone.
      reviveValues: false,
      gps: true,
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "GPSDateStamp", "GPSTimeStamp", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"],
    });
  } catch {
    tags = undefined;
  }
  return captureInfoFromExif(tags, fallbackTimeZone);
}
