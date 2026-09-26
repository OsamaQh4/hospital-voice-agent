export type AppointmentStatus = "none" | "booked" | "completed" | "cancelled";

export type Department = "general_medicine" | "pediatrics" | "dental";

export interface AppointmentSlot {
  department: Department;
  slotTime: string;
  status: AppointmentStatus;
}

export interface PatientProfile {
  phoneNumber: string;
  fullName?: string;
  currentAppointment: AppointmentSlot | null;
  callAttemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentInfo {
  code: Department;
  displayNameEn: string;
  displayNameAr: string;
  referralRequired: boolean;
  walkInAccepted: boolean;
}
