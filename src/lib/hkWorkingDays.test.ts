import { describe, expect, it } from "vitest";
import {
  HK_GENERAL_HOLIDAYS,
  addWeatherDays,
  addWorkingDays,
  isHkWorkingDay,
  protectionStartDate,
  toHkDate,
} from "./hkWorkingDays";

describe("holiday table", () => {
  it("lists the 17 gazetted general holidays for each of 2026 and 2027, none on a Sunday", () => {
    const sundays = HK_GENERAL_HOLIDAYS.filter((d) => new Date(d + "T00:00:00Z").getUTCDay() === 0);
    expect(sundays).toEqual([]);
    expect(new Set(HK_GENERAL_HOLIDAYS).size).toBe(HK_GENERAL_HOLIDAYS.length);
    expect(HK_GENERAL_HOLIDAYS.filter((d) => d.startsWith("2026")).length).toBe(17);
    expect(HK_GENERAL_HOLIDAYS.filter((d) => d.startsWith("2027")).length).toBe(17);
  });
});

describe("isHkWorkingDay", () => {
  it("counts Saturdays, skips Sundays", () => {
    expect(isHkWorkingDay("2026-10-10")).toBe(true); // Saturday
    expect(isHkWorkingDay("2026-10-11")).toBe(false); // Sunday
  });
  it("skips a Saturday that is a general holiday", () => {
    expect(isHkWorkingDay("2026-04-04")).toBe(false);
    expect(isHkWorkingDay("2026-12-26")).toBe(false);
  });
  it("rejects dates outside the holiday data", () => {
    expect(() => isHkWorkingDay("2028-01-03")).toThrow(RangeError);
    expect(() => isHkWorkingDay("2025-12-31")).toThrow(RangeError);
  });
});

describe("protectionStartDate", () => {
  it("plain week: Mon 2026-10-05 -> 10 working days (Sat counts) -> Fri 10-16", () => {
    // 6,7,8,9,10(Sat),[11 Sun],12,13,14,15 ... recount: Tue6 Wed7 Thu8 Fri9 Sat10 Mon12 Tue13 Wed14 Thu15 Fri16
    expect(protectionStartDate("2026-10-05")).toBe("2026-10-16");
  });

  it("registered on a Sunday starts counting from Monday", () => {
    // Mon12 Tue13 Wed14 Thu15 Fri16 Sat17 Mon19(holiday 19 Oct -> skip) Tue20 Wed21 Thu22 Fri23
    expect(protectionStartDate("2026-10-11")).toBe("2026-10-23");
  });

  it("holiday week: National Day (Thu 2026-10-01) is skipped", () => {
    // Registered Mon 2026-09-28: Tue29 Wed30 [Thu1 hol] Fri2 Sat3 Mon5 Tue6 Wed7 Thu8 Fri9 Sat10
    expect(protectionStartDate("2026-09-28")).toBe("2026-10-10");
  });

  it("Easter cluster 2026: Good Friday, Saturday, Easter Monday and Tuesday all skipped", () => {
    // Registered Thu 2026-04-02: Mon? Fri3 hol, Sat4 hol, Sun, Mon6 hol, Tue7 hol, Wed8 Thu9 Fri10 Sat11 Mon13 Tue14 Wed15 Thu16 Fri17 Sat18
    expect(protectionStartDate("2026-04-02")).toBe("2026-04-18");
  });

  it("Lunar New Year 2026 week", () => {
    // Registered Fri 2026-02-13: Sat14 Mon16 [Tue17-Thu19 hol] Fri20 Sat21 Mon23 Tue24 Wed25 Thu26 Fri27 Sat28
    expect(protectionStartDate("2026-02-13")).toBe("2026-02-28");
  });

  it("year-end 2026 -> 2027: Christmas Fri/Sat, New Year's Day", () => {
    // Registered Wed 2026-12-23: Thu24(1) [Fri25 Sat26 hol] Mon28(2) Tue29(3) Wed30(4) Thu31(5) [Fri1 hol] Sat2(6) Mon4(7) Tue5(8) Wed6(9) Thu7(10)
    expect(protectionStartDate("2026-12-23")).toBe("2027-01-07");
  });

  it("year-end 2026 start of January: registered 2026-12-31", () => {
    // [Fri1 hol] Sat2 Mon4 Tue5 Wed6 Thu7 Fri8 Sat9 Mon11 Tue12 Wed13
    expect(protectionStartDate("2026-12-31")).toBe("2027-01-13");
  });

  it("Lunar New Year 2027 with Sunday substitute", () => {
    // Registered Thu 2027-02-04: Fri5 [Sat6 hol] [Sun7] Mon8? hol, Tue9 hol -> Wed10 Thu11 Fri12 Sat13 Mon15 Tue16 Wed17 Thu18 Fri19
    // count: Fri5(1) Wed10(2) Thu11(3) Fri12(4) Sat13(5) Mon15(6) Tue16(7) Wed17(8) Thu18(9) Fri19(10)
    expect(protectionStartDate("2027-02-04")).toBe("2027-02-19");
  });

  it("Easter 2027 and Ching Ming", () => {
    // Registered Wed 2027-03-24: Thu25(1) [Fri26 Sat27 hol] [Mon29 hol] Tue30(2) Wed31(3) Thu1(4) Fri2(5) Sat3(6) [Mon5 hol] Tue6(7) Wed7(8) Thu8(9) Fri9(10)
    expect(protectionStartDate("2027-03-24")).toBe("2027-04-09");
  });

  it("end of 2027: last registrations inside the data window throw once the count crosses 2027-12-31", () => {
    expect(protectionStartDate("2027-12-10")).toBe("2027-12-22"); // Sat11(1) Mon13-Sat18(2-7) Mon20(8) Tue21(9) Wed22(10)
    expect(() => protectionStartDate("2027-12-28")).toThrow(RangeError);
  });

  it("converts an instant to the Hong Kong date (UTC+8)", () => {
    // 2026-10-04T17:00Z is 2026-10-05 01:00 HKT -> same as registering on Mon 10-05
    expect(protectionStartDate("2026-10-04T17:00:00Z")).toBe("2026-10-16");
    expect(protectionStartDate(new Date("2026-10-05T15:59:00Z"))).toBe("2026-10-16");
    // 16:00Z on 10-05 is already 10-06 in HK
    expect(toHkDate("2026-10-05T16:00:00Z")).toBe("2026-10-06");
  });

  it("rejects garbage input", () => {
    expect(() => protectionStartDate("not-a-date")).toThrow(RangeError);
    expect(() => protectionStartDate("2026-02-30")).toThrow(RangeError);
  });
});

describe("addWeatherDays (manual adjustment)", () => {
  it("n = 0 is a no-op", () => {
    expect(addWeatherDays("2026-10-16", 0)).toBe("2026-10-16");
  });
  it("one black rainstorm day pushes to the next working day", () => {
    expect(addWeatherDays("2026-10-16", 1)).toBe("2026-10-17"); // Saturday counts
  });
  it("skips Sundays and holidays when pushing", () => {
    expect(addWeatherDays("2026-10-17", 1)).toBe("2026-10-20"); // Sun 18 skipped, Mon 19 holiday skipped
    expect(addWeatherDays("2026-09-30", 2)).toBe("2026-10-03"); // Thu 1 Oct holiday skipped
  });
  it("rejects negative or fractional counts", () => {
    expect(() => addWeatherDays("2026-10-16", -1)).toThrow(RangeError);
    expect(() => addWorkingDays("2026-10-16", 1.5)).toThrow(RangeError);
  });
});
