/**
 * Phone Design — presets, chrome, rotate, and LAN preview for real devices.
 */
export type PhoneChrome = "island" | "notch" | "hole" | "none";

export type PhoneSizePreset = {
  id: string;
  label: string;
  labelAr: string;
  width: number;
  height: number;
  group: "Apple" | "Google" | "Samsung" | "Other" | "Landscape";
  groupAr: string;
  chrome: PhoneChrome;
  /** Matching landscape preset id, if any. */
  rotateId?: string;
};

export const PHONE_SIZE_PRESETS: PhoneSizePreset[] = [
  { id: "iphone-se", label: "iPhone SE", labelAr: "آيفون SE", width: 375, height: 667, group: "Apple", groupAr: "آبل", chrome: "none", rotateId: "iphone-landscape" },
  { id: "iphone-13-mini", label: "iPhone 13 mini", labelAr: "آيفون 13 mini", width: 375, height: 812, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-landscape" },
  { id: "iphone-14", label: "iPhone 14 / 15", labelAr: "آيفون 14 / 15", width: 390, height: 844, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-landscape" },
  { id: "iphone-14-pro", label: "iPhone 14 / 15 Pro", labelAr: "آيفون 14 / 15 Pro", width: 393, height: 852, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-14-plus", label: "iPhone 14 / 15 Plus", labelAr: "آيفون 14 / 15 Plus", width: 428, height: 926, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-landscape" },
  { id: "iphone-14-pro-max", label: "iPhone 14 / 15 Pro Max", labelAr: "آيفون 14 / 15 Pro Max", width: 430, height: 932, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16", label: "iPhone 16", labelAr: "آيفون 16", width: 393, height: 852, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16-plus", label: "iPhone 16 Plus", labelAr: "آيفون 16 Plus", width: 430, height: 932, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16-pro", label: "iPhone 16 Pro", labelAr: "آيفون 16 Pro", width: 402, height: 874, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", labelAr: "آيفون 16 Pro Max", width: 440, height: 956, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "pixel-7", label: "Pixel 7", labelAr: "بكسل 7", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-7-pro", label: "Pixel 7 Pro", labelAr: "بكسل 7 Pro", width: 412, height: 892, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-8", label: "Pixel 8", labelAr: "بكسل 8", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-8-pro", label: "Pixel 8 Pro", labelAr: "بكسل 8 Pro", width: 448, height: 998, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-9", label: "Pixel 9", labelAr: "بكسل 9", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-9-pro", label: "Pixel 9 Pro", labelAr: "بكسل 9 Pro", width: 430, height: 960, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "galaxy-s22", label: "Galaxy S22", labelAr: "جالاكسي S22", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-s23", label: "Galaxy S23", labelAr: "جالاكسي S23", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-s24", label: "Galaxy S24", labelAr: "جالاكسي S24", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-s24-plus", label: "Galaxy S24+", labelAr: "جالاكسي S24+", width: 384, height: 832, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-s24-ultra", label: "Galaxy S24 Ultra", labelAr: "جالاكسي S24 Ultra", width: 412, height: 892, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-z-flip", label: "Galaxy Z Flip", labelAr: "جالاكسي Z Flip", width: 360, height: 748, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "galaxy-z-fold-cover", label: "Galaxy Z Fold (cover)", labelAr: "جالاكسي Z Fold (غلاف)", width: 344, height: 882, group: "Samsung", groupAr: "سامسونج", chrome: "hole" },
  { id: "oneplus-12", label: "OnePlus 12", labelAr: "ون بلس 12", width: 450, height: 980, group: "Other", groupAr: "أخرى", chrome: "hole" },
  { id: "xiaomi-14", label: "Xiaomi 14", labelAr: "شاومي 14", width: 421, height: 935, group: "Other", groupAr: "أخرى", chrome: "hole" },
  { id: "nothing-phone-2", label: "Nothing Phone (2)", labelAr: "ناثينج فون 2", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole" },
  { id: "iphone-landscape", label: "iPhone landscape", labelAr: "آيفون أفقي", width: 844, height: 390, group: "Landscape", groupAr: "أفقي", chrome: "notch", rotateId: "iphone-14" },
  { id: "iphone-pro-max-landscape", label: "Pro Max landscape", labelAr: "Pro Max أفقي", width: 932, height: 430, group: "Landscape", groupAr: "أفقي", chrome: "island", rotateId: "iphone-14-pro-max" },
  { id: "pixel-landscape", label: "Pixel landscape", labelAr: "بكسل أفقي", width: 915, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "pixel-8" },
];

const PHONE_SIZE_KEY = "arrab.studioPhoneSize";

export function phoneSizeGroups(ar = false): { id: string; label: string; items: PhoneSizePreset[] }[] {
  const order = ["Apple", "Google", "Samsung", "Other", "Landscape"] as const;
  return order.map((group) => ({
    id: group,
    label: ar
      ? PHONE_SIZE_PRESETS.find((item) => item.group === group)?.groupAr ?? group
      : group,
    items: PHONE_SIZE_PRESETS.filter((item) => item.group === group),
  }));
}

export function readPhoneSizeId(): string {
  try {
    return localStorage.getItem(PHONE_SIZE_KEY) || "iphone-14";
  } catch {
    return "iphone-14";
  }
}

export function writePhoneSizeId(id: string): void {
  localStorage.setItem(PHONE_SIZE_KEY, id);
}

export function phonePresetById(id: string): PhoneSizePreset {
  return PHONE_SIZE_PRESETS.find((item) => item.id === id) ?? PHONE_SIZE_PRESETS[2]!;
}

export function rotatePhonePreset(id: string): PhoneSizePreset {
  const current = phonePresetById(id);
  if (current.rotateId) return phonePresetById(current.rotateId);
  return phonePresetById(current.id);
}

/** QR image URL for a LAN preview link (uses public QR encoder — URL only, never HTML). */
export function phonePreviewQrUrl(lanUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(lanUrl)}`;
}
