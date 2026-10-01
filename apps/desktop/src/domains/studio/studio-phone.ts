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
  group: "Apple" | "Google" | "Samsung" | "Other" | "Tablet" | "Landscape";
  groupAr: string;
  chrome: PhoneChrome;
  /** Matching landscape preset id, if any. */
  rotateId?: string;
};

export const PHONE_SIZE_PRESETS: PhoneSizePreset[] = [
  // —— Apple ——
  { id: "iphone-se", label: "iPhone SE (3rd)", labelAr: "آيفون SE", width: 375, height: 667, group: "Apple", groupAr: "آبل", chrome: "none", rotateId: "iphone-se-landscape" },
  { id: "iphone-xr", label: "iPhone XR / 11", labelAr: "آيفون XR / 11", width: 414, height: 896, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-xr-landscape" },
  { id: "iphone-12-mini", label: "iPhone 12 / 13 mini", labelAr: "آيفون 12 / 13 mini", width: 375, height: 812, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-mini-landscape" },
  { id: "iphone-12", label: "iPhone 12 / 13", labelAr: "آيفون 12 / 13", width: 390, height: 844, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-landscape" },
  { id: "iphone-12-pro-max", label: "iPhone 12 / 13 Pro Max", labelAr: "آيفون 12 / 13 Pro Max", width: 428, height: 926, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-plus-landscape" },
  { id: "iphone-14", label: "iPhone 14 / 15", labelAr: "آيفون 14 / 15", width: 390, height: 844, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-landscape" },
  { id: "iphone-14-pro", label: "iPhone 14 / 15 Pro", labelAr: "آيفون 14 / 15 Pro", width: 393, height: 852, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-landscape" },
  { id: "iphone-14-plus", label: "iPhone 14 / 15 Plus", labelAr: "آيفون 14 / 15 Plus", width: 428, height: 926, group: "Apple", groupAr: "آبل", chrome: "notch", rotateId: "iphone-plus-landscape" },
  { id: "iphone-14-pro-max", label: "iPhone 14 / 15 Pro Max", labelAr: "آيفون 14 / 15 Pro Max", width: 430, height: 932, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16", label: "iPhone 16", labelAr: "آيفون 16", width: 393, height: 852, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-landscape" },
  { id: "iphone-16-plus", label: "iPhone 16 Plus", labelAr: "آيفون 16 Plus", width: 430, height: 932, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-pro-max-landscape" },
  { id: "iphone-16-pro", label: "iPhone 16 Pro", labelAr: "آيفون 16 Pro", width: 402, height: 874, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-16-pro-landscape" },
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", labelAr: "آيفون 16 Pro Max", width: 440, height: 956, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-16-pro-max-landscape" },
  { id: "iphone-17", label: "iPhone 17", labelAr: "آيفون 17", width: 402, height: 874, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-16-pro-landscape" },
  { id: "iphone-17-pro", label: "iPhone 17 Pro", labelAr: "آيفون 17 Pro", width: 402, height: 874, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-16-pro-landscape" },
  { id: "iphone-17-pro-max", label: "iPhone 17 Pro Max", labelAr: "آيفون 17 Pro Max", width: 440, height: 956, group: "Apple", groupAr: "آبل", chrome: "island", rotateId: "iphone-16-pro-max-landscape" },

  // —— Google ——
  { id: "pixel-6a", label: "Pixel 6a", labelAr: "بكسل 6a", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-7", label: "Pixel 7", labelAr: "بكسل 7", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-7a", label: "Pixel 7a", labelAr: "بكسل 7a", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-7-pro", label: "Pixel 7 Pro", labelAr: "بكسل 7 Pro", width: 412, height: 892, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-pro-landscape" },
  { id: "pixel-8", label: "Pixel 8", labelAr: "بكسل 8", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-8a", label: "Pixel 8a", labelAr: "بكسل 8a", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-8-pro", label: "Pixel 8 Pro", labelAr: "بكسل 8 Pro", width: 448, height: 998, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-8-pro-landscape" },
  { id: "pixel-9", label: "Pixel 9", labelAr: "بكسل 9", width: 412, height: 915, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-landscape" },
  { id: "pixel-9-pro", label: "Pixel 9 Pro", labelAr: "بكسل 9 Pro", width: 430, height: 960, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-9-pro-landscape" },
  { id: "pixel-9-pro-xl", label: "Pixel 9 Pro XL", labelAr: "بكسل 9 Pro XL", width: 448, height: 998, group: "Google", groupAr: "جوجل", chrome: "hole", rotateId: "pixel-8-pro-landscape" },
  { id: "pixel-fold", label: "Pixel Fold (inner)", labelAr: "بكسل فولد (داخلي)", width: 690, height: 829, group: "Google", groupAr: "جوجل", chrome: "none", rotateId: "pixel-fold-landscape" },

  // —— Samsung ——
  { id: "galaxy-a15", label: "Galaxy A15", labelAr: "جالاكسي A15", width: 385, height: 854, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-a-landscape" },
  { id: "galaxy-a35", label: "Galaxy A35", labelAr: "جالاكسي A35", width: 412, height: 915, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s-landscape" },
  { id: "galaxy-a55", label: "Galaxy A55", labelAr: "جالاكسي A55", width: 412, height: 915, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s-landscape" },
  { id: "galaxy-s21", label: "Galaxy S21", labelAr: "جالاكسي S21", width: 360, height: 800, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s21-landscape" },
  { id: "galaxy-s22", label: "Galaxy S22", labelAr: "جالاكسي S22", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s22-landscape" },
  { id: "galaxy-s23", label: "Galaxy S23", labelAr: "جالاكسي S23", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s22-landscape" },
  { id: "galaxy-s23-ultra", label: "Galaxy S23 Ultra", labelAr: "جالاكسي S23 Ultra", width: 412, height: 892, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-ultra-landscape" },
  { id: "galaxy-s24", label: "Galaxy S24", labelAr: "جالاكسي S24", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s22-landscape" },
  { id: "galaxy-s24-plus", label: "Galaxy S24+", labelAr: "جالاكسي S24+", width: 384, height: 832, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s24-plus-landscape" },
  { id: "galaxy-s24-ultra", label: "Galaxy S24 Ultra", labelAr: "جالاكسي S24 Ultra", width: 412, height: 892, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-ultra-landscape" },
  { id: "galaxy-s25", label: "Galaxy S25", labelAr: "جالاكسي S25", width: 360, height: 780, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s22-landscape" },
  { id: "galaxy-s25-plus", label: "Galaxy S25+", labelAr: "جالاكسي S25+", width: 384, height: 832, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-s24-plus-landscape" },
  { id: "galaxy-s25-ultra", label: "Galaxy S25 Ultra", labelAr: "جالاكسي S25 Ultra", width: 412, height: 892, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-ultra-landscape" },
  { id: "galaxy-z-flip5", label: "Galaxy Z Flip5", labelAr: "جالاكسي Z Flip5", width: 360, height: 748, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-flip-landscape" },
  { id: "galaxy-z-flip6", label: "Galaxy Z Flip6", labelAr: "جالاكسي Z Flip6", width: 360, height: 748, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-flip-landscape" },
  { id: "galaxy-z-fold5-cover", label: "Galaxy Z Fold5 (cover)", labelAr: "جالاكسي Z Fold5 (غلاف)", width: 344, height: 882, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-fold-cover-landscape" },
  { id: "galaxy-z-fold5-inner", label: "Galaxy Z Fold5 (inner)", labelAr: "جالاكسي Z Fold5 (داخلي)", width: 717, height: 897, group: "Samsung", groupAr: "سامسونج", chrome: "none", rotateId: "galaxy-fold-inner-landscape" },
  { id: "galaxy-z-fold6-cover", label: "Galaxy Z Fold6 (cover)", labelAr: "جالاكسي Z Fold6 (غلاف)", width: 344, height: 882, group: "Samsung", groupAr: "سامسونج", chrome: "hole", rotateId: "galaxy-fold-cover-landscape" },
  { id: "galaxy-z-fold6-inner", label: "Galaxy Z Fold6 (inner)", labelAr: "جالاكسي Z Fold6 (داخلي)", width: 717, height: 897, group: "Samsung", groupAr: "سامسونج", chrome: "none", rotateId: "galaxy-fold-inner-landscape" },

  // —— Other (popular in KSA / region) ——
  { id: "huawei-p60", label: "Huawei P60", labelAr: "هواوي P60", width: 360, height: 780, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-landscape" },
  { id: "huawei-mate-60", label: "Huawei Mate 60", labelAr: "هواوي Mate 60", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "honor-200", label: "Honor 200", labelAr: "هونر 200", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "honor-magic6", label: "Honor Magic6", labelAr: "هونر Magic6", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "oneplus-12", label: "OnePlus 12", labelAr: "ون بلس 12", width: 450, height: 980, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "oneplus-landscape" },
  { id: "oneplus-13", label: "OnePlus 13", labelAr: "ون بلس 13", width: 450, height: 980, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "oneplus-landscape" },
  { id: "xiaomi-14", label: "Xiaomi 14", labelAr: "شاومي 14", width: 421, height: 935, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "xiaomi-landscape" },
  { id: "xiaomi-14-ultra", label: "Xiaomi 14 Ultra", labelAr: "شاومي 14 Ultra", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "xiaomi-15", label: "Xiaomi 15", labelAr: "شاومي 15", width: 421, height: 935, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "xiaomi-landscape" },
  { id: "redmi-note-13", label: "Redmi Note 13", labelAr: "ريدمي نوت 13", width: 393, height: 873, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "redmi-landscape" },
  { id: "oppo-find-x7", label: "OPPO Find X7", labelAr: "أوبو Find X7", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "vivo-x100", label: "vivo X100", labelAr: "فيفو X100", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "nothing-phone-2", label: "Nothing Phone (2)", labelAr: "ناثينج فون 2", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "nothing-phone-2a", label: "Nothing Phone (2a)", labelAr: "ناثينج فون 2a", width: 412, height: 915, group: "Other", groupAr: "أخرى", chrome: "hole", rotateId: "android-wide-landscape" },
  { id: "sony-xperia-1-v", label: "Sony Xperia 1 V", labelAr: "سوني إكسبيريا 1 V", width: 384, height: 854, group: "Other", groupAr: "أخرى", chrome: "none", rotateId: "xperia-landscape" },

  // —— Tablet ——
  { id: "ipad-mini", label: "iPad mini", labelAr: "آيباد mini", width: 744, height: 1133, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "ipad-mini-landscape" },
  { id: "ipad-10", label: "iPad (10th)", labelAr: "آيباد (10)", width: 820, height: 1180, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "ipad-10-landscape" },
  { id: "ipad-air", label: "iPad Air", labelAr: "آيباد Air", width: 820, height: 1180, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "ipad-10-landscape" },
  { id: "ipad-pro-11", label: "iPad Pro 11″", labelAr: "آيباد Pro 11″", width: 834, height: 1194, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "ipad-pro-11-landscape" },
  { id: "ipad-pro-13", label: "iPad Pro 13″", labelAr: "آيباد Pro 13″", width: 1032, height: 1376, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "ipad-pro-13-landscape" },
  { id: "galaxy-tab-s9", label: "Galaxy Tab S9", labelAr: "جالاكسي تاب S9", width: 800, height: 1280, group: "Tablet", groupAr: "تابلت", chrome: "none", rotateId: "galaxy-tab-landscape" },

  // —— Landscape (rotate targets) ——
  { id: "iphone-se-landscape", label: "iPhone SE landscape", labelAr: "آيفون SE أفقي", width: 667, height: 375, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "iphone-se" },
  { id: "iphone-mini-landscape", label: "iPhone mini landscape", labelAr: "آيفون mini أفقي", width: 812, height: 375, group: "Landscape", groupAr: "أفقي", chrome: "notch", rotateId: "iphone-12-mini" },
  { id: "iphone-landscape", label: "iPhone landscape", labelAr: "آيفون أفقي", width: 844, height: 390, group: "Landscape", groupAr: "أفقي", chrome: "notch", rotateId: "iphone-14" },
  { id: "iphone-xr-landscape", label: "iPhone XR landscape", labelAr: "آيفون XR أفقي", width: 896, height: 414, group: "Landscape", groupAr: "أفقي", chrome: "notch", rotateId: "iphone-xr" },
  { id: "iphone-plus-landscape", label: "iPhone Plus landscape", labelAr: "آيفون Plus أفقي", width: 926, height: 428, group: "Landscape", groupAr: "أفقي", chrome: "notch", rotateId: "iphone-14-plus" },
  { id: "iphone-pro-landscape", label: "iPhone Pro landscape", labelAr: "آيفون Pro أفقي", width: 852, height: 393, group: "Landscape", groupAr: "أفقي", chrome: "island", rotateId: "iphone-14-pro" },
  { id: "iphone-pro-max-landscape", label: "Pro Max landscape", labelAr: "Pro Max أفقي", width: 932, height: 430, group: "Landscape", groupAr: "أفقي", chrome: "island", rotateId: "iphone-14-pro-max" },
  { id: "iphone-16-pro-landscape", label: "iPhone 16 Pro landscape", labelAr: "آيفون 16 Pro أفقي", width: 874, height: 402, group: "Landscape", groupAr: "أفقي", chrome: "island", rotateId: "iphone-16-pro" },
  { id: "iphone-16-pro-max-landscape", label: "iPhone 16 Pro Max landscape", labelAr: "آيفون 16 Pro Max أفقي", width: 956, height: 440, group: "Landscape", groupAr: "أفقي", chrome: "island", rotateId: "iphone-16-pro-max" },
  { id: "pixel-landscape", label: "Pixel landscape", labelAr: "بكسل أفقي", width: 915, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "pixel-8" },
  { id: "pixel-pro-landscape", label: "Pixel Pro landscape", labelAr: "بكسل Pro أفقي", width: 892, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "pixel-7-pro" },
  { id: "pixel-8-pro-landscape", label: "Pixel 8 Pro landscape", labelAr: "بكسل 8 Pro أفقي", width: 998, height: 448, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "pixel-8-pro" },
  { id: "pixel-9-pro-landscape", label: "Pixel 9 Pro landscape", labelAr: "بكسل 9 Pro أفقي", width: 960, height: 430, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "pixel-9-pro" },
  { id: "pixel-fold-landscape", label: "Pixel Fold landscape", labelAr: "بكسل فولد أفقي", width: 829, height: 690, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "pixel-fold" },
  { id: "galaxy-a-landscape", label: "Galaxy A landscape", labelAr: "جالاكسي A أفقي", width: 854, height: 385, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-a15" },
  { id: "galaxy-s-landscape", label: "Galaxy S landscape", labelAr: "جالاكسي S أفقي", width: 915, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-a35" },
  { id: "galaxy-s21-landscape", label: "Galaxy S21 landscape", labelAr: "جالاكسي S21 أفقي", width: 800, height: 360, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-s21" },
  { id: "galaxy-s22-landscape", label: "Galaxy S22 landscape", labelAr: "جالاكسي S22 أفقي", width: 780, height: 360, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-s22" },
  { id: "galaxy-s24-plus-landscape", label: "Galaxy S24+ landscape", labelAr: "جالاكسي S24+ أفقي", width: 832, height: 384, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-s24-plus" },
  { id: "galaxy-ultra-landscape", label: "Galaxy Ultra landscape", labelAr: "جالاكسي Ultra أفقي", width: 892, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-s24-ultra" },
  { id: "galaxy-flip-landscape", label: "Galaxy Flip landscape", labelAr: "جالاكسي Flip أفقي", width: 748, height: 360, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-z-flip6" },
  { id: "galaxy-fold-cover-landscape", label: "Fold cover landscape", labelAr: "Fold غلاف أفقي", width: 882, height: 344, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "galaxy-z-fold6-cover" },
  { id: "galaxy-fold-inner-landscape", label: "Fold inner landscape", labelAr: "Fold داخلي أفقي", width: 897, height: 717, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "galaxy-z-fold6-inner" },
  { id: "android-landscape", label: "Android landscape", labelAr: "أندرويد أفقي", width: 780, height: 360, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "huawei-p60" },
  { id: "android-wide-landscape", label: "Android wide landscape", labelAr: "أندرويد عريض أفقي", width: 915, height: 412, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "honor-200" },
  { id: "oneplus-landscape", label: "OnePlus landscape", labelAr: "ون بلس أفقي", width: 980, height: 450, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "oneplus-12" },
  { id: "xiaomi-landscape", label: "Xiaomi landscape", labelAr: "شاومي أفقي", width: 935, height: 421, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "xiaomi-14" },
  { id: "redmi-landscape", label: "Redmi landscape", labelAr: "ريدمي أفقي", width: 873, height: 393, group: "Landscape", groupAr: "أفقي", chrome: "hole", rotateId: "redmi-note-13" },
  { id: "xperia-landscape", label: "Xperia landscape", labelAr: "إكسبيريا أفقي", width: 854, height: 384, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "sony-xperia-1-v" },
  { id: "ipad-mini-landscape", label: "iPad mini landscape", labelAr: "آيباد mini أفقي", width: 1133, height: 744, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "ipad-mini" },
  { id: "ipad-10-landscape", label: "iPad landscape", labelAr: "آيباد أفقي", width: 1180, height: 820, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "ipad-10" },
  { id: "ipad-pro-11-landscape", label: "iPad Pro 11″ landscape", labelAr: "آيباد Pro 11″ أفقي", width: 1194, height: 834, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "ipad-pro-11" },
  { id: "ipad-pro-13-landscape", label: "iPad Pro 13″ landscape", labelAr: "آيباد Pro 13″ أفقي", width: 1376, height: 1032, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "ipad-pro-13" },
  { id: "galaxy-tab-landscape", label: "Galaxy Tab landscape", labelAr: "جالاكسي تاب أفقي", width: 1280, height: 800, group: "Landscape", groupAr: "أفقي", chrome: "none", rotateId: "galaxy-tab-s9" },
];

const PHONE_SIZE_KEY = "arrab.studioPhoneSize";

export function phoneSizeGroups(ar = false): { id: string; label: string; items: PhoneSizePreset[] }[] {
  const order = ["Apple", "Google", "Samsung", "Other", "Tablet", "Landscape"] as const;
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
  return PHONE_SIZE_PRESETS.find((item) => item.id === id) ?? PHONE_SIZE_PRESETS[5]!;
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
