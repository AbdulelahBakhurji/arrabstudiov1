/**
 * Studio Markets Terminal — searchable universe across NASDAQ, NYSE, TASI, crypto, FX, indices.
 * Seed catalog + live Yahoo quotes via Arrab API (`/v1/markets/*`).
 */

export type MarketAssetClass = "equity" | "etf" | "fx" | "crypto" | "index";
export type MarketVenueFilter = "all" | "nasdaq" | "nyse" | "tasi" | "crypto" | "fx" | "index";

export type MarketQuote = {
  symbol: string;
  name: string;
  nameAr: string;
  assetClass: MarketAssetClass;
  exchange: string;
  currency: string;
  last: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  bid: number;
  ask: number;
  volume: number;
  avgVolume: number;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  sector: string;
  sectorAr: string;
};

export type MarketInstrument = Omit<
  MarketQuote,
  "bid" | "ask" | "high" | "low" | "open" | "volume"
> & {
  last: number;
  prevClose: number;
  avgVolume: number;
};

export type MarketCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type MarketNewsItem = {
  id: string;
  symbol: string;
  headline: string;
  headlineAr: string;
  source: string;
  ago: string;
  agoAr: string;
  sentiment: "pos" | "neg" | "neu";
};

export type MarketCalendarItem = {
  id: string;
  when: string;
  whenAr: string;
  event: string;
  eventAr: string;
  importance: "high" | "med" | "low";
  actual: string;
  forecast: string;
  previous: string;
};

export type MarketHeatCell = { id: string; label: string; labelAr: string; changePct: number };

export type MarketScreenRow = {
  symbol: string;
  name: string;
  sector: string;
  sectorAr: string;
  last: number;
  changePct: number;
  volume: number;
  relVol: number;
  pe: number | null;
  score: number;
};

export type MarketTechSnapshot = {
  pivot: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  atrProxy: number;
  momentum: "bullish" | "bearish" | "neutral";
  relVol: number;
  biasLine: string;
  biasLineAr: string;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function seedFromSymbol(symbol: string): number {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i += 1) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function instr(
  symbol: string,
  name: string,
  nameAr: string,
  exchange: string,
  currency: string,
  assetClass: MarketAssetClass,
  last: number,
  prevClose: number,
  avgVolume: number,
  sector: string,
  sectorAr: string,
  extras: Partial<Pick<MarketInstrument, "marketCap" | "pe" | "eps" | "dividendYield" | "beta">> = {},
): MarketInstrument {
  return {
    symbol,
    name,
    nameAr,
    exchange,
    currency,
    assetClass,
    last,
    prevClose,
    avgVolume,
    sector,
    sectorAr,
    marketCap: extras.marketCap ?? null,
    pe: extras.pe ?? null,
    eps: extras.eps ?? null,
    dividendYield: extras.dividendYield ?? null,
    beta: extras.beta ?? null,
  };
}

/** Full searchable desk universe. */
export const MARKET_UNIVERSE: MarketInstrument[] = [
  // NASDAQ / US mega + liquid
  instr("AAPL", "Apple Inc", "أبل", "NASDAQ", "USD", "equity", 335.92, 337.02, 52_400_000, "Technology", "تقنية", { marketCap: 3.24e12, pe: 33.2, eps: 6.45, dividendYield: 0.44, beta: 1.18 }),
  instr("MSFT", "Microsoft", "مايكروسوفت", "NASDAQ", "USD", "equity", 497.93, 500.6, 22_100_000, "Technology", "تقنية", { marketCap: 3.18e12, pe: 35.1, eps: 12.2, dividendYield: 0.72, beta: 0.92 }),
  instr("NVDA", "NVIDIA", "إنفيديا", "NASDAQ", "USD", "equity", 224.58, 225.4, 280_000_000, "Semiconductors", "أشباه موصلات", { marketCap: 2.9e12, pe: 58.4, eps: 2.03, dividendYield: 0.03, beta: 1.72 }),
  instr("GOOGL", "Alphabet", "ألفابت", "NASDAQ", "USD", "equity", 176.8, 175.2, 24_000_000, "Communication", "اتصالات", { marketCap: 2.15e12, pe: 24.1, eps: 7.33, dividendYield: 0.48, beta: 1.05 }),
  instr("AMZN", "Amazon", "أمازون", "NASDAQ", "USD", "equity", 186.2, 184.7, 41_000_000, "Consumer", "استهلاك", { marketCap: 1.95e12, pe: 42.5, eps: 4.38, beta: 1.15 }),
  instr("META", "Meta Platforms", "ميتا", "NASDAQ", "USD", "equity", 512.8, 508.1, 14_800_000, "Communication", "اتصالات", { marketCap: 1.3e12, pe: 27.4, eps: 18.7, dividendYield: 0.35, beta: 1.22 }),
  instr("TSLA", "Tesla", "تسلا", "NASDAQ", "USD", "equity", 377.94, 380.2, 95_000_000, "Auto", "سيارات", { marketCap: 7.9e11, pe: 68.2, eps: 3.65, beta: 2.05 }),
  instr("AVGO", "Broadcom", "برودكوم", "NASDAQ", "USD", "equity", 178.4, 176.1, 18_500_000, "Semiconductors", "أشباه موصلات", { marketCap: 8.3e11, pe: 45.2, eps: 3.95, dividendYield: 1.2, beta: 1.25 }),
  instr("AMD", "AMD", "إيه إم دي", "NASDAQ", "USD", "equity", 162.3, 159.8, 48_000_000, "Semiconductors", "أشباه موصلات", { marketCap: 2.6e11, pe: 38.5, eps: 4.21, beta: 1.65 }),
  instr("NFLX", "Netflix", "نتفليكس", "NASDAQ", "USD", "equity", 725.4, 718.2, 4_200_000, "Communication", "اتصالات", { marketCap: 3.1e11, pe: 41.2, eps: 17.6, beta: 1.28 }),
  instr("COST", "Costco", "كوستكو", "NASDAQ", "USD", "equity", 912.5, 908.1, 1_800_000, "Consumer", "استهلاك", { marketCap: 4.05e11, pe: 52.1, eps: 17.5, dividendYield: 0.52, beta: 0.78 }),
  instr("ADBE", "Adobe", "أدوبي", "NASDAQ", "USD", "equity", 498.2, 505.4, 3_100_000, "Software", "برمجيات", { marketCap: 2.2e11, pe: 36.4, eps: 13.7, beta: 1.15 }),
  instr("INTC", "Intel", "إنتل", "NASDAQ", "USD", "equity", 24.8, 24.2, 62_000_000, "Semiconductors", "أشباه موصلات", { marketCap: 1.05e11, pe: null, eps: -0.4, dividendYield: null, beta: 1.1 }),
  instr("CSCO", "Cisco", "سيسكو", "NASDAQ", "USD", "equity", 52.4, 52.1, 16_000_000, "Technology", "تقنية", { marketCap: 2.1e11, pe: 15.8, eps: 3.31, dividendYield: 3.1, beta: 0.9 }),
  instr("PEP", "PepsiCo", "بيبسيكو", "NASDAQ", "USD", "equity", 168.9, 169.5, 5_400_000, "Consumer", "استهلاك", { marketCap: 2.3e11, pe: 24.8, eps: 6.81, dividendYield: 3.15, beta: 0.55 }),
  instr("QCOM", "Qualcomm", "كوالكوم", "NASDAQ", "USD", "equity", 168.2, 165.4, 8_200_000, "Semiconductors", "أشباه موصلات", { marketCap: 1.88e11, pe: 18.4, eps: 9.14, dividendYield: 2.0, beta: 1.3 }),
  instr("AMAT", "Applied Materials", "أبلايد ماتيريالز", "NASDAQ", "USD", "equity", 198.5, 195.2, 6_100_000, "Semiconductors", "أشباه موصلات", { marketCap: 1.65e11, pe: 22.1, eps: 8.98, dividendYield: 0.85, beta: 1.4 }),
  instr("SBUX", "Starbucks", "ستاربكس", "NASDAQ", "USD", "equity", 94.2, 93.1, 9_800_000, "Consumer", "استهلاك", { marketCap: 1.07e11, pe: 26.5, eps: 3.55, dividendYield: 2.4, beta: 0.95 }),
  instr("PYPL", "PayPal", "باي بال", "NASDAQ", "USD", "equity", 78.4, 77.2, 12_400_000, "Financials", "مالية", { marketCap: 8.2e10, pe: 17.2, eps: 4.56, beta: 1.35 }),
  instr("MU", "Micron", "مايكروون", "NASDAQ", "USD", "equity", 112.6, 109.8, 22_000_000, "Semiconductors", "أشباه موصلات", { marketCap: 1.25e11, pe: 28.4, eps: 3.96, beta: 1.55 }),

  // NYSE
  instr("JPM", "JPMorgan", "جي بي مورغان", "NYSE", "USD", "equity", 214.5, 212.8, 9_200_000, "Financials", "مالية", { marketCap: 6.1e11, pe: 12.4, eps: 17.3, dividendYield: 2.15, beta: 1.1 }),
  instr("V", "Visa", "فيزا", "NYSE", "USD", "equity", 288.4, 286.1, 5_600_000, "Financials", "مالية", { marketCap: 5.7e11, pe: 31.2, eps: 9.25, dividendYield: 0.75, beta: 0.95 }),
  instr("MA", "Mastercard", "ماستركارد", "NYSE", "USD", "equity", 498.2, 494.5, 2_800_000, "Financials", "مالية", { marketCap: 4.6e11, pe: 36.8, eps: 13.5, dividendYield: 0.55, beta: 1.05 }),
  instr("XOM", "Exxon Mobil", "إكسون موبيل", "NYSE", "USD", "equity", 112.4, 111.2, 14_000_000, "Energy", "طاقة", { marketCap: 4.9e11, pe: 13.8, eps: 8.14, dividendYield: 3.4, beta: 0.85 }),
  instr("CVX", "Chevron", "شيفرون", "NYSE", "USD", "equity", 156.8, 155.4, 7_500_000, "Energy", "طاقة", { marketCap: 2.85e11, pe: 14.2, eps: 11.0, dividendYield: 4.1, beta: 0.9 }),
  instr("JNJ", "Johnson & Johnson", "جونسون آند جونسون", "NYSE", "USD", "equity", 158.2, 157.6, 6_400_000, "Healthcare", "رعاية صحية", { marketCap: 3.8e11, pe: 15.6, eps: 10.1, dividendYield: 3.15, beta: 0.5 }),
  instr("WMT", "Walmart", "وولمارت", "NYSE", "USD", "equity", 82.4, 81.9, 14_200_000, "Consumer", "استهلاك", { marketCap: 6.6e11, pe: 38.2, eps: 2.16, dividendYield: 1.05, beta: 0.48 }),
  instr("BAC", "Bank of America", "بنك أوف أمريكا", "NYSE", "USD", "equity", 41.8, 41.2, 38_000_000, "Financials", "مالية", { marketCap: 3.25e11, pe: 13.1, eps: 3.19, dividendYield: 2.35, beta: 1.25 }),
  instr("DIS", "Disney", "ديزني", "NYSE", "USD", "equity", 102.5, 101.2, 9_100_000, "Communication", "اتصالات", { marketCap: 1.86e11, pe: 36.4, eps: 2.81, beta: 1.2 }),
  instr("KO", "Coca-Cola", "كوكا كولا", "NYSE", "USD", "equity", 68.4, 68.1, 12_800_000, "Consumer", "استهلاك", { marketCap: 2.95e11, pe: 25.2, eps: 2.71, dividendYield: 2.95, beta: 0.55 }),
  instr("PG", "Procter & Gamble", "بروكتر آند غامبل", "NYSE", "USD", "equity", 168.2, 167.5, 5_900_000, "Consumer", "استهلاك", { marketCap: 3.95e11, pe: 26.1, eps: 6.44, dividendYield: 2.4, beta: 0.42 }),
  instr("LLY", "Eli Lilly", "إيلي ليلي", "NYSE", "USD", "equity", 812.4, 805.2, 3_400_000, "Healthcare", "رعاية صحية", { marketCap: 7.7e11, pe: 78.5, eps: 10.35, dividendYield: 0.65, beta: 0.45 }),
  instr("UNH", "UnitedHealth", "يونايتد هيلث", "NYSE", "USD", "equity", 542.1, 538.4, 3_100_000, "Healthcare", "رعاية صحية", { marketCap: 5.0e11, pe: 19.8, eps: 27.4, dividendYield: 1.45, beta: 0.6 }),
  instr("HD", "Home Depot", "هوم ديبوت", "NYSE", "USD", "equity", 398.5, 395.2, 3_600_000, "Consumer", "استهلاك", { marketCap: 3.95e11, pe: 25.4, eps: 15.7, dividendYield: 2.25, beta: 1.05 }),
  instr("CRM", "Salesforce", "سيلزفورس", "NYSE", "USD", "equity", 312.4, 308.6, 5_200_000, "Software", "برمجيات", { marketCap: 3.0e11, pe: 42.1, eps: 7.42, beta: 1.25 }),
  instr("BA", "Boeing", "بوينغ", "NYSE", "USD", "equity", 178.2, 175.4, 7_800_000, "Industrials", "صناعة", { marketCap: 1.1e11, pe: null, eps: -2.1, beta: 1.45 }),
  instr("CAT", "Caterpillar", "كاتربيلر", "NYSE", "USD", "equity", 368.5, 364.2, 2_900_000, "Industrials", "صناعة", { marketCap: 1.8e11, pe: 16.8, eps: 21.9, dividendYield: 1.55, beta: 1.15 }),
  instr("GS", "Goldman Sachs", "غولدمان ساكس", "NYSE", "USD", "equity", 512.8, 508.4, 2_100_000, "Financials", "مالية", { marketCap: 1.65e11, pe: 15.2, eps: 33.7, dividendYield: 2.25, beta: 1.35 }),

  // Tadawul / TASI — official 4-digit codes
  instr("2222", "Saudi Aramco", "أرامكو السعودية", "TADAWUL", "SAR", "equity", 25.78, 25.64, 9_200_000, "Energy", "طاقة", { marketCap: 6.3e12, pe: 15.4, eps: 1.69, dividendYield: 5.2, beta: 0.01 }),
  instr("1120", "Al Rajhi Bank", "مصرف الراجحي", "TADAWUL", "SAR", "equity", 63.15, 64.45, 8_800_000, "Financials", "مالية", { marketCap: 2.5e11, pe: 18.2, eps: 5.08, dividendYield: 2.4, beta: 0.78 }),
  instr("1180", "Saudi National Bank", "البنك الأهلي السعودي", "TADAWUL", "SAR", "equity", 38.6, 38.25, 4_100_000, "Financials", "مالية", { marketCap: 2.3e11, pe: 12.4, eps: 3.11, dividendYield: 4.2, beta: 0.85 }),
  instr("2010", "SABIC", "سابك", "TADAWUL", "SAR", "equity", 72.8, 72.1, 2_200_000, "Materials", "مواد", { marketCap: 2.18e11, pe: 22.5, eps: 3.24, dividendYield: 3.8, beta: 0.95 }),
  instr("7010", "stc", "الاتصالات السعودية", "TADAWUL", "SAR", "equity", 43.22, 43.66, 2_700_000, "Telecom", "اتصالات", { marketCap: 2.2e11, pe: 16.8, eps: 2.63, dividendYield: 4.5, beta: 0.55 }),
  instr("1010", "Riyad Bank", "بنك الرياض", "TADAWUL", "SAR", "equity", 31.5, 31.2, 2_600_000, "Financials", "مالية", { marketCap: 9.5e10, pe: 11.8, eps: 2.67, dividendYield: 4.8, beta: 0.9 }),
  instr("1150", "Alinma Bank", "مصرف الإنماء", "TADAWUL", "SAR", "equity", 28.9, 28.55, 5_200_000, "Financials", "مالية", { marketCap: 7.2e10, pe: 14.5, eps: 1.99, dividendYield: 3.2, beta: 0.95 }),
  instr("1211", "Maaden", "معادن", "TADAWUL", "SAR", "equity", 52.4, 51.8, 3_800_000, "Materials", "مواد", { marketCap: 1.95e11, pe: 28.4, eps: 1.84, dividendYield: 1.1, beta: 1.15 }),
  instr("2020", "SABIC Agri-Nutrients", "سابك للمغذيات الزراعية", "TADAWUL", "SAR", "equity", 118.4, 117.2, 620_000, "Materials", "مواد", { marketCap: 5.6e10, pe: 18.2, eps: 6.5, dividendYield: 5.6, beta: 0.85 }),
  instr("4030", "Bahri", "البحري", "TADAWUL", "SAR", "equity", 28.6, 28.2, 1_100_000, "Industrials", "صناعة", { marketCap: 2.8e10, pe: 12.1, eps: 2.36, dividendYield: 3.4, beta: 0.9 }),
  instr("2082", "ACWA Power", "أكوا باور", "TADAWUL", "SAR", "equity", 348.5, 342.2, 480_000, "Utilities", "مرافق", { marketCap: 2.55e11, pe: 62.4, eps: 5.58, dividendYield: 0.55, beta: 0.75 }),
  instr("4190", "Jarir", "جرير", "TADAWUL", "SAR", "equity", 14.8, 14.65, 2_400_000, "Consumer", "استهلاك", { marketCap: 1.78e10, pe: 19.5, eps: 0.76, dividendYield: 4.8, beta: 0.7 }),
  instr("2280", "Almarai", "المراعي", "TADAWUL", "SAR", "equity", 58.2, 57.8, 980_000, "Consumer", "استهلاك", { marketCap: 5.8e10, pe: 24.2, eps: 2.4, dividendYield: 2.1, beta: 0.55 }),
  instr("4001", "Abdullah Al Othaim", "عبدالله العثيم", "TADAWUL", "SAR", "equity", 12.4, 12.25, 1_600_000, "Consumer", "استهلاك", { marketCap: 1.12e10, pe: 21.4, eps: 0.58, dividendYield: 3.5, beta: 0.65 }),
  instr("6015", "Saudi Coffee Company", "شركة القهوة السعودية", "TADAWUL", "SAR", "equity", 98.5, 96.8, 1_250_000, "Consumer", "استهلاك", { marketCap: 9.8e9, pe: 48.2, eps: 2.05, beta: 1.05 }),
  instr("7203", "Elm", "علم", "TADAWUL", "SAR", "equity", 918.4, 905.2, 210_000, "Technology", "تقنية", { marketCap: 7.3e10, pe: 38.5, eps: 23.8, dividendYield: 1.2, beta: 0.85 }),
  instr("4261", "Theeb Rent a Car", "ذيب لتأجير السيارات", "TADAWUL", "SAR", "equity", 72.8, 71.4, 540_000, "Consumer", "استهلاك", { marketCap: 3.1e9, pe: 16.8, eps: 4.33, dividendYield: 3.8, beta: 0.95 }),
  instr("2382", "ADES Holding", "أديس القابضة", "TADAWUL", "SAR", "equity", 16.8, 16.55, 2_800_000, "Energy", "طاقة", { marketCap: 1.85e10, pe: 14.2, eps: 1.18, dividendYield: 4.1, beta: 1.05 }),
  instr("1830", "Leejam Sports", "ليجام للرياضة", "TADAWUL", "SAR", "equity", 178.4, 176.2, 420_000, "Consumer", "استهلاك", { marketCap: 9.3e9, pe: 22.4, eps: 7.96, dividendYield: 2.1, beta: 0.85 }),
  instr("4300", "Dar Al Arkan", "دار الأركان", "TADAWUL", "SAR", "equity", 16.2, 16.05, 4_500_000, "Real Estate", "عقار", { marketCap: 1.75e10, pe: 18.5, eps: 0.88, dividendYield: 0, beta: 1.15 }),
  instr("4003", "Extra", "إكسترا", "TADAWUL", "SAR", "equity", 98.2, 96.8, 680_000, "Consumer", "استهلاك", { marketCap: 7.8e9, pe: 19.2, eps: 5.11, dividendYield: 3.2, beta: 0.9 }),
  instr("4161", "BinDawood Holding", "بن داود القابضة", "TADAWUL", "SAR", "equity", 7.85, 7.78, 3_200_000, "Consumer", "استهلاك", { marketCap: 8.9e9, pe: 24.1, eps: 0.33, dividendYield: 2.8, beta: 0.7 }),
  instr("2050", "Savola Group", "مجموعة صافولا", "TADAWUL", "SAR", "equity", 32.4, 32.1, 1_400_000, "Consumer", "استهلاك", { marketCap: 1.72e10, pe: 16.8, eps: 1.93, dividendYield: 3.5, beta: 0.75 }),
  instr("5110", "Saudi Electricity", "الكهرباء السعودية", "TADAWUL", "SAR", "equity", 18.6, 18.45, 5_800_000, "Utilities", "مرافق", { marketCap: 7.75e10, pe: 14.2, eps: 1.31, dividendYield: 3.8, beta: 0.45 }),
  instr("8210", "Bupa Arabia", "بوبا العربية", "TADAWUL", "SAR", "equity", 218.4, 215.2, 310_000, "Insurance", "تأمين", { marketCap: 2.6e10, pe: 21.5, eps: 10.16, dividendYield: 1.8, beta: 0.65 }),
  instr("1020", "Bank AlJazira", "بنك الجزيرة", "TADAWUL", "SAR", "equity", 18.9, 18.7, 3_600_000, "Financials", "مالية", { marketCap: 1.55e10, pe: 13.4, eps: 1.41, dividendYield: 4.0, beta: 0.95 }),
  instr("1060", "Banque Saudi Fransi", "البنك السعودي الفرنسي", "TADAWUL", "SAR", "equity", 38.2, 37.9, 2_100_000, "Financials", "مالية", { marketCap: 4.6e10, pe: 11.8, eps: 3.24, dividendYield: 4.5, beta: 0.88 }),
  instr("1140", "Bank Albilad", "بنك البلاد", "TADAWUL", "SAR", "equity", 42.8, 42.4, 2_800_000, "Financials", "مالية", { marketCap: 4.3e10, pe: 14.6, eps: 2.93, dividendYield: 3.2, beta: 0.9 }),
  instr("1111", "Saudi Tadawul Group", "مجموعة تداول السعودية", "TADAWUL", "SAR", "equity", 218.0, 215.5, 280_000, "Financials", "مالية", { marketCap: 2.6e10, pe: 28.4, eps: 7.68, dividendYield: 1.5, beta: 0.7 }),
  instr("2223", "Saudi Aramco Base Oil", "أرامكو لزيوت الأساس", "TADAWUL", "SAR", "equity", 112.4, 110.8, 650_000, "Energy", "طاقة", { marketCap: 1.9e10, pe: 16.2, eps: 6.94, dividendYield: 4.2, beta: 0.85 }),

  // ETFs / indices
  instr("SPY", "SPDR S&P 500", "صندوق S&P 500", "NYSE", "USD", "etf", 767.18, 768.4, 48_000_000, "Index ETF", "صندوق مؤشر", { dividendYield: 1.25, beta: 1 }),
  instr("QQQ", "Invesco QQQ", "صندوق ناسداك 100", "NASDAQ", "USD", "etf", 741.1, 741.2, 32_000_000, "Index ETF", "صندوق مؤشر", { dividendYield: 0.55, beta: 1.15 }),
  instr("IWM", "iShares Russell 2000", "رسل 2000", "NYSE", "USD", "etf", 218.4, 216.8, 28_000_000, "Index ETF", "صندوق مؤشر", { dividendYield: 1.15, beta: 1.2 }),
  instr("DIA", "SPDR Dow Jones", "داو جونز", "NYSE", "USD", "etf", 428.5, 426.2, 3_200_000, "Index ETF", "صندوق مؤشر", { dividendYield: 1.65, beta: 0.95 }),
  instr("EEM", "iShares MSCI Emerging", "الأسواق الناشئة", "NYSE", "USD", "etf", 44.8, 44.5, 22_000_000, "Index ETF", "صندوق مؤشر", { dividendYield: 2.4, beta: 1.05 }),
  instr("GLD", "SPDR Gold", "الذهب", "NYSE", "USD", "etf", 248.2, 246.8, 6_800_000, "Commodities", "سلع", { beta: 0.15 }),
  instr("USO", "United States Oil", "النفط", "NYSE", "USD", "etf", 72.4, 71.8, 4_200_000, "Commodities", "سلع", { beta: 1.35 }),
  instr("TASI", "Tadawul All Share", "مؤشر تاسي", "TADAWUL", "SAR", "index", 10598, 10580, 0, "Index", "مؤشر"),
  instr("NOMU", "Nomu Parallel Market", "نمو", "TADAWUL", "SAR", "index", 24850, 24720, 0, "Index", "مؤشر"),
  instr("SPX", "S&P 500", "إس آند بي 500", "INDEX", "USD", "index", 5624, 5608, 0, "Index", "مؤشر"),
  instr("IXIC", "NASDAQ Composite", "مؤشر ناسداك", "INDEX", "USD", "index", 17842, 17765, 0, "Index", "مؤشر"),
  instr("DJI", "Dow Jones", "داو جونز", "INDEX", "USD", "index", 41285, 41140, 0, "Index", "مؤشر"),

  // FX
  instr("EURUSD", "Euro / US Dollar", "يورو / دولار", "FX", "USD", "fx", 1.13968, 1.1376, 0, "FX", "عملات"),
  instr("GBPUSD", "Cable", "إسترليني / دولار", "FX", "USD", "fx", 1.3124, 1.3098, 0, "FX", "عملات"),
  instr("USDJPY", "Dollar / Yen", "دولار / ين", "FX", "JPY", "fx", 149.82, 150.15, 0, "FX", "عملات"),
  instr("USDSAR", "Dollar / Riyal", "دولار / ريال", "FX", "SAR", "fx", 3.752, 3.7515, 0, "FX", "عملات"),
  instr("XAUUSD", "Gold Spot", "ذهب فوري", "FX", "USD", "fx", 2684.5, 2672.2, 0, "Commodities", "سلع"),
  instr("WTI", "WTI Crude", "خام غرب تكساس", "FX", "USD", "fx", 72.85, 71.9, 0, "Commodities", "سلع"),

  // Crypto
  instr("BTCUSD", "Bitcoin", "بيتكوين", "CRYPTO", "USD", "crypto", 84672, 84410, 28_000, "Crypto", "عملات مشفرة", { marketCap: 1.65e12 }),
  instr("ETHUSD", "Ethereum", "إيثريوم", "CRYPTO", "USD", "crypto", 2711, 2688, 95_000, "Crypto", "عملات مشفرة", { marketCap: 4.12e11 }),
  instr("SOLUSD", "Solana", "سولانا", "CRYPTO", "USD", "crypto", 168.4, 164.2, 180_000, "Crypto", "عملات مشفرة", { marketCap: 7.8e10 }),
  instr("BNBUSD", "BNB", "بي إن بي", "CRYPTO", "USD", "crypto", 612.5, 605.2, 42_000, "Crypto", "عملات مشفرة", { marketCap: 8.9e10 }),
  instr("XRPUSD", "XRP", "ريبل", "CRYPTO", "USD", "crypto", 0.624, 0.612, 420_000, "Crypto", "عملات مشفرة", { marketCap: 3.5e10 }),
  instr("ADAUSD", "Cardano", "كاردانو", "CRYPTO", "USD", "crypto", 0.485, 0.472, 310_000, "Crypto", "عملات مشفرة", { marketCap: 1.7e10 }),
  instr("DOGEUSD", "Dogecoin", "دوجكوين", "CRYPTO", "USD", "crypto", 0.128, 0.124, 520_000, "Crypto", "عملات مشفرة", { marketCap: 1.85e10 }),
  instr("AVAXUSD", "Avalanche", "أفالانش", "CRYPTO", "USD", "crypto", 32.8, 31.9, 95_000, "Crypto", "عملات مشفرة", { marketCap: 1.32e10 }),
];

const DEFAULT_WATCH_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "2222",
  "1120",
  "7010",
  "SPY",
  "QQQ",
  "TASI",
  "BTCUSD",
  "ETHUSD",
  "EURUSD",
];

/** Desk UI refresh cadence (ms). Live Yahoo poll is separate (`LIVE_QUOTE_POLL_MS`). */
export const DESK_TICK_MS = 250;
/** How often the desk pulls real quotes from the Arrab API. */
export const LIVE_QUOTE_POLL_MS = 3_000;

function digitsFor(assetClass: MarketAssetClass, last: number): number {
  if (assetClass === "fx") return last < 10 ? 4 : 2;
  if (last >= 1000) return 0;
  if (last < 1) return 4;
  return 2;
}

export function hydrateQuote(row: MarketInstrument): MarketQuote {
  const digits = digitsFor(row.assetClass, row.last);
  const spread = row.assetClass === "fx" ? (row.last < 10 ? 0.0002 : 0.02) : row.last * 0.0004;
  return {
    ...row,
    open: round(row.prevClose * (1 + ((seedFromSymbol(row.symbol) % 17) - 8) / 2000), digits),
    high: round(Math.max(row.last, row.prevClose) * 1.008, digits),
    low: round(Math.min(row.last, row.prevClose) * 0.992, digits),
    bid: round(row.last - spread / 2, digits),
    ask: round(row.last + spread / 2, digits),
    volume: Math.round(row.avgVolume * (0.55 + (seedFromSymbol(row.symbol) % 40) / 100)),
  };
}

export function seedMarketQuotes(): MarketQuote[] {
  return DEFAULT_WATCH_SYMBOLS.map((symbol) => {
    const row = MARKET_UNIVERSE.find((item) => item.symbol === symbol)!;
    return hydrateQuote(row);
  });
}

export function venueOf(quote: Pick<MarketInstrument, "exchange" | "assetClass">): MarketVenueFilter {
  if (quote.assetClass === "crypto") return "crypto";
  if (quote.assetClass === "fx") return "fx";
  if (quote.assetClass === "index") return "index";
  if (quote.exchange === "NASDAQ") return "nasdaq";
  if (quote.exchange === "NYSE") return "nyse";
  if (quote.exchange === "TADAWUL") return "tasi";
  if (quote.exchange === "INDEX") return "index";
  if (quote.exchange === "CRYPTO") return "crypto";
  if (quote.exchange === "FX") return "fx";
  return "all";
}

export function matchesVenue(item: MarketInstrument, venue: MarketVenueFilter): boolean {
  if (venue === "all") return true;
  return venueOf(item) === venue;
}

export function searchMarketUniverse(query: string, venue: MarketVenueFilter = "all", limit = 24): MarketInstrument[] {
  const q = query.trim().toLowerCase();
  const pool = MARKET_UNIVERSE.filter((item) => matchesVenue(item, venue));
  if (!q) return pool.slice(0, limit);
  const scored = pool
    .map((item) => {
      const symbol = item.symbol.toLowerCase();
      const name = item.name.toLowerCase();
      const nameAr = item.nameAr;
      let score = 0;
      if (symbol === q) score = 100;
      else if (symbol.startsWith(q)) score = 80;
      else if (symbol.includes(q)) score = 60;
      else if (name.startsWith(q)) score = 50;
      else if (name.includes(q)) score = 35;
      else if (nameAr.includes(query.trim())) score = 40;
      else if (item.sector.toLowerCase().includes(q) || item.sectorAr.includes(query.trim())) score = 20;
      return { item, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol));
  return scored.slice(0, limit).map((row) => row.item);
}

export function listVenueInstruments(venue: MarketVenueFilter): MarketInstrument[] {
  return MARKET_UNIVERSE.filter((item) => matchesVenue(item, venue)).sort((a, b) =>
    a.symbol.localeCompare(b.symbol, undefined, { numeric: true }),
  );
}

export function displaySymbol(symbol: string): string {
  return symbol.replace(/\.SR$/i, "").replace(/^\^/, "");
}

/** Resolve any ticker — catalog hit or synthetic desk stub for free-form symbols. */
export function resolveInstrument(raw: string): MarketInstrument {
  const input = raw.trim().toUpperCase();
  let normalized = input
    .replace(/\.SR$/i, "")
    .replace(/^\^/, "")
    .replace(/\/USD$/i, "USD")
    .replace(/^BTC$/, "BTCUSD")
    .replace(/^ETH$/, "ETHUSD")
    .replace(/^SOL$/, "SOLUSD")
    .replace(/^GSPC$/, "SPX")
    .replace(/^NDX$/, "IXIC");

  if (normalized === "^TASI") normalized = "TASI";

  const direct = MARKET_UNIVERSE.find(
    (item) =>
      item.symbol.toUpperCase() === normalized ||
      item.symbol.toUpperCase() === input ||
      item.symbol.toUpperCase() === `${normalized}.SR`,
  );
  if (direct) return direct;

  // Tadawul 4-digit
  if (/^\d{4}$/.test(normalized)) {
    const tasi = MARKET_UNIVERSE.find((item) => item.symbol === normalized);
    if (tasi) return tasi;
  }

  const seed = seedFromSymbol(normalized || "SYM");
  const isCrypto = /USD$|USDT$|BTC|ETH|SOL|XRP|DOGE|ADA|AVAX|BNB/.test(normalized);
  const isTasi = /^\d{4}$/.test(normalized);
  const isFx = /USD|EUR|GBP|JPY|SAR|XAU|WTI/.test(normalized) && normalized.length >= 6 && !isCrypto;
  const assetClass: MarketAssetClass = isCrypto ? "crypto" : isFx ? "fx" : isTasi ? "equity" : "equity";
  const exchange = isCrypto ? "CRYPTO" : isFx ? "FX" : isTasi ? "TADAWUL" : "NASDAQ";
  const currency = isTasi ? "SAR" : isFx && normalized.includes("JPY") ? "JPY" : "USD";
  const base = isCrypto ? 50 + (seed % 900) : isTasi ? 10 + (seed % 120) : 20 + (seed % 480);
  const last = assetClass === "fx" ? 1 + (seed % 200) / 1000 : base + (seed % 100) / 10;
  const prevClose = last * (1 - ((seed % 9) - 4) / 1000);
  return instr(
    normalized || "SYMB",
    normalized || "Custom symbol",
    normalized || "رمز مخصص",
    exchange,
    currency,
    assetClass,
    round(last, digitsFor(assetClass, last)),
    round(prevClose, digitsFor(assetClass, last)),
    1_000_000 + (seed % 40) * 100_000,
    isCrypto ? "Crypto" : isTasi ? "Tadawul" : "Equity",
    isCrypto ? "عملات مشفرة" : isTasi ? "تداول" : "أسهم",
    { beta: 1 + (seed % 50) / 100 },
  );
}

export function changePct(quote: MarketQuote): number {
  if (!quote.prevClose) return 0;
  return ((quote.last - quote.prevClose) / quote.prevClose) * 100;
}

export type LiveQuotePatch = {
  symbol: string;
  last: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prevClose?: number | null;
  volume?: number | null;
  marketCap?: number | null;
};

/** Merge real API quotes onto the desk book without dropping local metadata. */
export function applyLiveQuotes(quotes: MarketQuote[], live: LiveQuotePatch[]): MarketQuote[] {
  if (!live.length) return quotes;
  const bySymbol = new Map(live.map((item) => [item.symbol.toUpperCase(), item]));
  return quotes.map((quote) => {
    const patch = bySymbol.get(quote.symbol.toUpperCase());
    if (!patch || !Number.isFinite(patch.last)) return quote;
    return mergeLiveIntoQuote(quote, patch);
  });
}

export function mergeLiveIntoQuote(quote: MarketQuote, patch: LiveQuotePatch): MarketQuote {
  const digits = digitsFor(quote.assetClass, patch.last);
  const last = round(patch.last, digits);
  const prevClose =
    typeof patch.prevClose === "number" && Number.isFinite(patch.prevClose)
      ? round(patch.prevClose, digits)
      : quote.prevClose;
  const open =
    typeof patch.open === "number" && Number.isFinite(patch.open) ? round(patch.open, digits) : quote.open;
  const high =
    typeof patch.high === "number" && Number.isFinite(patch.high)
      ? round(patch.high, digits)
      : Math.max(quote.high, last);
  const low =
    typeof patch.low === "number" && Number.isFinite(patch.low)
      ? round(patch.low, digits)
      : Math.min(quote.low, last);
  const volume =
    typeof patch.volume === "number" && Number.isFinite(patch.volume)
      ? Math.round(patch.volume)
      : quote.volume;
  const marketCap =
    typeof patch.marketCap === "number" && Number.isFinite(patch.marketCap)
      ? patch.marketCap
      : quote.marketCap;
  const spread = quote.assetClass === "fx" ? (last < 10 ? 0.0002 : 0.02) : last * 0.00035;
  return {
    ...quote,
    last,
    prevClose,
    open,
    high,
    low,
    volume,
    marketCap,
    bid: round(last - spread / 2, digits),
    ask: round(last + spread / 2, digits),
  };
}

/** Overlay a live book onto catalog instruments (venue lists / search). */
export function withLiveInstrument(
  item: MarketInstrument,
  liveBook: Map<string, LiveQuotePatch>,
): MarketInstrument {
  const patch = liveBook.get(item.symbol.toUpperCase());
  if (!patch || !Number.isFinite(patch.last)) return item;
  const digits = digitsFor(item.assetClass, patch.last);
  return {
    ...item,
    last: round(patch.last, digits),
    prevClose:
      typeof patch.prevClose === "number" && Number.isFinite(patch.prevClose)
        ? round(patch.prevClose, digits)
        : item.prevClose,
  };
}

export function liveBookFromPatches(patches: LiveQuotePatch[]): Map<string, LiveQuotePatch> {
  return new Map(patches.map((p) => [p.symbol.toUpperCase(), p]));
}

export function mergeLiveBook(
  prev: Map<string, LiveQuotePatch>,
  patches: LiveQuotePatch[],
): Map<string, LiveQuotePatch> {
  if (!patches.length) return prev;
  const next = new Map(prev);
  for (const patch of patches) {
    if (!Number.isFinite(patch.last)) continue;
    next.set(patch.symbol.toUpperCase(), patch);
  }
  return next;
}

/** Chunked live quote pull (API max 50). */
export async function fetchLiveQuoteChunks(
  symbols: string[],
  fetchFn: (chunk: string[]) => Promise<{ items: LiveQuotePatch[] }>,
): Promise<LiveQuotePatch[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out: LiveQuotePatch[] = [];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const res = await fetchFn(chunk);
      out.push(...res.items);
    } catch {
      // keep going on remaining chunks
    }
  }
  return out;
}

/**
 * Desk micro-tick. When `liveLocked` is true, last/OHLC stay on the real feed —
 * only bid/ask flicker so the board still feels alive between polls.
 */
export function tickMarketQuotes(quotes: MarketQuote[], liveLocked = false): MarketQuote[] {
  return quotes.map((quote) => {
    const seed = seedFromSymbol(quote.symbol + String(Math.floor(Date.now() / DESK_TICK_MS)));
    if (liveLocked) {
      const digits = digitsFor(quote.assetClass, quote.last);
      const spreadBase = quote.assetClass === "fx" ? (quote.last < 10 ? 0.00015 : 0.015) : quote.last * 0.0003;
      const flicker = ((seed % 7) - 3) * (spreadBase / 12);
      const spread = Math.max(spreadBase / 4, spreadBase + flicker);
      return {
        ...quote,
        bid: round(quote.last - spread / 2, digits),
        ask: round(quote.last + spread / 2, digits),
      };
    }
    const vol =
      quote.assetClass === "fx"
        ? 0.00004
        : quote.assetClass === "crypto"
          ? 0.00055
          : quote.assetClass === "index"
            ? 0.00012
            : 0.00028;
    const shock = ((seed % 1000) / 1000 - 0.5) * 2 * vol;
    const next = Math.max(0.0001, quote.last * (1 + shock));
    const digits = digitsFor(quote.assetClass, next);
    const last = round(next, digits);
    const spread = quote.assetClass === "fx" ? (last < 10 ? 0.0001 : 0.01) : last * 0.00025;
    return {
      ...quote,
      last,
      high: round(Math.max(quote.high, last), digits),
      low: round(Math.min(quote.low, last), digits),
      bid: round(last - spread / 2, digits),
      ask: round(last + spread / 2, digits),
      volume: quote.volume + Math.round((seed % 1200) + 80),
    };
  });
}

export function buildCandleSeries(quote: MarketQuote, bars = 64): MarketCandle[] {
  const seed = seedFromSymbol(quote.symbol);
  const candles: MarketCandle[] = [];
  let price = quote.prevClose * 0.985;
  const now = Date.now();
  const digits = digitsFor(quote.assetClass, quote.last);
  for (let i = bars; i >= 0; i -= 1) {
    const drift = ((seed + i * 97) % 21) / 1000 - 0.01;
    const open = price;
    const close = Math.max(0.0001, open * (1 + drift + (((seed >> (i % 8)) & 7) - 3) / 900));
    const high = Math.max(open, close) * (1 + ((seed + i) % 5) / 800);
    const low = Math.min(open, close) * (1 - ((seed + i * 3) % 5) / 800);
    candles.push({
      t: now - i * 15 * 60_000,
      o: round(open, digits),
      h: round(high, digits),
      l: round(low, digits),
      c: round(close, digits),
      v: Math.round(quote.avgVolume / bars + ((seed + i) % 50_000)),
    });
    price = close;
  }
  if (candles.length) {
    candles[candles.length - 1] = {
      ...candles[candles.length - 1]!,
      c: quote.last,
      h: Math.max(candles[candles.length - 1]!.h, quote.last),
      l: Math.min(candles[candles.length - 1]!.l, quote.last),
    };
  }
  return candles;
}

export function buildTechSnapshot(quote: MarketQuote): MarketTechSnapshot {
  const digits = digitsFor(quote.assetClass, quote.last);
  const pivot = round((quote.high + quote.low + quote.last) / 3, digits);
  const range = Math.max(quote.high - quote.low, quote.last * 0.004);
  const atrProxy = round(range, digits);
  const pct = changePct(quote);
  const relVol = quote.avgVolume ? quote.volume / quote.avgVolume : 1;
  const momentum = pct > 0.35 ? "bullish" : pct < -0.35 ? "bearish" : "neutral";
  const biasLine =
    momentum === "bullish"
      ? `Constructive while above ${formatPrice(pivot, quote.assetClass)}; watch ${formatPrice(quote.high, quote.assetClass)} break.`
      : momentum === "bearish"
        ? `Soft while below ${formatPrice(pivot, quote.assetClass)}; ${formatPrice(quote.low, quote.assetClass)} is first invalidation.`
        : `Range-bound around ${formatPrice(pivot, quote.assetClass)}; wait for ${formatPrice(quote.high, quote.assetClass)} / ${formatPrice(quote.low, quote.assetClass)}.`;
  const biasLineAr =
    momentum === "bullish"
      ? `إيجابي فوق ${formatPrice(pivot, quote.assetClass)}؛ راقب كسر ${formatPrice(quote.high, quote.assetClass)}.`
      : momentum === "bearish"
        ? `ضعيف تحت ${formatPrice(pivot, quote.assetClass)}؛ ${formatPrice(quote.low, quote.assetClass)} أول إبطال.`
        : `عرضي حول ${formatPrice(pivot, quote.assetClass)}؛ انتظر ${formatPrice(quote.high, quote.assetClass)} / ${formatPrice(quote.low, quote.assetClass)}.`;
  return {
    pivot,
    support1: round(pivot - atrProxy, digits),
    support2: round(quote.low - atrProxy * 0.35, digits),
    resistance1: round(pivot + atrProxy, digits),
    resistance2: round(quote.high + atrProxy * 0.35, digits),
    atrProxy,
    momentum,
    relVol: round(relVol, 2),
    biasLine,
    biasLineAr,
  };
}

export function buildAdvancedAnalysisPrompt(quote: MarketQuote, ar: boolean): string {
  const tech = buildTechSnapshot(quote);
  const pct = changePct(quote);
  if (ar) {
    return [
      `تحليل متقدم مباشر لـ ${displaySymbol(quote.symbol)} (${quote.nameAr}) على ${quote.exchange}.`,
      `طلب طرفية احترافي منخفض الكمون — ليس نصيحة مالية. حلّل فوراً من لقطة المكتب الحية.`,
      `لقطة حية: آخر=${formatPrice(quote.last, quote.assetClass)} تغير=${formatPct(pct)} نطاق=${formatPrice(quote.low, quote.assetClass)}–${formatPrice(quote.high, quote.assetClass)} حجم=${formatCompact(quote.volume, 1)} قيمة سوقية=${formatCompact(quote.marketCap)}.`,
      `محور=${formatPrice(tech.pivot, quote.assetClass)} دعم=${formatPrice(tech.support1, quote.assetClass)}/${formatPrice(tech.support2, quote.assetClass)} مقاومة=${formatPrice(tech.resistance1, quote.assetClass)}/${formatPrice(tech.resistance2, quote.assetClass)} زخم=${tech.momentum} حجم نسبي=${tech.relVol}x.`,
      "قدّم فوراً: 1) الحكم الفوري 2) المحفزات 3) القيمة النسبية/القطاع 4) الانحياز مع الإبطال 5) الأفق والتحجيم والمخاطر 6) ما الذي تراقبه لاحقاً.",
    ].join("\n");
  }
  return [
    `Advanced desk analysis for ${displaySymbol(quote.symbol)} (${quote.name}) on ${quote.exchange}.`,
    `Professional low-latency terminal request — not financial advice. Analyze immediately from the live desk snapshot.`,
    `Live desk: last=${formatPrice(quote.last, quote.assetClass)} chg=${formatPct(pct)} range=${formatPrice(quote.low, quote.assetClass)}–${formatPrice(quote.high, quote.assetClass)} vol=${formatCompact(quote.volume, 1)} mktCap=${formatCompact(quote.marketCap)}.`,
    `Pivot=${formatPrice(tech.pivot, quote.assetClass)} support=${formatPrice(tech.support1, quote.assetClass)}/${formatPrice(tech.support2, quote.assetClass)} resistance=${formatPrice(tech.resistance1, quote.assetClass)}/${formatPrice(tech.resistance2, quote.assetClass)} momentum=${tech.momentum} relVol=${tech.relVol}x.`,
    "Deliver immediately: 1) instant read 2) catalysts 3) relative value/sector 4) bias + invalidation 5) horizon/sizing/risk 6) what to watch next.",
  ].join("\n");
}

export const MARKET_NEWS: MarketNewsItem[] = [
  { id: "n1", symbol: "NVDA", headline: "AI capex cycle stays firm as hyperscalers reaffirm spend", headlineAr: "دورة إنفاق الذكاء الاصطناعي مستمرة مع تأكيد المنصات الكبرى", source: "Desk Wire", ago: "12m", agoAr: "١٢ د", sentiment: "pos" },
  { id: "n2", symbol: "2222", headline: "Aramco dividend framework supports income bid on Tadawul", headlineAr: "إطار توزيعات أرامكو يدعم الطلب على الدخل في تداول", source: "GCC Markets", ago: "28m", agoAr: "٢٨ د", sentiment: "pos" },
  { id: "n3", symbol: "EURUSD", headline: "Dollar softens ahead of CPI; EURUSD tests session highs", headlineAr: "الدولار يلين قبل التضخم؛ اليورو يختبر قمم الجلسة", source: "FX Pulse", ago: "41m", agoAr: "٤١ د", sentiment: "neu" },
  { id: "n4", symbol: "TSLA", headline: "EV price competition weighs on margins narrative", headlineAr: "منافسة أسعار السيارات الكهربائية تضغط على هامش الربح", source: "Auto Desk", ago: "1h", agoAr: "١ س", sentiment: "neg" },
  { id: "n5", symbol: "BTCUSD", headline: "BTC holds above weekly pivot as ETF flows stay constructive", headlineAr: "بيتكوين فوق محور الأسبوع مع تدفقات صناديق إيجابية", source: "Crypto Tape", ago: "1h", agoAr: "١ س", sentiment: "pos" },
  { id: "n6", symbol: "SPY", headline: "Breadth improves; equal-weight catches up to mega-cap leadership", headlineAr: "اتساع السوق يتحسن؛ الوزن المتساوي يلحق بقيادة الشركات الكبرى", source: "US Equity", ago: "2h", agoAr: "٢ س", sentiment: "pos" },
  { id: "n7", symbol: "1120", headline: "Al Rajhi loan growth narrative stays in focus ahead of earnings", headlineAr: "نمو قروض الراجحي محور الاهتمام قبل النتائج", source: "TASI Desk", ago: "3h", agoAr: "٣ س", sentiment: "neu" },
  { id: "n8", symbol: "ETHUSD", headline: "ETH staking flows steady; relative strength vs BTC watched", headlineAr: "تدفقات رهن إيثريوم مستقرة؛ القوة النسبية أمام بيتكوين تحت المراقبة", source: "Crypto Tape", ago: "4h", agoAr: "٤ س", sentiment: "pos" },
  { id: "n9", symbol: "QQQ", headline: "Nasdaq leadership concentrates in semis and mega-cap software", headlineAr: "قيادة ناسداك تتركز في أشباه الموصلات وبرمجيات الشركات الكبرى", source: "US Equity", ago: "5h", agoAr: "٥ س", sentiment: "pos" },
  { id: "n10", symbol: "6015", headline: "Saudi Coffee Company stays on growth watch after listing", headlineAr: "شركة القهوة السعودية تحت مراقبة النمو بعد الإدراج", source: "TASI Desk", ago: "6h", agoAr: "٦ س", sentiment: "neu" },
];

export const MARKET_CALENDAR: MarketCalendarItem[] = [
  { id: "c1", when: "Today 15:30", whenAr: "اليوم ١٥:٣٠", event: "US CPI (YoY)", eventAr: "تضخم الولايات المتحدة (سنوي)", importance: "high", actual: "—", forecast: "2.9%", previous: "3.0%" },
  { id: "c2", when: "Today 17:00", whenAr: "اليوم ١٧:٠٠", event: "Crude inventories", eventAr: "مخزونات النفط", importance: "med", actual: "—", forecast: "-1.2M", previous: "+0.4M" },
  { id: "c3", when: "Tomorrow 11:00", whenAr: "غداً ١١:٠٠", event: "ECB speakers", eventAr: "متحدثو المركزي الأوروبي", importance: "med", actual: "—", forecast: "—", previous: "—" },
  { id: "c4", when: "Thu 16:00", whenAr: "الخميس ١٦:٠٠", event: "US Initial claims", eventAr: "مطالبات البطالة الأولية", importance: "low", actual: "—", forecast: "220k", previous: "218k" },
  { id: "c5", when: "Sun 12:00", whenAr: "الأحد ١٢:٠٠", event: "TASI weekly settlement", eventAr: "تسوية تاسي الأسبوعية", importance: "med", actual: "—", forecast: "—", previous: "—" },
];

export function buildHeatmap(quotes: MarketQuote[]): MarketHeatCell[] {
  return quotes
    .filter((q) => q.assetClass === "equity" || q.assetClass === "etf" || q.assetClass === "index")
    .slice(0, 12)
    .map((q) => ({
      id: q.symbol,
      label: displaySymbol(q.symbol),
      labelAr: q.nameAr,
      changePct: changePct(q),
    }));
}

export function buildScreener(quotes: MarketQuote[]): MarketScreenRow[] {
  return quotes
    .filter((q) => q.assetClass === "equity" || q.assetClass === "etf" || q.assetClass === "crypto")
    .map((q) => {
      const pct = changePct(q);
      const relVol = q.avgVolume ? q.volume / q.avgVolume : 1;
      const score = round(pct * 1.4 + (relVol - 1) * 8 + (q.pe ? Math.max(0, 40 - q.pe) / 10 : 0), 1);
      return {
        symbol: q.symbol,
        name: q.name,
        sector: q.sector,
        sectorAr: q.sectorAr,
        last: q.last,
        changePct: pct,
        volume: q.volume,
        relVol: round(relVol, 2),
        pe: q.pe,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function formatCompact(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${round(value / 1e12, 2)}T`;
  if (abs >= 1e9) return `${round(value / 1e9, 2)}B`;
  if (abs >= 1e6) return `${round(value / 1e6, 2)}M`;
  if (abs >= 1e3) return `${round(value / 1e3, 1)}K`;
  return round(value, digits).toFixed(digits);
}

export function formatPrice(value: number, assetClass: MarketAssetClass): string {
  if (assetClass === "fx") return value < 10 ? value.toFixed(4) : value.toFixed(2);
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value < 1) return value.toFixed(4);
  return value.toFixed(2);
}

export function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Venue session status for the live desk strip. */
export type MarketSessionId = "tasi" | "nasdaq" | "nyse" | "crypto" | "fx";

export type MarketSessionStatus = {
  id: MarketSessionId;
  open: boolean;
  label: string;
  labelAr: string;
  hours: string;
  hoursAr: string;
  nextHint: string;
  nextHintAr: string;
};

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = parts.weekday ?? "Mon";
  const hour = Number(parts.hour ?? "0");
  const minute = Number(parts.minute ?? "0");
  return { weekday, minutes: hour * 60 + minute };
}

function isWeekdayMonFri(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

/** Tadawul: Sun–Thu 10:00–15:00 Asia/Riyadh. */
function tasiOpen(now: Date): boolean {
  const { weekday, minutes } = zonedParts(now, "Asia/Riyadh");
  const tradingDay = weekday !== "Fri" && weekday !== "Sat";
  return tradingDay && minutes >= 10 * 60 && minutes < 15 * 60;
}

/** US cash equities: Mon–Fri 09:30–16:00 America/New_York. */
function usCashOpen(now: Date): boolean {
  const { weekday, minutes } = zonedParts(now, "America/New_York");
  return isWeekdayMonFri(weekday) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** FX approx: Sun 17:00 ET → Fri 17:00 ET. */
function fxOpen(now: Date): boolean {
  const { weekday, minutes } = zonedParts(now, "America/New_York");
  if (weekday === "Sat") return false;
  if (weekday === "Sun") return minutes >= 17 * 60;
  if (weekday === "Fri") return minutes < 17 * 60;
  return true;
}

export function marketSessionBoard(now = new Date()): MarketSessionStatus[] {
  const tasi = tasiOpen(now);
  const us = usCashOpen(now);
  const fx = fxOpen(now);
  return [
    {
      id: "tasi",
      open: tasi,
      label: "TASI",
      labelAr: "تاسي",
      hours: "Sun–Thu 10:00–15:00 AST",
      hoursAr: "أحد–خميس ١٠:٠٠–١٥:٠٠",
      nextHint: tasi ? "Regular session" : "Closed · opens 10:00 AST",
      nextHintAr: tasi ? "جلسة منتظمة" : "مغلق · يفتح ١٠:٠٠",
    },
    {
      id: "nasdaq",
      open: us,
      label: "NASDAQ",
      labelAr: "ناسداك",
      hours: "Mon–Fri 09:30–16:00 ET",
      hoursAr: "إثنين–جمعة ٠٩:٣٠–١٦:٠٠ ET",
      nextHint: us ? "Regular session" : "Closed · opens 09:30 ET",
      nextHintAr: us ? "جلسة منتظمة" : "مغلق · يفتح ٠٩:٣٠ ET",
    },
    {
      id: "nyse",
      open: us,
      label: "NYSE",
      labelAr: "نيويورك",
      hours: "Mon–Fri 09:30–16:00 ET",
      hoursAr: "إثنين–جمعة ٠٩:٣٠–١٦:٠٠ ET",
      nextHint: us ? "Regular session" : "Closed · opens 09:30 ET",
      nextHintAr: us ? "جلسة منتظمة" : "مغلق · يفتح ٠٩:٣٠ ET",
    },
    {
      id: "crypto",
      open: true,
      label: "Crypto",
      labelAr: "مشفرة",
      hours: "24/7",
      hoursAr: "على مدار الساعة",
      nextHint: "Always open",
      nextHintAr: "مفتوح دائماً",
    },
    {
      id: "fx",
      open: fx,
      label: "FX",
      labelAr: "عملات",
      hours: "Sun 17:00–Fri 17:00 ET",
      hoursAr: "أحد ١٧:٠٠–جمعة ١٧:٠٠ ET",
      nextHint: fx ? "Spot session" : "Weekend closed",
      nextHintAr: fx ? "جلسة فورية" : "مغلق نهاية الأسبوع",
    },
  ];
}

export function sessionForQuote(quote: Pick<MarketInstrument, "exchange" | "assetClass">, now = new Date()): MarketSessionStatus {
  const board = marketSessionBoard(now);
  if (quote.assetClass === "crypto") return board.find((s) => s.id === "crypto")!;
  if (quote.assetClass === "fx") return board.find((s) => s.id === "fx")!;
  if (quote.exchange === "TADAWUL") return board.find((s) => s.id === "tasi")!;
  if (quote.exchange === "NASDAQ") return board.find((s) => s.id === "nasdaq")!;
  if (quote.exchange === "NYSE") return board.find((s) => s.id === "nyse")!;
  if (quote.assetClass === "index" && quote.exchange === "TADAWUL") return board.find((s) => s.id === "tasi")!;
  if (quote.assetClass === "index") return board.find((s) => s.id === "nasdaq")!;
  return board.find((s) => s.id === "nasdaq")!;
}

export type ChartIntervalKey = "5m" | "15m" | "1h" | "1d";

export const CHART_INTERVALS: Array<{ key: ChartIntervalKey; range: string; interval: string; label: string }> = [
  { key: "5m", range: "5d", interval: "5m", label: "5m" },
  { key: "15m", range: "1mo", interval: "15m", label: "15m" },
  { key: "1h", range: "3mo", interval: "60m", label: "1H" },
  { key: "1d", range: "1y", interval: "1d", label: "1D" },
];

export type ChartDrawKind = "hline" | "trend" | "ray" | "fib";

export type ChartDrawing =
  | { id: string; kind: "hline"; price: number }
  | { id: string; kind: "trend" | "ray"; t0: number; p0: number; t1: number; p1: number }
  | { id: string; kind: "fib"; t0: number; p0: number; t1: number; p1: number };

export function newDrawingId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
