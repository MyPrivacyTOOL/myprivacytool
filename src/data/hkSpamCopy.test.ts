// MPC-7446: both languages are complete and neither claims the unverified IVR keys work.
import { describe, expect, it } from "vitest";
import { EN, HK_COPY, HK_EMAIL_COPY, ZH, type HkCopy } from "./hkSpamCopy";

const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
const shape = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v;

describe("hk spam copy", () => {
  it("English and Traditional Chinese have identical structure and no empty strings", () => {
    expect(shape(ZH)).toEqual(shape(EN));
    for (const copy of [EN, ZH] as HkCopy[]) for (const s of strings(copy)) expect(s.trim().length).toBeGreaterThan(0);
    expect(EN.faqs).toHaveLength(ZH.faqs.length);
    expect(HK_COPY.en).toBe(EN);
    expect(HK_COPY.zh).toBe(ZH);
  });

  it("uses Hong Kong locale tags and Traditional Chinese (no Simplified-only forms)", () => {
    expect(EN.htmlLang).toBe("en-HK");
    expect(ZH.htmlLang).toBe("zh-HK");
    const zh = strings(ZH).join("");
    expect(zh).toMatch(/[一-鿿]/);
    for (const simplified of ["时", "么", "这", "单", "录", "网", "电话号码"]) expect(zh).not.toContain(simplified);
  });

  it("covers the OFCA facts: free, 10 working days, consent beats the register, live calls, check/cancel", () => {
    const en = EN.faqs.map((f) => `${f.q} ${f.a}`).join(" ");
    expect(en).toMatch(/free/i);
    expect(en).toMatch(/10th working day/i);
    expect(en).toMatch(/consent beats the register/i);
    expect(en).toMatch(/live person/i);
    expect(en).toMatch(/dnc\.gov\.hk/);
    const zh = ZH.faqs.map((f) => `${f.q} ${f.a}`).join("");
    expect(zh).toContain("第 10 個工作日");
    expect(zh).toContain("真人");
  });

  it("the shared claims never say the keys work or auto-send", () => {
    // keysAuto is only ever rendered when the keys are verified or in an internal preview; everything else is shared.
    const shared = [EN.heroSub, EN.ctaSub, EN.steps.tap.body, EN.steps.dial.body, EN.steps.keysHidden.body, ...EN.faqs.map((f) => f.a)].join(" ");
    expect(shared).not.toMatch(/automatic|auto-?send|sends? the keys|guarantee/i);
  });

  it("day-10 email strings: both languages complete, Traditional Chinese, one button label, claims live calls are not covered", () => {
    expect(shape(HK_EMAIL_COPY.yue)).toEqual(shape(HK_EMAIL_COPY.en));
    for (const l of [HK_EMAIL_COPY.en, HK_EMAIL_COPY.yue]) for (const x of strings(l)) expect(x.trim().length).toBeGreaterThan(0);
    expect(HK_EMAIL_COPY.en.button).toBe("Run your free privacy scan");
    expect(HK_EMAIL_COPY.en.not.join(" ")).toMatch(/Live calls/);
    const zh = strings(HK_EMAIL_COPY.yue).join("");
    expect(zh).toContain("真人");
    for (const simplified of ["时", "么", "这", "单", "录", "网", "电话号码", "短信"]) expect(zh).not.toContain(simplified);
  });
});
