import type { KvNamespace } from "@telnyx/edge-runtime";
import type { DepartmentInfo } from "../types";

const DEFAULT_DEPARTMENTS: DepartmentInfo[] = [
  {
    code: "general_medicine",
    displayNameEn: "General Medicine",
    displayNameAr: "الطب العام",
    referralRequired: false,
    walkInAccepted: true,
  },
  {
    code: "pediatrics",
    displayNameEn: "Pediatrics",
    displayNameAr: "طب الأطفال",
    referralRequired: false,
    walkInAccepted: true,
  },
  {
    code: "dental",
    displayNameEn: "Dental",
    displayNameAr: "طب الأسنان",
    referralRequired: false,
    walkInAccepted: false,
  },
];

export async function getDepartmentDirectory(kv: KvNamespace): Promise<DepartmentInfo[]> {
  const key = "department_directory";
  const result = await kv.get<DepartmentInfo[]>(key, { type: "json" });
  if (result) {
    return result;
  }
  await kv.put(key, JSON.stringify(DEFAULT_DEPARTMENTS));
  return DEFAULT_DEPARTMENTS;
}

export async function getSameDaySlotsFlag(kv: KvNamespace, fallback = false): Promise<boolean> {
  const key = "feature_flag_same_day_slots_enabled";
  const result = await kv.get<boolean>(key, { type: "json" });
  if (result === null) {
    return fallback;
  }
  return result;
}

export async function setSameDaySlotsFlag(kv: KvNamespace, value: boolean): Promise<void> {
  const key = "feature_flag_same_day_slots_enabled";
  await kv.put(key, JSON.stringify(value));
}
