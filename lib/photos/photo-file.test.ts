import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { captureInfoFromExif, photoType, readCaptureInfo, sha256Hex, ticketPhotoPath } from "./photo-file";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZONE = "America/Chicago";

describe("photoType", () => {
  it("tells a JPEG and a PNG from their first bytes", () => {
    expect(photoType(JPEG)).toEqual({ mediaType: "image/jpeg", extension: "jpg" });
    expect(photoType(PNG)).toEqual({ mediaType: "image/png", extension: "png" });
  });

  it("is null for anything else, including an empty file", () => {
    expect(photoType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(photoType(new Uint8Array())).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("is the standard SHA-256, as 64 hex characters", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("changes when one byte changes", () => {
    expect(sha256Hex(JPEG)).not.toBe(sha256Hex(new Uint8Array([...JPEG.slice(0, 4), 0x01])));
  });
});

describe("ticketPhotoPath", () => {
  it("names the file by its hash with its real extension", () => {
    expect(ticketPhotoPath("abc123", photoType(JPEG)!)).toBe("tickets/abc123.jpg");
    expect(ticketPhotoPath("abc123", photoType(PNG)!)).toBe("tickets/abc123.png");
  });
});

describe("captureInfoFromExif", () => {
  it("uses the camera's clock with its own offset", () => {
    const info = captureInfoFromExif(
      { DateTimeOriginal: "2026:10:12 10:50:00", OffsetTimeOriginal: "-05:00", latitude: 42.023, longitude: -93.451 },
      ZONE,
    );
    expect(info).toEqual({
      capturedAt: "2026-10-12T10:50:00-05:00",
      location: { latitude: 42.023, longitude: -93.451 },
    });
  });

  it("falls back to the GPS clock, which is UTC", () => {
    const info = captureInfoFromExif(
      { DateTimeOriginal: "2026:11:09 14:28:06", GPSDateStamp: "2026:11:09", GPSTimeStamp: [22, 28, 5.5] },
      ZONE,
    );
    expect(info.capturedAt).toBe("2026-11-09T22:28:05Z");
  });

  it("takes a clock with no time zone to be the farm's", () => {
    expect(captureInfoFromExif({ DateTimeOriginal: "2026:10:12 10:50:00" }, ZONE).capturedAt).toBe(
      "2026-10-12 10:50:00 America/Chicago",
    );
  });

  it("gives nulls when the photo has no tags, or tags it can't use", () => {
    expect(captureInfoFromExif(undefined, ZONE)).toEqual({ capturedAt: null, location: null });
    expect(captureInfoFromExif({}, ZONE)).toEqual({ capturedAt: null, location: null });
    expect(
      captureInfoFromExif({ DateTimeOriginal: "yesterday", OffsetTimeOriginal: "PST", latitude: 95, longitude: 10 }, ZONE),
    ).toEqual({ capturedAt: null, location: null });
  });

  it("needs both latitude and longitude", () => {
    expect(captureInfoFromExif({ latitude: 42.02 }, ZONE).location).toBeNull();
  });
});

describe("readCaptureInfo", () => {
  it("reads the time and GPS a phone wrote into a sample ticket photo", async () => {
    const photo = readFileSync(path.resolve("sample-data", "photos", "ticket-1.jpg"));
    const info = await readCaptureInfo(photo, ZONE);
    expect(info.capturedAt).toMatch(/^2026-11-09T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(info.location).not.toBeNull();
    expect(Math.abs(info.location!.latitude)).toBeLessThanOrEqual(90);
    expect(Math.abs(info.location!.longitude)).toBeLessThanOrEqual(180);
  });

  it("gives nulls for a file with no EXIF data", async () => {
    expect(await readCaptureInfo(PNG, ZONE)).toEqual({ capturedAt: null, location: null });
  });
});
