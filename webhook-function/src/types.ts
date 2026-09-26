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

export interface DynamicVariablesWebhookEvent {
  data?: {
    record_type?: string;
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: {
      telnyx_conversation_channel?: string;
      telnyx_agent_target?: string;
      telnyx_end_user_target?: string;
      telnyx_end_user_target_verified?: boolean;
      call_control_id?: string;
      assistant_id?: string;
      [key: string]: unknown;
    };
  };
}

export interface DynamicVariablesWebhookResponse {
  dynamic_variables: Record<string, unknown>;
}
